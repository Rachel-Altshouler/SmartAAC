// Per-event vocabulary: for "טיול לגן החיות" the child gets אריה, פיל,
// אוטובוס, רוצה, מפחד… as symbols to tap — they talk about the event with
// symbols instead of choosing from ready-made sentences. The AI picks them
// from the child's own board vocabulary, plus a few words the board lacks.

export type EventSymbolsResult = {
  symbolIds: string[];
  extraWords: Array<{ label: string; emoji: string }>;
};

export const MAX_EVENT_SYMBOLS = 12;
export const MAX_EXTRA_WORDS = 6;

// Without AI: a sensible set per event type, from the built-in board.
export const FALLBACK_EVENT_SYMBOLS: Record<string, string[]> = {
  trip: ["go", "car", "happy", "afraid", "tired", "water", "eat", "toilet"],
  birthday: ["cake", "happy", "fun", "friend", "eat", "love", "excited"],
  school: ["class", "book", "draw", "friend", "help", "question", "play"],
  family: ["mom", "dad", "brother", "sister", "love", "play", "happy"],
  special: ["happy", "excited", "afraid", "question", "help"],
  custom: ["happy", "afraid", "question", "help", "go"],
};

export const FALLBACK_CORE_SYMBOLS = ["want", "more", "stop", "help", "yes", "no"];

export const buildEventSymbolsPrompt = (): string =>
  [
    "את/ה מומחה/ית לתקשורת תומכת (AAC) לילדים שלא מדברים.",
    "תקבל/י אירוע בחיים של ילד/ה ואת רשימת הסמלים שיש בלוח שלו/ה (מזהה ומילה).",
    "בחר/י 8 עד 12 סמלים מהרשימה שהכי יעזרו לילד/ה לדבר על האירוע: לבקש, לספר, לשאול ולהביע רגש.",
    "שלב/י אנשים, מקומות, חפצים ופעולות שקשורים לאירוע, רגשות מתאימים, ו-2 עד 3 מילות ליבה שימושיות (רוצה, עוד, די, עזרה).",
    "התאם/י לזמן: לפני האירוע (ציפייה, הכנה, חשש), ביום האירוע (מה קורה עכשיו), אחרי האירוע (לספר מה היה).",
    "אם חסרות ברשימה מילים חשובות לאירוע (למשל אריה ופיל לגן חיות), הוסף/י עד 6 ב-extraWords: מילה אחת או שתיים בעברית פשוטה, עם אימוג'י אחד שמראה אותה בבירור.",
    "סדר/י מהחשוב לפחות חשוב. השתמש/י רק במזהים שמופיעים ברשימה.",
    'החזר/י אך ורק JSON תקין, בלי markdown: {"symbolIds":["..."],"extraWords":[{"label":"...","emoji":"..."}]}',
  ].join(" ");

export const parseEventSymbols = (raw: string, knownIds: Set<string>): EventSymbolsResult | null => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { symbolIds?: unknown; extraWords?: unknown };
    const symbolIds = [
      ...new Set(
        (Array.isArray(parsed.symbolIds) ? parsed.symbolIds : []).filter(
          (id): id is string => typeof id === "string" && knownIds.has(id),
        ),
      ),
    ].slice(0, MAX_EVENT_SYMBOLS);
    const extraWords = (Array.isArray(parsed.extraWords) ? parsed.extraWords : [])
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        // The model sometimes repeats the emoji inside the word ("אריה 🦁")
        // or slips a letter from another script in ("גرافה") — strip the
        // first, drop the second.
        const label =
          typeof record.label === "string"
            ? record.label
                .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 20)
            : "";
        const emoji = typeof record.emoji === "string" ? record.emoji.trim().slice(0, 12) : "";
        return { label, emoji: emoji || "⭐" };
      })
      .filter((word) => /^[א-ת\s״׳"'-]+$/.test(word.label))
      .slice(0, MAX_EXTRA_WORDS);
    return symbolIds.length >= 3 ? { symbolIds, extraWords } : null;
  } catch {
    return null;
  }
};
