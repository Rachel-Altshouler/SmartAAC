import {
  type AacSymbol,
  type CalendarEvent,
  type DemoState,
  symbolById,
  weeklyTopics,
} from "@/lib/demo-data";

export type ContextSuggestion = AacSymbol & {
  reason: string;
  score: number;
};

const startOfToday = (): number => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const daysFromToday = (dateValue: string): number => {
  const target = new Date(dateValue);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - startOfToday()) / 86_400_000);
};

const getWeekBounds = (): { start: number; end: number } => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start: start.getTime(), end: end.getTime() };
};

export const getEventsThisWeek = (state: DemoState): CalendarEvent[] => {
  const { start, end } = getWeekBounds();

  return state.events
    .filter((event) => {
      const eventTime = new Date(event.date).getTime();
      return eventTime >= start && eventTime <= end;
    })
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
};

const getTimeSignals = (): { label: string; symbolIds: string[] } => {
  const hour = new Date().getHours();

  if (hour < 11) {
    return { label: "בוקר", symbolIds: ["milk", "bread"] };
  }

  if (hour < 15) {
    return { label: "צהריים", symbolIds: ["eat", "water"] };
  }

  if (hour < 19) {
    return { label: "אחר הצהריים", symbolIds: ["play", "ball"] };
  }

  return { label: "ערב", symbolIds: ["sleep", "tired"] };
};

const eventSignals: Record<DemoState["events"][number]["type"], string[]> = {
  trip: ["happy", "go"],
  birthday: ["cake", "happy"],
  school: ["class", "book"],
  family: ["mom", "dad", "love"],
  special: ["happy", "more"],
  custom: ["happy", "more"],
};

export type SentenceSuggestion = { text: string; emoji: string };

const eventEmoji: Record<CalendarEvent["type"], string> = {
  trip: "🚌",
  birthday: "🎂",
  school: "🏫",
  family: "👪",
  special: "✨",
  custom: "📌",
};

const WEEKLY_TOPIC_SENTENCES: Record<string, SentenceSuggestion[]> = {
  colors: [
    { text: "אני רוצה לצייר", emoji: "🎨" },
    { text: "איזה צבע יפה!", emoji: "🌈" },
    { text: "בואו נצבע ביחד", emoji: "🖍️" },
    { text: "מה הצבע האהוב עליך?", emoji: "❓" },
  ],
  feelings: [
    { text: "אני מרגיש שמח היום", emoji: "😀" },
    { text: "אני קצת עצוב", emoji: "😢" },
    { text: "מה אתה מרגיש עכשיו?", emoji: "❓" },
    { text: "אני אוהב אותך", emoji: "❤️" },
  ],
  food: [
    { text: "אני רוצה לאכול", emoji: "🍽️" },
    { text: "זה טעים!", emoji: "😋" },
    { text: "אני צמא, אפשר מים?", emoji: "💧" },
    { text: "מה יש לאכול היום?", emoji: "❓" },
  ],
  family: [
    { text: "אני אוהב את המשפחה שלי", emoji: "👪" },
    { text: "איפה אמא?", emoji: "👩" },
    { text: "בואו נשחק עם אבא", emoji: "👨" },
    { text: "אני מתגעגע לסבתא", emoji: "👵" },
  ],
  school: [
    { text: "אני הולך לבית הספר", emoji: "🏫" },
    { text: "אני אוהב ללמוד", emoji: "📖" },
    { text: "מי המורה שלי היום?", emoji: "❓" },
    { text: "בואו נכתוב ביחד", emoji: "✏️" },
  ],
};

export const getWeeklyTopicSentences = (topicId: string): SentenceSuggestion[] =>
  WEEKLY_TOPIC_SENTENCES[topicId] ?? [];

export const buildFallbackSentenceSuggestions = (state: DemoState): SentenceSuggestion[] =>
  getEventsThisWeek(state)
    .slice(0, 6)
    .map((event) => {
      const distance = daysFromToday(event.date);
      const text =
        distance > 0
          ? `עוד ${distance} ${distance === 1 ? "יום" : "ימים"}: ${event.title}`
          : distance === 0
            ? `היום: ${event.title}`
            : `איך היה ב${event.title}?`;
      return { text, emoji: event.customEmoji || eventEmoji[event.type] };
    });

export const buildContextSuggestions = (state: DemoState): ContextSuggestion[] => {
  const scores = new Map<string, { score: number; reason: string }>();

  const addScore = (symbolId: string, score: number, reason: string): void => {
    const symbol = symbolById[symbolId];

    if (!symbol || state.hiddenSymbolIds.includes(symbolId)) {
      return;
    }

    const existing = scores.get(symbolId);
    scores.set(symbolId, {
      score: (existing?.score ?? 0) + score,
      reason: existing?.reason ?? reason,
    });
  };

  const time = getTimeSignals();
  time.symbolIds.forEach((symbolId) => addScore(symbolId, 5, time.label));

  const topic = [...weeklyTopics, ...(state.customTopics ?? [])].find(
    (item) => item.id === state.weeklyTopicId,
  );
  topic?.symbolIds.forEach((symbolId) => addScore(symbolId, 4, "נושא השבוע"));

  state.events.forEach((event) => {
    const distance = daysFromToday(event.date);

    if (distance >= 0 && distance <= 2) {
      eventSignals[event.type].forEach((symbolId) => addScore(symbolId, 6, "אירוע קרוב"));
    }

    if (distance < 0 && distance >= -2) {
      eventSignals[event.type].forEach((symbolId) => addScore(symbolId, 4, "אחרי אירוע"));
    }
  });

  Object.entries(state.usageBySymbolId)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .forEach(([symbolId]) => addScore(symbolId, 3, "שימוש תכוף"));

  const limit = state.level === "low" ? 4 : state.level === "high" ? 8 : 6;

  return Array.from(scores.entries())
    .map(([symbolId, value]) => ({
      ...symbolById[symbolId],
      score: value.score,
      reason: value.reason,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};
