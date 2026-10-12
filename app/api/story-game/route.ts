import { NextResponse } from "next/server";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { isOllamaAvailable, ollamaChat } from "@/lib/ollama";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";
import { parseStory } from "@/lib/story-game";

// Generates one whole connected story (all steps at once) so every sentence
// continues the previous one. See lib/story-game.ts for the shape.

// Gemini (≤10 + 12 s) racing Groq (6 + ≤12 s), then OpenAI (≤8 s): inside this limit.
export const maxDuration = 40;

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

// Any letter that isn't Hebrew (models now and then slip in Greek or Latin:
// "יום בגן הπαιχνίδια") — the child would hear gibberish read aloud.
const FOREIGN_LETTER = /(?![֐-׿])\p{L}/u;

const parseJsonStory = (raw: string) => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const story = parseStory(JSON.parse(match[0]));
    if (!story) return null;
    const texts = [
      story.title,
      ...story.steps.flatMap((step) => [step.before, step.after, step.answer.label, ...step.wrong.map((word) => word.label)]),
    ];
    return texts.some((text) => FOREIGN_LETTER.test(text)) ? null : story;
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
  // Left to itself the model keeps writing the same few stories (a cake, a
  // garden), so the topic is picked here, at random, skipping recent ones.
  const fresh = STORY_TOPICS.filter((topic) => !avoid.some((title) => title.includes(topic.key)));
  const pool = fresh.length ? fresh : STORY_TOPICS;
  const topic = pool[Math.floor(Math.random() * pool.length)] as (typeof STORY_TOPICS)[number];
  const message = [
    `כתוב/כתבי סיפור חדש על: ${topic.text}.`,
    avoid.length ? `אל תחזור/י על הסיפורים האלה, הם כבר היו: ${avoid.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const options = { history: [], message, systemPrompt: STORY_SYSTEM_PROMPT };

  if (await isOllamaAvailable()) {
    const result = await ollamaChat(options);
    const story = result.ok ? parseJsonStory(result.text) : null;
    if (story) return NextResponse.json({ story, provider: "ollama" });
  }

  // Gemini Flash-Lite (measured: 2–5 s). About 1 story in 4 comes back unusable
  // (a Greek / Arabic word slipped in, or broken JSON) and is thrown out, so it
  // tries again while there's time. (Not Flash: its free tier is 20 a day.)
  // Groq joins after a few seconds as a backup, and the first valid story
  // wins; OpenAI is the last resort.
  const hasGemini = Boolean(getGeminiApiKey());
  const gemini = hasGemini
    ? (async () => {
        const startedAt = Date.now();
        for (let attempt = 0; attempt < 3 && Date.now() - startedAt < 10000; attempt += 1) {
          const story = await storyFrom("gemini", () =>
            geminiChat({ ...options, maxOutputTokens: STORY_MAX_TOKENS, json: true, timeoutMs: 12000 }),
          );
          if (story) return story;
        }
        return null;
      })()
    : null;
  let answered = false;
  const groq = getGroqApiKey()
    ? (hasGemini ? wait(BACKUP_HEAD_START_MS) : Promise.resolve()).then(() =>
        // Not needed once Gemini already delivered.
        answered
          ? null
          : storyFrom("groq", () => groqChat({ ...options, maxTokens: STORY_MAX_TOKENS, json: true, timeoutMs: 12000 })),
      )
    : null;

  const first = await firstStory([gemini, groq]);
  answered = true;
  if (first) return NextResponse.json(first);

  if (getOpenAiApiKey()) {
    const openAi = await storyFrom("openai", () =>
      openAiChat({ ...options, maxTokens: STORY_MAX_TOKENS, json: true, timeoutMs: 8000 }),
    );
    if (openAi) return NextResponse.json(openAi);
  }

  return NextResponse.json({ story: null, provider: "local" });
}

// Everyday experiences a young child knows. `key` is a word the story's title
// will likely contain, so recently played topics can be skipped.
const STORY_TOPICS = [
  { key: "חווה", text: "ביקור בחווה עם בעלי חיים" },
  { key: "גשם", text: "יום גשום" },
  { key: "יער", text: "טיול ביער" },
  { key: "עוגה", text: "אפיית עוגה" },
  { key: "ים", text: "יום בים" },
  { key: "גן החיות", text: "ביקור בגן החיות" },
  { key: "יום הולדת", text: "מסיבת יום הולדת" },
  { key: "סופר", text: "קניות בסופר" },
  { key: "רופא", text: "ביקור אצל הרופא" },
  { key: "אוטובוס", text: "נסיעה באוטובוס" },
  { key: "פארק", text: "משחק בפארק" },
  { key: "שלג", text: "יום עם שלג" },
  { key: "אמבטיה", text: "זמן אמבטיה בערב" },
  { key: "כלב", text: "טיול עם הכלב" },
  { key: "גינה", text: "שתילת פרחים בגינה" },
  { key: "פיקניק", text: "פיקניק עם המשפחה" },
  { key: "ספרייה", text: "ביקור בספרייה" },
  { key: "סבתא", text: "ביקור אצל סבא וסבתא" },
  { key: "רכבת", text: "נסיעה ברכבת" },
  { key: "בריכה", text: "יום בבריכה" },
  { key: "ציור", text: "ציור עם צבעים בגן" },
  { key: "חג", text: "הכנות לחג עם המשפחה" },
] as const;

// A whole 5-step story as JSON (Hebrew, with emojis) runs to ~600–1500 tokens.
const STORY_MAX_TOKENS = 3000;
const BACKUP_HEAD_START_MS = 6000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type StoryResult = { story: NonNullable<ReturnType<typeof parseJsonStory>>; provider: string };

// One provider's attempt: resolves to a valid story, or null (failed / bad JSON).
const storyFrom = async (
  provider: string,
  run: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>,
): Promise<StoryResult | null> => {
  const result = await run();
  const story = result.ok ? parseJsonStory(result.text) : null;
  if (!story) {
    const reason = result.ok ? `invalid story: ${result.text.slice(0, 300)}` : result.error;
    console.warn(`smartaac: story from ${provider} failed:`, reason);
  }
  return story ? { story, provider } : null;
};

// The first attempt that comes back with a story; null once all have failed.
const firstStory = (attempts: Array<Promise<StoryResult | null> | null>): Promise<StoryResult | null> => {
  const running = attempts.filter((attempt): attempt is Promise<StoryResult | null> => attempt !== null);
  if (running.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let pending = running.length;
    running.forEach((attempt) => {
      attempt.then(
        (result) => {
          pending -= 1;
          if (result) resolve(result);
          else if (pending === 0) resolve(null);
        },
        () => {
          pending -= 1;
          if (pending === 0) resolve(null);
        },
      );
    });
  });
};
