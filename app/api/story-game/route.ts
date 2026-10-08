import { NextResponse } from "next/server";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { isOllamaAvailable, ollamaChat } from "@/lib/ollama";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";
import { parseStory } from "@/lib/story-game";

// Generates one whole connected story (all steps at once) so every sentence
// continues the previous one. See lib/story-game.ts for the shape.

type StoryRequest = { avoidTitles?: unknown };

const STORY_SYSTEM_PROMPT = [
  "את/ה כותב/ת סיפור קצר ומחובר לילד/ה בן/בת 4-8 שמשתמש/ת ב-AAC ולומד/ת שפה.",
  "הסיפור מסופר בגוף ראשון, על חוויה אחת רציפה (למשל ביקור בחווה, יום גשום, טיול ביער, אפיית עוגה).",
  "הסיפור מחולק ל-5 שלבים. כל שלב הוא משפט אחד קצר (6-12 מילים) שממשיך את מה שקרה בשלב הקודם — אותן דמויות, אותו מקום, וכל שלב מתקדם הלאה בעלילה.",
  "חבר/י בין השלבים בצורה טבעית, כמו ילד שמספר: 'ואז', 'אחר כך', 'היה לו', 'בסוף'. אל תפתח/י משפט בחזרה על סוף המשפט הקודם.",
  "דוגמה מצוינת: שלב 1: 'הלכתי לגן החיות וראיתי [אריה].' שלב 2: 'היה לו זנב ארוך, והוא [שאג] בקול.' שלב 3: 'אחר כך ראינו [פיל] גדול.'",
  "בכל שלב חסרה מילה אחת (answer): before הוא החלק שלפני המילה, after הוא מה שבא אחריה (יכול להיות רק נקודה). אם המילה מחוברת לאות אחת (ו, ב, ל, ה), שים/י את האות לבד בסוף before.",
  "answer היא מילה פשוטה ומוכרת לילד (רצוי שם עצם או פועל פשוט), בעברית תקינה, עם אימוג'י אחד שמראה אותה בבירור.",
  "wrong הן שתי מילים מוכרות עם אימוג'י, שבלתי אפשרי שיתאימו למקום הזה במשפט — גם לא בדרך מצחיקה. לפני שאת/ה עונה, בדוק/בדקי שכל מילה ב-wrong נשמעת לא הגיונית בכלל במשפט.",
  "עברית תקינה ופשוטה, בלי ניקוד, בלי מילים מפחידות או עצובות.",
  'החזר/י אך ורק JSON תקין, בלי markdown, בפורמט: {"title":"...","emoji":"...","steps":[{"before":"...","answer":{"label":"...","emoji":"..."},"after":"...","wrong":[{"label":"...","emoji":"..."},{"label":"...","emoji":"..."}]}]}',
].join(" ");

const parseJsonStory = (raw: string) => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return parseStory(JSON.parse(match[0]));
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  let body: StoryRequest = {};
  try {
    body = (await request.json()) as StoryRequest;
  } catch {
    body = {};
  }

  const avoid = (Array.isArray(body.avoidTitles) ? body.avoidTitles : [])
    .filter((title): title is string => typeof title === "string")
    .slice(0, 10)
    .map((title) => title.slice(0, 40));
  const message = avoid.length
    ? `כתוב/כתבי סיפור חדש. אל תכתוב/י על הנושאים האלה, הם כבר היו: ${avoid.join(", ")}.`
    : "כתוב/כתבי סיפור חדש.";
  const options = { history: [], message, systemPrompt: STORY_SYSTEM_PROMPT };

  const providers = [
    { name: "gemini", enabled: Boolean(getGeminiApiKey()), run: () => geminiChat({ ...options, maxOutputTokens: 1200 }) },
    { name: "groq", enabled: Boolean(getGroqApiKey()), run: () => groqChat(options) },
    { name: "openai", enabled: Boolean(getOpenAiApiKey()), run: () => openAiChat(options) },
  ];

  if (await isOllamaAvailable()) {
    const result = await ollamaChat(options);
    const story = result.ok ? parseJsonStory(result.text) : null;
    if (story) return NextResponse.json({ story, provider: "ollama" });
  }

  for (const provider of providers) {
    if (!provider.enabled) continue;
    const result = await provider.run();
    const story = result.ok ? parseJsonStory(result.text) : null;
    if (story) return NextResponse.json({ story, provider: provider.name });
  }

  return NextResponse.json({ story: null, provider: "local" });
}
