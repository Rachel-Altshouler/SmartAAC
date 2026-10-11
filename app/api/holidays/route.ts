import { NextResponse } from "next/server";

// Israeli holidays and national days for the calendar, from Hebcal (free,
// Hebrew names). Cached for a day, so the calendar "checks" once a day.

type HebcalItem = { date?: string; category?: string; subcat?: string; hebrew?: string; title?: string };

export type Holiday = { date: string; title: string; emoji: string };

const EMOJI: Array<[RegExp, string]> = [
  [/חנוכה/, "🕎"],
  [/פורים/, "🎭"],
  [/פסח/, "🍷"],
  [/סוכות|הושענא|שמיני עצרת|שמחת תורה/, "🌿"],
  [/ראש השנה/, "🍎"],
  [/כיפור/, "🕊️"],
  [/שבועות/, "🌾"],
  [/ט״ו בשבט|טו בשבט/, "🌳"],
  [/ל״ג בעומר|לג בעומר/, "🔥"],
  [/עצמאות/, "🇮🇱"],
  [/זיכרון|זכרון|השואה/, "🕯️"],
  [/תשעה באב/, "🕯️"],
  [/ט״ו באב/, "❤️"],
  [/ירושלים/, "🏙️"],
];

const emojiFor = (title: string): string => EMOJI.find(([pattern]) => pattern.test(title))?.[1] ?? "✨";

// "חנוכה: ג׳ נרות" and "סוכות ו׳ (חוה״מ)" → "חנוכה", "סוכות": the holiday's name on each of its days.
const baseName = (title: string): string =>
  title
    .replace(/\s*\(.*?\)\s*/g, " ")
    .split(":")[0]
    .replace(/\d+/g, "")
    .trim()
    .replace(/\s+[א-ת]׳$/, "")
    .trim();

// Days a child doesn't need on the calendar: eves (the holiday itself is
// there), and minor dates few families mark.
const SKIP = /^ערב |סליחות|למעשר|פסח שני|שושן|חג הבנות|קטן|סיגד/;

export async function GET(): Promise<NextResponse> {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const end = new Date();
  end.setMonth(end.getMonth() + 12);
  const iso = (date: Date): string => date.toISOString().slice(0, 10);

  const url =
    "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&ss=off&mf=off&c=off&geo=none&i=on&lg=he" +
    `&start=${iso(start)}&end=${iso(end)}`;

  try {
    const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return NextResponse.json({ holidays: [] });
    const data = (await response.json()) as { items?: HebcalItem[] };

    const holidays: Holiday[] = [];
    const seen = new Set<string>();
    for (const item of data.items ?? []) {
      if (item.category !== "holiday" || !item.date) continue;
      if (!["major", "minor", "modern"].includes(item.subcat ?? "")) continue;
      const title = (item.hebrew || item.title || "").trim();
      if (!title || SKIP.test(title)) continue;
      const base = baseName(title);
      const date = item.date.slice(0, 10);
      // a holiday that runs several days shows its name on every day (once per day)
      if (seen.has(`${date}|${base}`)) continue;
      seen.add(`${date}|${base}`);
      holidays.push({ date, title: base, emoji: emojiFor(base) });
    }
    return NextResponse.json({ holidays });
  } catch {
    return NextResponse.json({ holidays: [] });
  }
}
