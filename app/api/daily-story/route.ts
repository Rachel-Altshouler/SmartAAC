import { NextResponse } from "next/server";
import { FALLBACK_EVENT_SYMBOLS } from "@/lib/event-symbols";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import {
  createAdminSupabaseClient,
  createAuthedSupabaseClient,
  isServerSupabaseConfigured,
} from "@/lib/supabase-server";

// "מה עשינו היום": the photos of the day (school or home), each with the sentence the
// teacher wrote + the sentence's words that are on the child's board, saved for
// the child's care team (table daily_stories, migration 007). Below each photo
// the child also gets concrete symbols related to what was done (the AI picks
// them; words missing from the board get an ARASAAC pictogram). The photos themselves go to the private
// Supabase Storage bucket below; the row keeps only their paths, and readers get
// short-lived signed links. One photo per request, so any number fits.

type StoryWord = { label: string; emoji: string; symbolId?: string; pictogramId?: number };
// photoPath: in the storage bucket. photo: an older inline data URL (or the
// fallback when there is no service-role key). wordsVersion: which way the
// symbols were picked; older ones are picked again.
type StoredItem = {
  photoPath?: string;
  photo?: string;
  sentence: string;
  words: StoryWord[];
  wordsVersion?: number;
  place?: "school" | "home";
};
type StoryItem = {
  photo: string;
  sentence: string;
  words: StoryWord[];
  needsWords?: boolean;
  place: "school" | "home";
  photoKey?: string;
};

const WORDS_VERSION = 2;
const needsWords = (item: StoredItem): boolean => !item.words?.length || item.wordsVersion !== WORDS_VERSION;

const BUCKET = "daily-stories";
const MAX_PHOTO_CHARS = 900_000; // ~650KB of image after compression
const LINK_SECONDS = 12 * 60 * 60;

let bucketReady = false;
const ensureBucket = async (admin: NonNullable<ReturnType<typeof createAdminSupabaseClient>>): Promise<void> => {
  if (bucketReady) return;
  const created = await admin.storage.createBucket(BUCKET, { public: false });
  if (created.error && !/exist/i.test(created.error.message)) throw new Error(created.error.message);
  bucketReady = true;
};

// Stored items → items with a viewable photo link.
const withPhotoLinks = async (items: StoredItem[]): Promise<StoryItem[]> => {
  const admin = createAdminSupabaseClient();
  const paths = items.map((item) => item.photoPath).filter((path): path is string => Boolean(path));
  const links: Record<string, string> = {};
  if (admin && paths.length > 0) {
    const signed = await admin.storage.from(BUCKET).createSignedUrls(paths, LINK_SECONDS);
    for (const entry of signed.data ?? []) {
      if (entry.path && entry.signedUrl) links[entry.path] = entry.signedUrl;
    }
  }
  return items
    .map((item) => ({
      photo: item.photoPath ? links[item.photoPath] ?? "" : item.photo ?? "",
      // Lets the app keep a photo link it already has (and the browser's copy).
      ...(item.photoPath ? { photoKey: item.photoPath } : {}),
      sentence: item.sentence,
      words: item.words ?? [],
      place: item.place ?? "school",
      ...(needsWords(item) ? { needsWords: true } : {}),
    }))
    .filter((item) => item.photo);
};

const readToken = (request: Request): string =>
  (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

async function authorize(
  request: Request,
  childId: string,
): Promise<{ error: NextResponse } | { client: ReturnType<typeof createAuthedSupabaseClient>; userId: string }> {
  if (!isServerSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Supabase is not configured" }, { status: 500 }) };
  }
  const token = readToken(request);
  if (!token || !childId) {
    return { error: NextResponse.json({ error: "חסרים פרטי התחברות או ילד." }, { status: 401 }) };
  }
  const client = createAuthedSupabaseClient(token);
  const [user, access] = await Promise.all([
    client.auth.getUser(token),
    client.rpc("can_access_child", { child_uuid: childId }),
  ]);
  if (user.error || !user.data.user) {
    return { error: NextResponse.json({ error: "ההתחברות פגה." }, { status: 401 }) };
  }
  if (access.error || access.data !== true) {
    return { error: NextResponse.json({ error: "אין הרשאה." }, { status: 403 }) };
  }
  return { client, userId: user.data.user.id };
}

const missingTable = (message: string): string =>
  /daily_stories|schema cache/i.test(message)
    ? "חסרה טבלה ב-Supabase: הריצו את supabase/migrations/007_daily_story_and_reminders.sql"
    : message;

const localIsoDate = (): string => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// The latest story from the last week.
export async function GET(request: Request): Promise<NextResponse> {
  const childId = new URL(request.url).searchParams.get("childId")?.trim() ?? "";
  const auth = await authorize(request, childId);
  if ("error" in auth) return auth.error;

  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const result = await auth.client
    .from("daily_stories")
    .select("story_date, items_json")
    .eq("child_id", childId)
    .gte("story_date", since)
    .order("story_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return NextResponse.json({ error: missingTable(result.error.message) }, { status: 500 });
  return NextResponse.json({
    story: result.data
      ? { date: result.data.story_date, items: await withPhotoLinks(result.data.items_json as StoredItem[]) }
      : null,
  });
}

// Hebrew prefixes (ו, ה, ב, ל, מ, ש, כ) are tried off when a word isn't found as is.
const matchWords = (sentence: string, vocabulary: Array<{ id: string; label: string; emoji: string }>): StoryWord[] => {
  const byLabel = new Map(vocabulary.map((item) => [item.label, item]));
  const words: StoryWord[] = [];
  for (const raw of sentence.split(/[\s,.!?;:"()\-]+/)) {
    if (!raw) continue;
    let found = byLabel.get(raw);
    for (let cut = 1; !found && cut <= 2 && raw.length - cut >= 2; cut += 1) {
      if (!/^[והבלמשכ]+$/.test(raw.slice(0, cut))) break;
      found = byLabel.get(raw.slice(cut));
    }
    if (found && !words.some((word) => word.symbolId === found.id)) {
      words.push({ label: found.label, emoji: found.emoji || "⭐", symbolId: found.id });
    }
  }
  return words.slice(0, 6);
};

const MAX_WORDS = 10;

const readVocabulary = (value: unknown): Array<{ id: string; label: string; emoji: string }> =>
  (Array.isArray(value) ? value : [])
    .map((item) => (item ?? {}) as Record<string, unknown>)
    .map((item) => ({ id: text(item.id, 60), label: text(item.label, 30), emoji: text(item.emoji, 12) }))
    .filter((item) => item.id && item.label)
    .slice(0, 600);

const RELATED_PROMPT = [
  "את/ה עוזר/ת לילד/ה שלא מדבר/ת לספר מה עשה/תה היום, בבית הספר או בבית, בעזרת סמלים.",
  "תקבל/י משפט שהמורה או ההורה כתב/ה על תמונה מהיום.",
  "בחר/י 6 עד 10 מילים מוחשיות שקשורות מאוד למה שקרה: המקום, מה רואים שם (חפצים, טבע, בעלי חיים, צבעים), איך הגיעו (כלי תחבורה), מי היה שם ומה עשו.",
  'דוגמה: "נסענו לים" → ים, מים, חול, שמיים, תכלת, גלים, אוטובוס, חבר.',
  'דוגמה: "אפינו עוגה" → עוגה, קמח, ביצה, תנור, לערבב, לאכול.',
  'דוגמה: "למדנו על הכהן הגדול בבית המקדש" → כהן, בית המקדש, ירושלים, בגדים, מנורה, ללמוד, מורה.',
  "המילה המרכזית במשפט חייבת להופיע ראשונה (למשל ים).",
  "אל תבחר/י מילות ליבה כלליות (רוצה, עוד, די, טוב, כן, לא, ללכת) ולא רגשות כלליים (שמח, כיף) — רק אם הם ממש חלק ממה שקרה.",
  "כל מילה: מילה אחת או שתיים בעברית פשוטה, בצורה הבסיסית (ים, לא לים; ללכת, לא הלכנו), עם אימוג'י אחד שמראה אותה בבירור.",
  'החזר/י אך ורק JSON תקין, בלי markdown: {"words":[{"label":"ים","emoji":"🌊"}]}',
].join(" ");

const cleanLabel = (value: unknown): string =>
  typeof value === "string"
    ? value
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20)
    : "";

const parseRelated = (raw: string): StoryWord[] | null => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { words?: unknown };
    const words = (Array.isArray(parsed.words) ? parsed.words : [])
      .map((entry): StoryWord | null => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const label = cleanLabel(record.label);
        if (!/^[א-ת\s״׳"'-]+$/.test(label)) return null;
        const emoji = typeof record.emoji === "string" ? record.emoji.trim().slice(0, 12) : "";
        return { label, emoji: emoji || "⭐" };
      })
      .filter((word): word is StoryWord => Boolean(word));
    return words.length >= 3 ? words : null;
  } catch {
    return null;
  }
};

// A real pictogram for a word that isn't on the board (like the typed words).
const findPictogram = async (word: string): Promise<number | undefined> => {
  try {
    const response = await fetch(`https://api.arasaac.org/v1/pictograms/he/search/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return undefined;
    const results = (await response.json()) as Array<{ _id?: number }>;
    return typeof results[0]?._id === "number" ? results[0]._id : undefined;
  } catch {
    return undefined;
  }
};

// Concrete symbols related to what was done — only the symbols come from the
// AI, the sentence stays as the teacher wrote it.
const relatedWords = async (
  sentence: string,
  vocabulary: Array<{ id: string; label: string; emoji: string }>,
  place: "school" | "home",
): Promise<StoryWord[]> => {
  const byId = new Map(vocabulary.map((item) => [item.id, item]));
  const message = `המקום: ${place === "home" ? "בבית" : "בבית הספר"}\nהמשפט: ${sentence}`;
  const providers = [
    getGeminiApiKey()
      ? () =>
          geminiChat({ history: [], message, systemPrompt: RELATED_PROMPT, temperature: 0.2, maxOutputTokens: 800 })
      : null,
    getGroqApiKey() ? () => groqChat({ history: [], message, systemPrompt: RELATED_PROMPT, temperature: 0.2 }) : null,
  ];
  for (const run of providers) {
    if (!run) continue;
    const answer = await run();
    const words = answer.ok ? parseRelated(answer.text) : null;
    if (!words) continue;
    // A word that is on the board uses the child's own symbol (and photo).
    const resolved = words.map((word) => matchWords(word.label, vocabulary)[0] ?? word);
    return Promise.all(
      resolved.map(async (word) => {
        if (word.symbolId) return word;
        const pictogramId = await findPictogram(word.label);
        return pictogramId ? { ...word, pictogramId } : word;
      }),
    );
  }
  return FALLBACK_EVENT_SYMBOLS.school
    .map((id) => byId.get(id))
    .filter((symbol): symbol is { id: string; label: string; emoji: string } => Boolean(symbol))
    .map((symbol) => ({ label: symbol.label, emoji: symbol.emoji || "⭐", symbolId: symbol.id }));
};

// The related words in the AI's order (the main word first), then the
// sentence's own board words, without repeats.
const storyWords = async (
  sentence: string,
  vocabulary: Array<{ id: string; label: string; emoji: string }>,
  place: "school" | "home" = "school",
): Promise<StoryWord[]> => {
  const words: StoryWord[] = [];
  for (const word of [...(await relatedWords(sentence, vocabulary, place)), ...matchWords(sentence, vocabulary)]) {
    if (words.length >= MAX_WORDS) break;
    if (words.some((item) => (word.symbolId ? item.symbolId === word.symbolId : item.label === word.label))) continue;
    words.push(word);
  }
  return words;
};

const readToday = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
  date: string,
): Promise<{ items: StoredItem[]; error?: string }> => {
  const result = await client
    .from("daily_stories")
    .select("items_json")
    .eq("child_id", childId)
    .eq("story_date", date)
    .maybeSingle();
  if (result.error) return { items: [], error: missingTable(result.error.message) };
  return { items: (result.data?.items_json as StoredItem[] | undefined) ?? [] };
};

const saveToday = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
  date: string,
  items: StoredItem[],
  userId: string,
): Promise<NextResponse> => {
  const saved = await client
    .from("daily_stories")
    .upsert(
      { child_id: childId, story_date: date, items_json: items, created_by: userId },
      { onConflict: "child_id,story_date" },
    )
    .select("story_date, items_json")
    .single();
  if (saved.error) return NextResponse.json({ error: missingTable(saved.error.message) }, { status: 500 });
  return NextResponse.json({
    story: { date: saved.data.story_date, items: await withPhotoLinks(saved.data.items_json as StoredItem[]) },
  });
};

// action "add" (default): one photo → a sentence, appended to today's story.
// action "remove": removes photo number `index` from today's story.
// action "fillWords": adds symbols to photos of the story of `date` that have none.
export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }
  const childId = text(body.childId, 60);
  const auth = await authorize(request, childId);
  if ("error" in auth) return auth.error;
  const date = localIsoDate();
  const admin = createAdminSupabaseClient();

  const current = await readToday(auth.client, childId, date);
  if (current.error) return NextResponse.json({ error: current.error }, { status: 500 });

  if (body.action === "fillWords") {
    const storyDate = /^\d{4}-\d{2}-\d{2}$/.test(text(body.date, 10)) ? text(body.date, 10) : date;
    const story = await readToday(auth.client, childId, storyDate);
    if (story.error) return NextResponse.json({ error: story.error }, { status: 500 });
    const vocabulary = readVocabulary(body.vocabulary);
    if (story.items.length === 0 || vocabulary.length === 0) return NextResponse.json({ story: null });
    const items = await Promise.all(
      story.items.map(async (item) =>
        needsWords(item)
          ? { ...item, words: await storyWords(item.sentence, vocabulary, item.place), wordsVersion: WORDS_VERSION }
          : item,
      ),
    );
    return saveToday(auth.client, childId, storyDate, items, auth.userId);
  }

  if (body.action === "remove") {
    const index = Number(body.index);
    const removed = current.items[index];
    if (!removed) return NextResponse.json({ error: "התמונה לא נמצאה." }, { status: 404 });
    if (removed.photoPath && admin) await admin.storage.from(BUCKET).remove([removed.photoPath]);
    return saveToday(
      auth.client,
      childId,
      date,
      current.items.filter((_, i) => i !== index),
      auth.userId,
    );
  }

  const photo = typeof body.photo === "string" ? body.photo : "";
  const imageMatch = photo.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!imageMatch) return NextResponse.json({ error: "צריך תמונה." }, { status: 400 });
  if (photo.length > MAX_PHOTO_CHARS) return NextResponse.json({ error: "התמונה גדולה מדי." }, { status: 413 });
  const sentence = text(body.sentence, 140);
  if (!sentence) return NextResponse.json({ error: "כתבו משפט מתחת לתמונה." }, { status: 400 });

  const vocabulary = readVocabulary(body.vocabulary);
  const place = body.place === "home" ? "home" : "school";
  const item: StoredItem = {
    sentence,
    place,
    words: await storyWords(sentence, vocabulary, place),
    wordsVersion: WORDS_VERSION,
  };

  if (admin) {
    try {
      await ensureBucket(admin);
      const path = `${childId}/${date}/${crypto.randomUUID()}.jpg`;
      const uploaded = await admin.storage
        .from(BUCKET)
        .upload(path, Buffer.from(imageMatch[2], "base64"), { contentType: imageMatch[1], upsert: false });
      if (uploaded.error) throw new Error(uploaded.error.message);
      item.photoPath = path;
    } catch (error) {
      return NextResponse.json(
        { error: `לא הצלחנו לשמור את התמונה ב-Supabase: ${error instanceof Error ? error.message : ""}` },
        { status: 500 },
      );
    }
  } else {
    item.photo = photo;
  }

  return saveToday(auth.client, childId, date, [...current.items, item], auth.userId);
}
