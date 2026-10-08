// "מתקן העברית": AAC symbols are single base-form words ("אני רוצה מים קר"),
// so a spoken sentence comes out telegraphic and always masculine. This turns
// the tapped words into one natural Hebrew sentence with the child's gender.

export type ChildGender = "boy" | "girl";

// Masculine → feminine forms for symbol labels whose form depends on the
// speaker's gender. Used offline (no AI) so a girl tapping "עייף" still hears
// "עייפה", and as a hint for the AI.
const FEMININE_FORMS: Record<string, string> = {
  "שמח": "שמחה",
  "עצוב": "עצובה",
  "כועס": "כועסת",
  "עייף": "עייפה",
  "אוהב": "אוהבת",
  "מפחד": "מפחדת",
  "נרגש": "נרגשת",
  "משועמם": "משועממת",
  "מופתע": "מופתעת",
  "רגוע": "רגועה",
  "ביישן": "ביישנית",
  "צריך": "צריכה",
  "רעב": "רעבה",
  "צמא": "צמאה",
  "מתגעגע": "מתגעגעת",
  "הולך": "הולכת",
  "יכול": "יכולה",
};

export const genderWord = (word: string, gender: ChildGender): string =>
  gender === "girl" ? (FEMININE_FORMS[word.trim()] ?? word) : word;

export const localFixSentence = (words: string[], gender: ChildGender): string =>
  words
    .map((word) => genderWord(word, gender))
    .filter(Boolean)
    .join(" ");

export const buildGrammarSystemPrompt = (gender: ChildGender): string =>
  [
    "את/ה מתקן/ת דקדוק עברי למסך תקשורת AAC של ילד/ה שלא מדבר/ת.",
    "הילד/ה לוחץ/ת על סמלים, וכל סמל הוא מילה אחת בצורת בסיס (זכר, יחיד), למשל: אני רוצה מים קר.",
    "המשימה: להפוך את רצף המילים למשפט עברי אחד, תקין וטבעי, בגוף ראשון, כפי שהילד/ה היה/הייתה אומר/ת אותו.",
    gender === "girl"
      ? "הדוברת היא ילדה — השתמש/י בלשון נקבה לכל מה שמתאר אותה (אני עייפה, אני רוצה, אני אוהבת)."
      : "הדובר הוא ילד — השתמש/י בלשון זכר לכל מה שמתאר אותו (אני עייף, אני רוצה, אני אוהב).",
    "התאם/י מין ומספר בין שם עצם לתואר (מים קר → מים קרים), הוסף/י מילות קישור קטנות (את, ל, עם, של) ונטיות פועל לפי הצורך.",
    "אסור לשנות את המשמעות ואסור להוסיף רעיונות, רגשות או פרטים שלא נבחרו. אל תוסיף/י 'בבקשה' אם הוא לא נבחר.",
    "אם המילים כבר יוצרות משפט תקין — החזר/י אותו כמעט כמו שהוא.",
    'החזר/י אך ורק JSON תקין בפורמט {"sentence":"..."} — בלי markdown ובלי הסברים.',
  ].join(" ");

export const parseFixedSentence = (raw: string): string | null => {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { sentence?: unknown };
    const sentence = typeof parsed.sentence === "string" ? parsed.sentence.trim() : "";
    // A runaway answer (a paragraph instead of a sentence) is worse than the
    // plain words — reject it so the caller falls back.
    return sentence && sentence.length <= 160 ? sentence : null;
  } catch {
    return null;
  }
};
