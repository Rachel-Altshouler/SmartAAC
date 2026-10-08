import { NextResponse } from "next/server";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { isOllamaAvailable, ollamaChat } from "@/lib/ollama";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";

type EventInput = { type: string; title: string; date: string };

type SuggestionsRequest = {
  events?: EventInput[];
};

type Suggestion = { text: string; emoji: string };

const SUGGESTIONS_SYSTEM_PROMPT = [
  "את/ה מנוע הצעות משפטים למסך תקשורת AAC של ילד/ה שלא בהכרח יודע/ת לקרוא.",
  "תקבל/י רשימת אירועים שקורים השבוע הזה, כל אחד עם כותרת אמיתית (לא קטגוריה כללית) ותאריך.",
  "המשפטים חייבים להיות רק ורק על האירועים שקיבלת — אסור להמציא משפטים כלליים שלא קשורים לאף אירוע ברשימה.",
  "לכל אירוע צרו 1-2 משפטים שונים (לפני האירוע: התרגשות/ציפייה, אחרי האירוע: שאלה/סיפור על מה שהיה, לפי התאריך ביחס להיום).",
  'החזר/י אך ורק מערך JSON תקין, בלי טקסט נוסף ובלי markdown, בפורמט: [{"text":"...","emoji":"..."}]',
  "כל text הוא משפט קצר מאוד (2-6 מילים) בגוף ראשון, בעברית פשוטה וטבעית לילד/ה.",
  "כל emoji הוא אימוג'י בודד שממחיש חזותית את המשפט, כדי שילד/ה שלא קורא/ת יזהה על מה לוחצים.",
  "אם קיבלת רשימת אירועים ריקה, החזר/י מערך ריק [].",
  "בלי הסברים לפני או אחרי ה-JSON.",
].join(" ");

function buildContextMessage(body: SuggestionsRequest): string {
  const today = new Date().toISOString().slice(0, 10);
  const events = body.events ?? [];

  const lines = [`היום: ${today}`, "אירועים השבוע:"];
  events.forEach((event) => lines.push(`- ${event.title} (${event.date})`));

  return lines.join("\n");
}

function parseSuggestions(raw: string): Suggestion[] | null {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return null;

    const cleaned = parsed
      .map((item) => {
        const record = item as { text?: unknown; emoji?: unknown };
        return {
          text: typeof record.text === "string" ? record.text.trim() : "",
          emoji: typeof record.emoji === "string" && record.emoji.trim() ? record.emoji.trim() : "💬",
        };
      })
      .filter((item) => item.text.length > 0)
      .slice(0, 8);

    return cleaned.length ? cleaned : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as SuggestionsRequest;

  if (!body.events || body.events.length === 0) {
    return NextResponse.json({ suggestions: [], provider: "local" });
  }

  const message = buildContextMessage(body);

  if (await isOllamaAvailable()) {
    const result = await ollamaChat({ history: [], message, systemPrompt: SUGGESTIONS_SYSTEM_PROMPT });
    if (result.ok) {
      const suggestions = parseSuggestions(result.text);
      if (suggestions) return NextResponse.json({ suggestions, provider: "ollama" });
    }
  }

  if (getGroqApiKey()) {
    const result = await groqChat({ history: [], message, systemPrompt: SUGGESTIONS_SYSTEM_PROMPT });
    if (result.ok) {
      const suggestions = parseSuggestions(result.text);
      if (suggestions) return NextResponse.json({ suggestions, provider: "groq" });
    }
  }

  if (getOpenAiApiKey()) {
    const result = await openAiChat({ history: [], message, systemPrompt: SUGGESTIONS_SYSTEM_PROMPT });
    if (result.ok) {
      const suggestions = parseSuggestions(result.text);
      if (suggestions) return NextResponse.json({ suggestions, provider: "openai" });
    }
  }

  if (getGeminiApiKey()) {
    const result = await geminiChat({
      history: [],
      message,
      systemPrompt: SUGGESTIONS_SYSTEM_PROMPT,
      models: ["gemini-3.6-flash", "gemini-flash-latest"],
      thinkingBudget: 0,
      maxOutputTokens: 700,
    });
    if (result.ok) {
      const suggestions = parseSuggestions(result.text);
      if (suggestions) return NextResponse.json({ suggestions, provider: "gemini" });
    }
  }

  return NextResponse.json({ suggestions: null, provider: "local" });
}
