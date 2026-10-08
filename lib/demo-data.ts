export type FunctionalityLevel = "low" | "medium" | "high";

export type SymbolCategory = {
  id: string;
  label: string;
  emoji: string;
};

// Fitzgerald-key-style grammatical coloring: pronoun/verb/question/noun/
// feeling/social, matching the visual convention of commercial AAC boards.
export type WordType = "pronoun" | "verb" | "question" | "noun" | "feeling" | "social";

export type AacSymbol = {
  id: string;
  label: string;
  emoji: string;
  categoryId: string;
  topicIds?: string[];
  imageUrl?: string;
  wordType?: WordType;
  // ARASAAC pictogram id (static.arasaac.org) — real pictogram icon shown
  // instead of the emoji when present. ARASAAC pictograms are CC BY-NC-SA:
  // non-commercial use only, with required attribution to Sergio Palao /
  // Gobierno de Aragón / ARASAAC (see the credit line in the dashboard).
  pictogramId?: number;
};

export const wordTypeColors: Record<WordType, string> = {
  pronoun: "border-orange-400 bg-orange-100",
  verb: "border-green-400 bg-green-100",
  question: "border-sky-400 bg-sky-100",
  noun: "border-yellow-400 bg-yellow-100",
  feeling: "border-pink-400 bg-pink-100",
  social: "border-purple-400 bg-purple-100",
};

export const arasaacImageUrl = (pictogramId: number): string =>
  `https://static.arasaac.org/pictograms/${pictogramId}/${pictogramId}_300.png`;

export type CalendarEvent = {
  id: string;
  type: "trip" | "birthday" | "school" | "family" | "special";
  title: string;
  date: string;
};

export type WeeklyTopic = {
  id: string;
  label: string;
  emoji: string;
  symbolIds: string[];
};

export type DemoState = {
  parentName: string;
  parentEmail: string;
  teacherInviteCode: string;
  activeChildName: string;
  dashboardRole?: "parent" | "teacher";
  // True for whoever created the child profile (parent or teacher) — they
  // own the access code and can invite more parents/teachers. False for
  // someone who joined with a code.
  isProfileCreator?: boolean;
  // "מתקן העברית": the child's gender for spoken grammar, and whether tapped
  // words are turned into a corrected sentence before being read aloud.
  childGender?: "boy" | "girl";
  smartGrammar?: boolean;
  isRegisteredInSupabase: boolean;
  supabaseUserId?: string;
  supabaseChildId?: string;
  connectedTeacherEmail?: string;
  pendingTeacherInvite?: boolean;
  linkedChildren: Array<{ id: string; name: string }>;
  level: FunctionalityLevel;
  speechRate: number;
  weeklyTopicId: string;
  coreSymbolIds: string[];
  hiddenSymbolIds: string[];
  favoriteSymbolIds: string[];
  enabledCategoryIds: string[];
  customSymbols: AacSymbol[];
  customCategories: SymbolCategory[];
  symbolImages: Record<string, string>;
  symbolLabelOverrides: Record<string, string>;
  usageBySymbolId: Record<string, number>;
  sentenceCount: number;
  sentenceLengths: number[];
  categoryUsageById: Record<string, number>;
  topicUsageById: Record<string, number>;
  events: CalendarEvent[];
};

export type QuickPhrase = {
  text: string;
  emoji: string;
  symbolIds: string[];
};

export const categories: SymbolCategory[] = [
  { id: "feelings", label: "רגשות", emoji: "😊" },
  { id: "food", label: "אוכל", emoji: "🍎" },
  { id: "people", label: "אנשים", emoji: "👪" },
  { id: "actions", label: "פעולות", emoji: "🏃" },
  { id: "school", label: "בית ספר", emoji: "🏫" },
  { id: "games", label: "משחקים", emoji: "⚽" },
  { id: "colors", label: "צבעים", emoji: "🎨" },
];

export const keshetCoreSymbolIds = [
  "i",
  "want",
  "yes",
  "no",
  "help",
  "more",
  "done",
  "toilet",
  "water",
  "stop",
];

export const keshetCategoryOrder = [
  "people",
  "feelings",
  "actions",
  "food",
  "school",
  "games",
] as const;

// Same preview count for every functionality level — only which symbols
// appear changes with level/customization, not how many.
export const keshetPreviewCount: Record<FunctionalityLevel, number> = {
  low: 6,
  medium: 6,
  high: 6,
};

export const symbols: AacSymbol[] = [
  { id: "i", label: "אני", emoji: "🧍", categoryId: "core", wordType: "pronoun", pictogramId: 2617 },
  { id: "you", label: "אתה", emoji: "🫵", categoryId: "core", wordType: "pronoun", pictogramId: 2608 },
  { id: "we", label: "אנחנו", emoji: "👥", categoryId: "core", wordType: "pronoun", pictogramId: 7183 },
  { id: "yes", label: "כן", emoji: "👍", categoryId: "core", wordType: "social", pictogramId: 5584 },
  { id: "no", label: "לא", emoji: "👎", categoryId: "core", wordType: "social", pictogramId: 5525 },
  { id: "help", label: "עזרה", emoji: "🆘", categoryId: "core", wordType: "social", pictogramId: 12252 },
  { id: "want", label: "רוצה", emoji: "🙋", categoryId: "core", wordType: "verb", pictogramId: 5441 },
  { id: "more", label: "עוד", emoji: "➕", categoryId: "core", wordType: "social", pictogramId: 26913 },
  { id: "done", label: "סיימתי", emoji: "🏁", categoryId: "core", wordType: "social", pictogramId: 28429 },
  { id: "question", label: "שאלה", emoji: "❓", categoryId: "core", wordType: "noun", pictogramId: 7217 },
  { id: "what", label: "מה", emoji: "❔", categoryId: "core", wordType: "question", pictogramId: 22620 },
  { id: "where", label: "איפה", emoji: "📍", categoryId: "core", wordType: "question", pictogramId: 7764 },
  { id: "when", label: "מתי", emoji: "🕒", categoryId: "core", wordType: "question", pictogramId: 24053 },
  { id: "now", label: "עכשיו", emoji: "⏱️", categoryId: "core", wordType: "social", pictogramId: 9848 },
  { id: "again", label: "שוב", emoji: "🔁", categoryId: "core", wordType: "social", pictogramId: 37162 },
  { id: "stop", label: "די", emoji: "✋", categoryId: "core", wordType: "social", pictogramId: 7195 },
  { id: "good", label: "טוב", emoji: "🙂", categoryId: "core", wordType: "feeling", pictogramId: 4581 },
  { id: "bad", label: "לא טוב", emoji: "☹️", categoryId: "core", wordType: "feeling", pictogramId: 5504 },
  { id: "please", label: "בבקשה", emoji: "🙏", categoryId: "core", wordType: "social", pictogramId: 8194 },
  { id: "thanks", label: "תודה", emoji: "🙏", categoryId: "core", wordType: "social", pictogramId: 8128 },
  { id: "sorry", label: "סליחה", emoji: "😔", categoryId: "core", wordType: "social", pictogramId: 11625 },
  { id: "mine", label: "שלי", emoji: "🫱", categoryId: "core", wordType: "pronoun", pictogramId: 12264 },
  { id: "here", label: "כאן", emoji: "📍", categoryId: "core", wordType: "social", pictogramId: 5375 },
  { id: "there", label: "שם", emoji: "👉", categoryId: "core", wordType: "social", pictogramId: 5375 },
  { id: "happy", label: "שמח", emoji: "😀", categoryId: "feelings", wordType: "feeling", pictogramId: 3245 },
  { id: "sad", label: "עצוב", emoji: "😢", categoryId: "feelings", wordType: "feeling", pictogramId: 2606 },
  { id: "angry", label: "כועס", emoji: "😠", categoryId: "feelings", wordType: "feeling", pictogramId: 2374 },
  { id: "tired", label: "עייף", emoji: "😴", categoryId: "feelings", wordType: "feeling", pictogramId: 2314 },
  { id: "toilet", label: "שירותים", emoji: "🚽", categoryId: "core", wordType: "noun", pictogramId: 2430 },
  { id: "love", label: "אוהב", emoji: "❤️", categoryId: "feelings", wordType: "feeling", pictogramId: 6600 },
  { id: "afraid", label: "מפחד", emoji: "😟", categoryId: "feelings", wordType: "feeling", pictogramId: 2261 },
  { id: "hurt", label: "כואב", emoji: "🤕", categoryId: "feelings", wordType: "feeling", pictogramId: 30620 },
  { id: "sick", label: "חולה", emoji: "🤒", categoryId: "feelings", wordType: "feeling", pictogramId: 3308 },
  { id: "fun", label: "כיף", emoji: "🎉", categoryId: "feelings", wordType: "feeling", pictogramId: 35197 },
  { id: "excited", label: "נרגש", emoji: "🤩", categoryId: "feelings", wordType: "feeling", pictogramId: 39090 },
  { id: "bored", label: "משועמם", emoji: "😑", categoryId: "feelings", wordType: "feeling", pictogramId: 2245 },
  { id: "surprised", label: "מופתע", emoji: "😲", categoryId: "feelings", wordType: "feeling", pictogramId: 2574 },
  { id: "calm", label: "רגוע", emoji: "😌", categoryId: "feelings", wordType: "feeling", pictogramId: 31310 },
  { id: "shy", label: "ביישן", emoji: "😳", categoryId: "feelings", wordType: "feeling", pictogramId: 8707 },
  { id: "proud", label: "גאה", emoji: "😊", categoryId: "feelings", wordType: "feeling", pictogramId: 31408 },
  { id: "water", label: "מים", emoji: "💧", categoryId: "food", wordType: "noun", pictogramId: 2248 },
  { id: "bread", label: "לחם", emoji: "🍞", categoryId: "food", wordType: "noun", pictogramId: 2494 },
  { id: "apple", label: "תפוח", emoji: "🍎", categoryId: "food", wordType: "noun", pictogramId: 2462 },
  { id: "milk", label: "חלב", emoji: "🥛", categoryId: "food", wordType: "noun", pictogramId: 2445 },
  { id: "cake", label: "עוגה", emoji: "🍰", categoryId: "food", wordType: "noun", pictogramId: 2502 },
  { id: "banana", label: "בננה", emoji: "🍌", categoryId: "food", wordType: "noun", pictogramId: 2530 },
  { id: "sandwich", label: "כריך", emoji: "🥪", categoryId: "food", wordType: "noun", pictogramId: 2281 },
  { id: "rice", label: "אורז", emoji: "🍚", categoryId: "food", wordType: "noun", pictogramId: 6911 },
  { id: "egg", label: "ביצה", emoji: "🥚", categoryId: "food", wordType: "noun", pictogramId: 2427 },
  { id: "juice", label: "מיץ", emoji: "🧃", categoryId: "food", wordType: "noun", pictogramId: 11461 },
  { id: "cookie", label: "עוגייה", emoji: "🍪", categoryId: "food", wordType: "noun", pictogramId: 8312 },
  { id: "cheese", label: "גבינה", emoji: "🧀", categoryId: "food", wordType: "noun", pictogramId: 2541 },
  { id: "pizza", label: "פיצה", emoji: "🍕", categoryId: "food", wordType: "noun", pictogramId: 2527 },
  { id: "orange", label: "תפוז", emoji: "🍊", categoryId: "food", wordType: "noun", pictogramId: 2483 },
  { id: "yogurt", label: "יוגורט", emoji: "🥣", categoryId: "food", wordType: "noun", pictogramId: 2618 },
  { id: "soup", label: "מרק", emoji: "🍲", categoryId: "food", wordType: "noun", pictogramId: 2573 },
  { id: "chicken", label: "עוף", emoji: "🍗", categoryId: "food", wordType: "noun", pictogramId: 26547 },
  { id: "pasta", label: "פסטה", emoji: "🍝", categoryId: "food", wordType: "noun", pictogramId: 8652 },
  { id: "chocolate", label: "שוקולד", emoji: "🍫", categoryId: "food", wordType: "noun", pictogramId: 2334 },
  { id: "candy", label: "ממתק", emoji: "🍬", categoryId: "food", wordType: "noun", pictogramId: 2686 },
  { id: "mom", label: "אמא", emoji: "👩", categoryId: "people", wordType: "noun", pictogramId: 31148 },
  { id: "dad", label: "אבא", emoji: "👨", categoryId: "people", wordType: "noun", pictogramId: 2497 },
  { id: "teacher", label: "מורה", emoji: "👩‍🏫", categoryId: "people", wordType: "noun", pictogramId: 2457 },
  { id: "friend", label: "חבר", emoji: "🧒", categoryId: "people", wordType: "noun", pictogramId: 8487 },
  { id: "brother", label: "אח", emoji: "👦", categoryId: "people", wordType: "noun", pictogramId: 2423 },
  { id: "sister", label: "אחות", emoji: "👧", categoryId: "people", wordType: "noun", pictogramId: 2422 },
  { id: "grandma", label: "סבתא", emoji: "👵", categoryId: "people", wordType: "noun", pictogramId: 2243 },
  { id: "grandpa", label: "סבא", emoji: "👴", categoryId: "people", wordType: "noun", pictogramId: 2244 },
  { id: "therapist", label: "מטפלת", emoji: "👩‍⚕️", categoryId: "people", wordType: "noun", pictogramId: 2476 },
  { id: "uncle", label: "דוד", emoji: "👨", categoryId: "people", wordType: "noun", pictogramId: 30256 },
  { id: "aunt", label: "דודה", emoji: "👩", categoryId: "people", wordType: "noun", pictogramId: 30271 },
  { id: "baby", label: "תינוק", emoji: "👶", categoryId: "people", wordType: "noun", pictogramId: 2275 },
  { id: "doctor", label: "רופא", emoji: "🩺", categoryId: "people", wordType: "noun", pictogramId: 2467 },
  { id: "driver", label: "נהג", emoji: "🚗", categoryId: "people", wordType: "noun", pictogramId: 3019 },
  { id: "neighbor", label: "שכן", emoji: "🏠", categoryId: "people", wordType: "noun", pictogramId: 6241 },
  { id: "cousin", label: "בן דוד", emoji: "🧑", categoryId: "people", wordType: "noun", pictogramId: 30341 },
  { id: "eat", label: "לאכול", emoji: "🍽️", categoryId: "actions", wordType: "verb", pictogramId: 2349 },
  { id: "drink", label: "לשתות", emoji: "🥤", categoryId: "actions", wordType: "verb", pictogramId: 2276 },
  { id: "play", label: "לשחק", emoji: "🎮", categoryId: "actions", wordType: "verb", pictogramId: 2439 },
  { id: "sleep", label: "לישון", emoji: "🛏️", categoryId: "actions", wordType: "verb", pictogramId: 2369 },
  { id: "go", label: "ללכת", emoji: "🚶", categoryId: "actions", wordType: "verb", pictogramId: 2432 },
  { id: "read", label: "לקרוא", emoji: "📖", categoryId: "actions", wordType: "verb", pictogramId: 7141 },
  { id: "open", label: "לפתוח", emoji: "📂", categoryId: "actions", wordType: "verb", pictogramId: 2637 },
  { id: "close", label: "לסגור", emoji: "🚪", categoryId: "actions", wordType: "verb", pictogramId: 2697 },
  { id: "give", label: "לתת", emoji: "🤲", categoryId: "actions", wordType: "verb", pictogramId: 7279 },
  { id: "take", label: "לקחת", emoji: "✋", categoryId: "actions", wordType: "verb", pictogramId: 4606 },
  { id: "look", label: "לראות", emoji: "👀", categoryId: "actions", wordType: "verb", pictogramId: 2474 },
  { id: "listen", label: "לשמוע", emoji: "👂", categoryId: "actions", wordType: "verb", pictogramId: 2381 },
  { id: "learn", label: "ללמוד", emoji: "🧠", categoryId: "actions", wordType: "verb", pictogramId: 2387 },
  { id: "write", label: "לכתוב", emoji: "✍️", categoryId: "actions", wordType: "verb", pictogramId: 2380 },
  { id: "sit", label: "לשבת", emoji: "🪑", categoryId: "actions", wordType: "verb", pictogramId: 2801 },
  { id: "wait", label: "לחכות", emoji: "⏳", categoryId: "actions", wordType: "verb", pictogramId: 8109 },
  { id: "run", label: "לרוץ", emoji: "🏃", categoryId: "actions", wordType: "verb", pictogramId: 2719 },
  { id: "jump", label: "לקפוץ", emoji: "🤸", categoryId: "actions", wordType: "verb", pictogramId: 2804 },
  { id: "dance", label: "לרקוד", emoji: "💃", categoryId: "actions", wordType: "verb", pictogramId: 2652 },
  { id: "sing", label: "לשיר", emoji: "🎤", categoryId: "actions", wordType: "verb", pictogramId: 2315 },
  { id: "cry", label: "לבכות", emoji: "😭", categoryId: "actions", wordType: "verb", pictogramId: 3239 },
  { id: "laugh", label: "לצחוק", emoji: "😂", categoryId: "actions", wordType: "verb", pictogramId: 13354 },
  { id: "hug", label: "לחבק", emoji: "🤗", categoryId: "actions", wordType: "verb", pictogramId: 6023 },
  { id: "wash", label: "לרחוץ", emoji: "🧼", categoryId: "actions", wordType: "verb", pictogramId: 8977 },
  { id: "cook", label: "לבשל", emoji: "🍳", categoryId: "actions", wordType: "verb", pictogramId: 2342 },
  { id: "watch", label: "לצפות", emoji: "📺", categoryId: "actions", wordType: "verb", pictogramId: 6564 },
  { id: "book", label: "ספר", emoji: "📚", categoryId: "school", wordType: "noun", pictogramId: 2450 },
  { id: "pencil", label: "עיפרון", emoji: "✏️", categoryId: "school", wordType: "noun", pictogramId: 2440 },
  { id: "class", label: "כיתה", emoji: "🏫", categoryId: "school", wordType: "noun", pictogramId: 5913 },
  { id: "draw", label: "ציור", emoji: "🎨", categoryId: "school", wordType: "noun", pictogramId: 2360 },
  { id: "numbers", label: "מספרים", emoji: "🔢", categoryId: "school", wordType: "noun", pictogramId: 2879 },
  { id: "bag", label: "תיק", emoji: "🎒", categoryId: "school", wordType: "noun", pictogramId: 7053 },
  { id: "notebook", label: "מחברת", emoji: "📓", categoryId: "school", wordType: "noun", pictogramId: 2359 },
  { id: "scissors", label: "מספריים", emoji: "✂️", categoryId: "school", wordType: "noun", pictogramId: 2591 },
  { id: "glue", label: "דבק", emoji: "🧴", categoryId: "school", wordType: "noun", pictogramId: 2510 },
  { id: "clock", label: "שעון", emoji: "🕘", categoryId: "school", wordType: "noun", pictogramId: 7230 },
  { id: "computer", label: "מחשב", emoji: "💻", categoryId: "school", wordType: "noun", pictogramId: 2487 },
  { id: "board", label: "לוח", emoji: "🖊️", categoryId: "school", wordType: "noun", pictogramId: 2526 },
  { id: "ruler", label: "סרגל", emoji: "📏", categoryId: "school", wordType: "noun", pictogramId: 2815 },
  { id: "eraser", label: "מחק", emoji: "🧹", categoryId: "school", wordType: "noun", pictogramId: 2409 },
  { id: "homework", label: "שיעורי בית", emoji: "📝", categoryId: "school", wordType: "noun", pictogramId: 11228 },
  { id: "recess", label: "הפסקה", emoji: "⏸️", categoryId: "school", wordType: "noun", pictogramId: 27339 },
  { id: "ball", label: "כדור", emoji: "⚽", categoryId: "games", wordType: "noun", pictogramId: 2269 },
  { id: "doll", label: "בובה", emoji: "🧸", categoryId: "games", wordType: "noun", pictogramId: 2482 },
  { id: "blocks", label: "קוביות", emoji: "🧱", categoryId: "games", wordType: "noun", pictogramId: 2731 },
  { id: "puzzle", label: "פאזל", emoji: "🧩", categoryId: "games", wordType: "noun", pictogramId: 2540 },
  { id: "car", label: "מכונית", emoji: "🚗", categoryId: "games", wordType: "noun", pictogramId: 2339 },
  { id: "music", label: "מוזיקה", emoji: "🎵", categoryId: "games", wordType: "noun", pictogramId: 24795 },
  { id: "swing", label: "נדנדה", emoji: "🛝", categoryId: "games", wordType: "noun", pictogramId: 4572 },
  { id: "tablet", label: "טאבלט", emoji: "📱", categoryId: "games", wordType: "noun", pictogramId: 28099 },
  { id: "paint", label: "צבע", emoji: "🖍️", categoryId: "games", wordType: "noun", pictogramId: 4870 },
  { id: "slide", label: "מגלשה", emoji: "🛝", categoryId: "games", wordType: "noun", pictogramId: 4759 },
  { id: "trampoline", label: "טרמפולינה", emoji: "🤾", categoryId: "games", wordType: "noun", pictogramId: 23891 },
  { id: "kite", label: "עפיפון", emoji: "🪁", categoryId: "games", wordType: "noun", pictogramId: 2350 },
  { id: "bicycle", label: "אופניים", emoji: "🚲", categoryId: "games", wordType: "noun", pictogramId: 2277 },
  // Colors use the colored-circle emoji rather than an ARASAAC pictogram —
  // the swatch itself is the clearest picture of a color.
  { id: "red", label: "אדום", emoji: "🔴", categoryId: "colors", wordType: "noun" },
  { id: "blue", label: "כחול", emoji: "🔵", categoryId: "colors", wordType: "noun" },
  { id: "yellow", label: "צהוב", emoji: "🟡", categoryId: "colors", wordType: "noun" },
  { id: "green", label: "ירוק", emoji: "🟢", categoryId: "colors", wordType: "noun" },
  { id: "orange", label: "כתום", emoji: "🟠", categoryId: "colors", wordType: "noun" },
  { id: "purple", label: "סגול", emoji: "🟣", categoryId: "colors", wordType: "noun" },
  { id: "pink", label: "ורוד", emoji: "🩷", categoryId: "colors", wordType: "noun" },
  { id: "brown", label: "חום", emoji: "🟤", categoryId: "colors", wordType: "noun" },
  { id: "black", label: "שחור", emoji: "⚫", categoryId: "colors", wordType: "noun" },
  { id: "white", label: "לבן", emoji: "⚪", categoryId: "colors", wordType: "noun" },
  { id: "boardgame", label: "משחק קופסה", emoji: "🎲", categoryId: "games", wordType: "noun", pictogramId: 6170 },
  { id: "cards", label: "קלפים", emoji: "🃏", categoryId: "games", wordType: "noun", pictogramId: 3181 },
  { id: "balloon", label: "בלון", emoji: "🎈", categoryId: "games", wordType: "noun", pictogramId: 2408 },
  { id: "bubbles", label: "בועות סבון", emoji: "🫧", categoryId: "games", wordType: "noun", pictogramId: 6945 },
];

export const symbolById = Object.fromEntries(
  symbols.map((symbol) => [symbol.id, symbol]),
) as Record<string, AacSymbol>;

export const quickPhrases: QuickPhrase[] = [
  { text: "אני רוצה לשתות", emoji: "🥤", symbolIds: ["want", "drink"] },
  { text: "אני רוצה לאכול", emoji: "🍽️", symbolIds: ["want", "eat"] },
  { text: "אני צריך עזרה", emoji: "🆘", symbolIds: ["help"] },
  { text: "אני רוצה לשחק", emoji: "🎮", symbolIds: ["want", "play"] },
  { text: "אני עייף", emoji: "😴", symbolIds: ["tired"] },
  { text: "אני רוצה לישון", emoji: "🛏️", symbolIds: ["want", "sleep"] },
  { text: "אני רוצה מים", emoji: "💧", symbolIds: ["want", "water"] },
  { text: "אני צריך שירותים", emoji: "🚽", symbolIds: ["toilet"] },
  { text: "אני שמח", emoji: "😀", symbolIds: ["happy"] },
  { text: "אני עצוב", emoji: "😢", symbolIds: ["sad"] },
  { text: "אני כועס", emoji: "😠", symbolIds: ["angry"] },
  { text: "אני רוצה אמא", emoji: "👩", symbolIds: ["want", "mom"] },
  { text: "אני רוצה אבא", emoji: "👨", symbolIds: ["want", "dad"] },
  { text: "אני אוהב", emoji: "❤️", symbolIds: ["love"] },
  { text: "עוד בבקשה", emoji: "➕", symbolIds: ["more"] },
  { text: "סיימתי", emoji: "🏁", symbolIds: ["done"] },
  { text: "כן", emoji: "👍", symbolIds: ["yes"] },
  { text: "לא", emoji: "👎", symbolIds: ["no"] },
  { text: "אני רוצה ללכת", emoji: "🚶", symbolIds: ["want", "go"] },
  { text: "די", emoji: "✋", symbolIds: ["stop"] },
];

export const weeklyTopics: WeeklyTopic[] = [
  { id: "colors", label: "צבעים", emoji: "🎨", symbolIds: ["red", "blue", "yellow", "green", "orange", "purple", "pink", "brown", "black", "white", "paint", "draw"] },
  { id: "feelings", label: "רגשות", emoji: "😊", symbolIds: ["happy", "sad", "angry", "love"] },
  { id: "food", label: "אוכל", emoji: "🍎", symbolIds: ["water", "apple", "bread", "milk", "banana"] },
  { id: "family", label: "משפחה", emoji: "👪", symbolIds: ["mom", "dad", "friend", "brother", "sister"] },
  { id: "school", label: "בית ספר", emoji: "🏫", symbolIds: ["book", "pencil", "class", "draw", "numbers"] },
];

const extendedEmojiChoices = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "☺️", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👹", "👺", "👻", "👽", "👾", "🤖",
  "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🦷", "👀", "👁️", "👅", "👄",
  "👶", "🧒", "👦", "👧", "🧑", "👱", "👨", "🧔", "👩", "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "👮", "👷", "🤴", "👸", "👳", "👲", "🧕", "🤵", "👰", "🤰", "🤱", "👼", "🎅", "🤶", "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞", "🧟", "💆", "💇", "🚶", "🧍", "🧎", "🏃", "💃", "🕺", "👯", "🧖", "🧗", "🤺", "🏇", "⛷️", "🏂", "🏄", "🚣", "🏊", "⛹️", "🏋️", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹", "🧘", "🛀", "🛌", "👭", "👫", "👬", "💏", "💑", "👪", "👨‍👩‍👦", "👨‍👩‍👧", "👨‍👩‍👧‍👦", "👩‍👩‍👧", "👨‍👦", "👩‍👦", "👩‍👧",
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐕‍🦺", "🐈", "🐈‍⬛", "🐓", "🦃", "🦤", "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦", "🦥", "🐁", "🐀", "🐿️", "🦔",
  "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🥘", "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "🍼", "🫖", "☕", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊", "🥄", "🍴", "🍽️", "🥣", "🥡", "🧂",
  "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️", "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻", "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩",
  "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🦯", "🦽", "🦼", "🛴", "🚲", "🛵", "🏍️", "🛺", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️", "🚀", "🛸", "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓", "🪝", "⛽", "🚧", "🚦", "🚥", "🚏", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🗻", "🏕️", "⛺", "🛖", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "🏛️", "⛪", "🕌", "🕍", "🛕", "🕋", "⛩️", "🛤️", "🛣️", "🗾", "🎑", "🏞️", "🌅", "🌄", "🌠", "🎇", "🎆", "🌇", "🌆", "🏙️", "🌃", "🌌", "🌉", "🌁",
  "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "🗜️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳", "📡", "🔋", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🪛", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓", "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "💊", "💉", "🩸", "🧬", "🦠", "🧫", "🧪", "🌡️", "🧹", "🪠", "🧺", "🧻", "🚽", "🚰", "🚿", "🛁", "🛀", "🧼", "🪥", "🪒", "🧽", "🪣", "🧴", "🛎️", "🔑", "🗝️", "🚪", "🪑", "🛋️", "🛏️", "🛌", "🧸", "🪆", "🖼️", "🪞", "🪟", "🛍️", "🛒", "🎁", "🎈", "🎏", "🎀", "🪄", "🪅", "🎊", "🎉", "🎎", "🏮", "🎐", "🧧", "✉️", "📩", "📨", "📧", "💌", "📥", "📤", "📦", "🏷️", "🪧", "📪", "📫", "📬", "📭", "📮", "📯", "📜", "📃", "📄", "📑", "🧾", "📊", "📈", "📉", "🗒️", "🗓️", "📆", "📅", "🗑️", "📇", "🗃️", "🗳️", "🗄️", "📋", "📁", "📂", "🗂️", "🗞️", "📰", "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚", "📖", "🔖", "🧷", "🔗", "📎", "🖇️", "📐", "📏", "🧮", "📌", "📍", "✂️", "🖊️", "🖋️", "✒️", "🖌️", "🖍️", "📝", "✏️", "🔍", "🔎", "🔏", "🔐", "🔒", "🔓",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️", "⚠️", "🚸", "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎", "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗", "🈳", "🈂️", "🛂", "🛃", "🛄", "🛅", "🚹", "🚺", "🚼", "⚧️", "🚻", "🚮", "🎦", "📶", "🈁", "🔣", "ℹ️", "🔤", "🔡", "🔠", "🆖", "🆗", "🆙", "🆒", "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🔢", "#️⃣", "*️⃣", "⏏️", "▶️", "⏸️", "⏯️", "⏹️", "⏺️", "⏭️", "⏮️", "⏩", "⏪", "⏫", "⏬", "◀️", "🔼", "🔽", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️", "↪️", "↩️", "⤴️", "⤵️", "🔀", "🔁", "🔂", "🔄", "🔃", "🎵", "🎶", "➕", "➖", "➗", "✖️", "🟰", "♾️", "💲", "💱", "™️", "©️", "®️", "👁️‍🗨️", "🔚", "🔙", "🔛", "🔝", "🔜", "✔️", "☑️", "🔘", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔺", "🔻", "🔸", "🔹", "🔶", "🔷", "🔳", "🔲", "▪️", "▫️", "◾", "◽", "◼️", "◻️", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜", "🟫", "🔈", "🔇", "🔉", "🔊", "🔔", "🔕", "📣", "📢", "💬", "💭", "🗯️", "♠️", "♣️", "♥️", "♦️", "🃏", "🎴", "🀄", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛", "🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢", "🕣", "🕤", "🕥", "🕦", "🕧",
  "☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️", "⛄", "🌬️", "💨", "🌪️", "🌫️", "🌊", "💧", "💦", "☔", "☂️", "🌈", "🌟", "⭐", "🌙", "🌛", "🌜", "🌚", "🌕", "🌖", "🌗", "🌘", "🌑", "🌒", "🌓", "🌔", "🪐", "💫", "✨", "⚡", "🔥", "💥", "☄️", "🌍", "🌎", "🌏", "🌐", "🪨", "🌑", "🌵", "🎄", "🌲", "🌳", "🌴", "🌱", "🌿", "☘️", "🍀", "🎍", "🪴", "🎋", "🍃", "🍂", "🍁", "🪺", "🪹", "🍄", "🐚", "🪸", "🌾", "💐", "🌷", "🌹", "🥀", "🌺", "🌸", "🌼", "🌻", "🌞", "🌝", "🌛", "🌜",
];

export const buildAllEmojiChoices = (): string[] => {
  const fromApp = [
    ...symbols.map((symbol) => symbol.emoji),
    ...categories.map((category) => category.emoji),
    ...weeklyTopics.map((topic) => topic.emoji),
    ...quickPhrases.map((phrase) => phrase.emoji),
    "🚌",
    "🎂",
    "🏫",
    "👪",
    "⭐",
  ];

  return [...new Set([...fromApp, ...extendedEmojiChoices])];
};

export const allEmojiChoices = buildAllEmojiChoices();

const isoDateFromToday = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

export const initialState: DemoState = {
  parentName: "",
  parentEmail: "",
  teacherInviteCode: "AAC-4286",
  activeChildName: "דניאל",
  linkedChildren: [],
  isRegisteredInSupabase: false,
  level: "medium",
  speechRate: 0.9,
  weeklyTopicId: "feelings",
  coreSymbolIds: [
    "yes",
    "no",
    "want",
    "help",
    "more",
    "done",
    "tired",
    "toilet",
    "water",
    "eat",
    "drink",
    "happy",
    "sad",
    "mom",
    "dad",
    "play",
    "stop",
    "good",
    "i",
    "love",
  ],
  hiddenSymbolIds: [],
  favoriteSymbolIds: ["water", "mom", "play"],
  enabledCategoryIds: categories.map((category) => category.id),
  customSymbols: [],
  customCategories: [],
  symbolImages: {},
  symbolLabelOverrides: {},
  usageBySymbolId: {},
  sentenceCount: 0,
  sentenceLengths: [],
  categoryUsageById: {},
  topicUsageById: {},
  events: [
    { id: "1", type: "trip", title: "טיול לגן החיות", date: isoDateFromToday(1) },
    { id: "2", type: "birthday", title: "יום הולדת לסבתא", date: isoDateFromToday(-1) },
  ],
};

export const getAllCategories = (state: Pick<DemoState, "customCategories">): SymbolCategory[] => [
  ...categories,
  ...state.customCategories,
];
