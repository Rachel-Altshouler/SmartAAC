// "בואו נספר סיפור": one connected story told step by step. At each step the
// child picks the word that continues the story — "הלכתי לגן החיות וראיתי
// [אריה]. היה לו זנב ארוך, והוא [שאג] בקול." — so every sentence builds on
// the one before instead of jumping between unrelated topics.

export type StoryWord = { label: string; emoji: string };

export type StoryStep = {
  before: string;
  answer: StoryWord;
  after: string;
  // Two words that clearly do NOT fit this spot in the sentence.
  wrong: [StoryWord, StoryWord];
};

export type Story = {
  id: string;
  title: string;
  emoji: string;
  steps: StoryStep[];
};

export type StoryChoiceKind = "correct" | "wrong";

export type StoryChoice = { word: StoryWord; kind: StoryChoiceKind };

const w = (label: string, emoji: string): StoryWord => ({ label, emoji });

export const LOCAL_STORIES: Story[] = [
  {
    id: "zoo",
    title: "יום בגן החיות",
    emoji: "🦁",
    steps: [
      { before: "הלכתי לגן החיות וראיתי", answer: w("אריה", "🦁"), after: ".", wrong: [w("כפית", "🥄"), w("מטרייה", "☂️")] },
      { before: "היה לו זנב ארוך, והוא", answer: w("שאג", "📢"), after: "בקול.", wrong: [w("מחשב", "💻"), w("עוגה", "🎂")] },
      { before: "אחר כך ראינו", answer: w("פיל", "🐘"), after: "גדול.", wrong: [w("עיפרון", "✏️"), w("דלת", "🚪")] },
      { before: "לפיל היה חדק ארוך, והוא שתה בו", answer: w("מים", "💧"), after: ".", wrong: [w("נעליים", "👟"), w("מכונית", "🚗")] },
      { before: "בסוף היינו עייפים וחזרנו הביתה ב", answer: w("אוטובוס", "🚌"), after: ".", wrong: [w("בננה", "🍌"), w("גרב", "🧦")] },
    ],
  },
  {
    id: "birthday",
    title: "יום ההולדת שלי",
    emoji: "🎂",
    steps: [
      { before: "היום יש לי", answer: w("יום הולדת", "🥳"), after: "!", wrong: [w("מטאטא", "🧹"), w("דג", "🐟")] },
      { before: "אמא אפתה לי", answer: w("עוגה", "🍰"), after: "גדולה.", wrong: [w("נעל", "👟"), w("מכונית", "🚗")] },
      { before: "על העוגה הדלקנו", answer: w("נרות", "🕯️"), after: ".", wrong: [w("גלגלים", "🛞"), w("מספריים", "✂️")] },
      { before: "ניפחנו המון", answer: w("בלונים", "🎈"), after: "צבעוניים.", wrong: [w("אבנים", "🪨"), w("כפיות", "🥄")] },
      { before: "החברים שלי נתנו לי", answer: w("מתנה", "🎁"), after: ", והייתי מאוד שמח.", wrong: [w("גשם", "🌧️"), w("ענן", "☁️")] },
    ],
  },
  {
    id: "beach",
    title: "בים",
    emoji: "🏖️",
    steps: [
      { before: "בקיץ נסענו אל", answer: w("הים", "🌊"), after: ".", wrong: [w("המקרר", "🧊"), w("הגרב", "🧦")] },
      { before: "על החוף בנינו מהחול", answer: w("ארמון", "🏰"), after: "גדול.", wrong: [w("מרק", "🍲"), w("טלפון", "📱")] },
      { before: "נכנסנו למים וראינו", answer: w("דג", "🐟"), after: "קטן ששוחה.", wrong: [w("מיטה", "🛏️"), w("עוגה", "🎂")] },
      { before: "השמש הייתה חזקה, אז שמנו על הראש", answer: w("כובע", "👒"), after: ".", wrong: [w("צלחת", "🍽️"), w("ספר", "📕")] },
      { before: "בסוף היום אכלנו", answer: w("גלידה", "🍦"), after: "קרה וטעימה.", wrong: [w("אבן", "🪨"), w("נעל", "👟")] },
    ],
  },
  {
    id: "kindergarten",
    title: "יום בגן",
    emoji: "🏫",
    steps: [
      { before: "בבוקר הלכתי אל", answer: w("הגן", "🏫"), after: ".", wrong: [w("הירח", "🌙"), w("הענן", "☁️")] },
      { before: "הגננת הקריאה לנו", answer: w("סיפור", "📖"), after: "מצחיק.", wrong: [w("בננה", "🍌"), w("מכונית", "🚗")] },
      { before: "בחצר שיחקנו עם", answer: w("כדור", "⚽"), after: ".", wrong: [w("מרק", "🍲"), w("מברשת שיניים", "🪥")] },
      { before: "בצהריים אכלנו", answer: w("כריך", "🥪"), after: "עם גבינה.", wrong: [w("כיסא", "🪑"), w("נעל", "👟")] },
      { before: "ובסוף אבא בא ולקח אותי הביתה ב", answer: w("מכונית", "🚗"), after: ".", wrong: [w("עוגה", "🎂"), w("כפית", "🥄")] },
    ],
  },
];

const shuffle = <T,>(items: T[]): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex] as T, next[index] as T];
  }
  return next;
};

export const storyStepChoices = (step: StoryStep): StoryChoice[] =>
  shuffle([
    { word: step.answer, kind: "correct" as const },
    { word: step.wrong[0], kind: "wrong" as const },
    { word: step.wrong[1], kind: "wrong" as const },
  ]);

// The full sentence for a step once its word is filled in ("ב" + "אוטובוס"
// joins without a space, like Hebrew prefixes do).
export const storyStepSentence = (step: StoryStep): string => {
  // A one-letter prefix ("ב", "ל") joins the word without a space: "באוטובוס".
  const lastWord = step.before.trim().split(" ").pop() ?? "";
  const joiner = lastWord.length === 1 ? "" : " ";
  const after = /^[.,!?]/.test(step.after) ? step.after : ` ${step.after}`;
  return `${step.before.trim()}${joiner}${step.answer.label}${after}`.trim();
};

// Just the rest of the sentence from the chosen word on ("שאג בקול",
// "באוטובוס") — read right after a correct first pick, since the child just
// heard the beginning of the sentence.
export const storyStepContinuation = (step: StoryStep): string => {
  const lastWord = step.before.trim().split(" ").pop() ?? "";
  const prefix = lastWord.length === 1 ? lastWord : "";
  const after = /^[.,!?]/.test(step.after) ? step.after : ` ${step.after}`;
  return `${prefix}${step.answer.label}${after}`.trim();
};

export const pickLocalStory = (excludeId?: string): Story => {
  const pool = LOCAL_STORIES.filter((story) => story.id !== excludeId);
  return shuffle(pool.length ? pool : LOCAL_STORIES)[0] as Story;
};

export const STORY_ENDING_LINE = "איזה סיפור כיף יצא לנו! 🎉";

export const STORY_FEEDBACK = {
  correct: "כל הכבוד! זו המילה שממשיכה את הסיפור.",
  wrong: "המילה הזאת לא מתאימה לסיפור. בואו ננסה מילה אחרת.",
} as const;

// Validates a story the AI generated, so a malformed answer never reaches the
// child — the caller falls back to a local story instead.
export const parseStory = (raw: unknown): Story | null => {
  const record = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const word = (value: unknown): StoryWord | null => {
    const item = (value ?? {}) as Record<string, unknown>;
    const label = text(item.label, 30);
    return label ? { label, emoji: text(item.emoji, 12) || "⭐" } : null;
  };

  const steps = (Array.isArray(record.steps) ? record.steps : [])
    .map((value): StoryStep | null => {
      const item = (value ?? {}) as Record<string, unknown>;
      const before = text(item.before, 120);
      const answer = word(item.answer);
      const wrong = (Array.isArray(item.wrong) ? item.wrong : []).map(word).filter(Boolean) as StoryWord[];
      if (!before || !answer || wrong.length < 2) return null;
      const [first, second] = wrong as [StoryWord, StoryWord];
      if ([first.label, second.label].includes(answer.label)) return null;
      return { before, answer, after: text(item.after, 80), wrong: [first, second] };
    })
    .filter((step): step is StoryStep => Boolean(step))
    .slice(0, 6);

  const title = text(record.title, 40);
  if (!title || steps.length < 3) return null;
  return { id: `ai-${Date.now()}`, title, emoji: text(record.emoji, 12) || "📖", steps };
};
