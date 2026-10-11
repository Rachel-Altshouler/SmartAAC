import { buildLocalChildAiAnswer } from "@/lib/local-ai";
import { NextResponse } from "next/server";
import { CHILD_AI_SYSTEM_PROMPT, geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { isOllamaAvailable, ollamaChat } from "@/lib/ollama";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";
import { isProviderSkipped, noteProviderFailure } from "@/lib/provider-health";

type ChildAiRequest = {
  message?: string;
  history?: ChildAiMessage[];
  gender?: "boy" | "girl";
};

type ChildAiMessage = {
  role: "user" | "assistant";
  content: string;
};

// Now and then a model drops a foreign word into the Hebrew ("czasem חברים");
// the child hears gibberish, so words in Latin letters are taken out.
const keepHebrewOnly = (answer: string): string =>
  answer
    .replace(/[A-Za-zÀ-ž]{2,}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();

export async function POST(request: Request) {
  const body = (await request.json()) as ChildAiRequest;
  const message = body.message?.trim() ?? "";
  const history = (body.history ?? [])
    .filter((item) => item.content.trim())
    .slice(-20);

  if (!message) {
    return NextResponse.json({ answer: "אפשר לכתוב משפט או לדבר ואז לשלוח." });
  }

  let lastError: string | undefined;
  // Talk to the child in their own gender ("מה תרצה" / "מה תרצי").
  const systemPrompt = [
    CHILD_AI_SYSTEM_PROMPT,
    body.gender === "girl"
      ? "אתה מדבר עם ילדה. פנה אליה תמיד בלשון נקבה: את, תרצי, ספרי לי, עייפה, שמחה."
      : body.gender === "boy"
        ? "אתה מדבר עם ילד. פנה אליו תמיד בלשון זכר: אתה, תרצה, ספר לי, עייף, שמח."
        : "",
    "על עצמך דבר תמיד בלשון זכר: אני שמח, אני מבין. אל תערבב זכר ונקבה באותה תשובה.",
    // A girl whose profile still says boy (the default) says "אני עייפה":
    // following her own words beats the setting.
    "אם הילד מדבר על עצמו בלשון אחרת (למשל ילדה שאומרת 'אני עייפה'), פנה אליו בלשון שבה הוא מדבר על עצמו.",
  ]
    .filter(Boolean)
    .join(" ");

  if (await isOllamaAvailable()) {
    const ollamaResult = await ollamaChat({ history, message, systemPrompt });
    if (ollamaResult.ok) {
      return NextResponse.json({ answer: ollamaResult.text, provider: "ollama" });
    }
  }

  if (getGroqApiKey() && !isProviderSkipped("groq-chat")) {
    const groqResult = await groqChat({ history, message, systemPrompt, timeoutMs: 6000 });
    if (groqResult.ok) {
      return NextResponse.json({ answer: groqResult.text, provider: "groq" });
    }
    lastError = groqResult.error;
    noteProviderFailure("groq-chat", groqResult.error);
    console.warn("smartaac: groq chat failed:", groqResult.error);
  }

  if (getOpenAiApiKey() && !isProviderSkipped("openai-chat")) {
    const openAiResult = await openAiChat({ history, message, systemPrompt });
    if (openAiResult.ok) {
      return NextResponse.json({ answer: openAiResult.text, provider: "openai" });
    }
    lastError = openAiResult.error;
    noteProviderFailure("openai-chat", openAiResult.error);
  }

  if (getGeminiApiKey()) {
    // Flash, not Flash-Lite: Lite's Hebrew slipped between masculine and
    // feminine. Thinking off keeps it as quick to answer.
    const geminiResult = await geminiChat({
      history,
      message,
      systemPrompt,
      models: ["gemini-3.6-flash", "gemini-flash-latest", "gemini-flash-lite-latest"],
      thinkingBudget: 0,
      temperature: 0.7,
      // A child waiting longer than this gets the short built-in reply instead.
      timeoutMs: 10000,
    });
    if (geminiResult.ok) {
      return NextResponse.json({ answer: keepHebrewOnly(geminiResult.text), provider: "gemini" });
    }
    lastError = geminiResult.error;
  }

  return NextResponse.json({
    answer: buildLocalChildAiAnswer(message, history, body.gender === "girl" ? "girl" : "boy"),
    provider: "local",
    error: lastError ?? "ai providers unavailable",
  });
}
