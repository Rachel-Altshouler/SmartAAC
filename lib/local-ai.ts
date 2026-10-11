type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

type DetectedContext = {
  birthday: boolean;
  party: boolean;
  future: boolean;
  visitors: boolean;
  siblings: boolean;
  family: boolean;
  excited: boolean;
  school: boolean;
  needs: string | null;
};

const pick = (options: string[], index: number): string =>
  options[index % options.length];

function detectContext(clean: string): DetectedContext {
  const birthday =
    clean.includes("יום הולדת") ||
    clean.includes("יומולדת") ||
    (clean.includes("יום") && clean.includes("הולדת"));

  return {
    birthday,
    party: clean.includes("מסיבה") || clean.includes("מסיבת"),
    future: /מחר|מחרתיים|ביום|בשבוע|בערב|בבוקר|בסוף|יגיע|יגיעו|יבוא|יבואו|מגיע|מגיעים|באים|באו/.test(
      clean,
    ),
    visitors:
      clean.includes("יגיע") ||
      clean.includes("יגיעו") ||
      clean.includes("יבוא") ||
      clean.includes("מגיע") ||
      clean.includes("באים") ||
      clean.includes("מבקר"),
    siblings:
      clean.includes("אחים") ||
      clean.includes("אחי ") ||
      clean.includes(" אחי") ||
      clean.endsWith("אחי") ||
      clean.includes("אחות") ||
      clean.includes("האחים"),
    family:
      clean.includes("אמא") ||
      clean.includes("אבא") ||
      clean.includes("הור") ||
      clean.includes("סבת") ||
      clean.includes("סבא") ||
      clean.includes("דוד") ||
      clean.includes("דודה"),
    excited: clean.includes("מתרגש") || clean.includes("מצפה"),
    school:
      clean.includes("בית ספר") ||
      clean.includes("כיתה") ||
      clean.includes("מורה"),
    needs: detectNeed(clean),
  };
}

function detectNeed(clean: string): string | null {
  if (clean.includes("מים") || clean.includes("צמא")) return "water";
  if (clean.includes("אוכל") || clean.includes("רעב")) return "food";
  if (clean.includes("שירותים")) return "bathroom";
  if (clean.includes("עייפ") || clean.includes("לישון") || clean.includes("מנוחה")) {
    return "rest";
  }
  if (clean.includes("עצוב") || clean.includes("בוכה")) return "sad";
  if (clean.includes("כועס") || clean.includes("עצבני")) return "angry";
  if (clean.includes("עזרה") || clean.includes("קשה") || clean.includes("לא יכול")) {
    return "help";
  }
  return null;
}

function isSharingMessage(clean: string, ctx: DetectedContext): boolean {
  return (
    ctx.future ||
    ctx.birthday ||
    ctx.party ||
    ctx.visitors ||
    clean.includes("יש לי") ||
    clean.includes("יהיה לי") ||
    clean.includes("לי ") ||
    clean.includes("אני הולכ") ||
    clean.includes("אנחנו הולכ") ||
    clean.includes("קורה לי") ||
    clean.includes("עושים לי") ||
    clean.includes("ספר") ||
    clean.includes("קרה")
  );
}

function buildEventReply(ctx: DetectedContext, userTurns: number): string | null {
  if (ctx.birthday && ctx.future && ctx.siblings) {
    return pick(
      [
        "מזל טוב! יום הולדת מחר והאחים מגיעים — איזה כיף! מה את/ה הכי מצפה לעשות איתם?",
        "וואו, יום הולדת מחר עם האחים! מה תרצה/י לעשות יחד — משחק, עוגה, או משהו מיוחד?",
        "איזה יופי! יום הולדת מחר והאחים באים. יש לך רעיון איך לחגוג?",
      ],
      userTurns,
    );
  }

  if (ctx.birthday && ctx.future && ctx.visitors) {
    return pick(
      [
        "מזל טוב מראש! מחר יום הולדת ויש אורחים — מי מגיע, ומה הכי מצפה לך?",
        "יום הולדת מחר עם אורחים! מה מתכננים — עוגה, משחקים, מתנות?",
      ],
      userTurns,
    );
  }

  if (ctx.birthday && ctx.future) {
    return pick(
      [
        "מזל טוב! יום הולדת מחר — מה מתוכנן, ומה הכי מצפה לך?",
        "איזה כיף, יום הולדת מחר! מה תרצה/י לעשות ביום המיוחד?",
        "יום הולדת מחר! ספר/י — מי בא, מה מתכננים, ומה הכי מרגש אותך?",
      ],
      userTurns,
    );
  }

  if (ctx.birthday) {
    return pick(
      [
        "יום הולדת! מזל טוב. ספר/י — של מי החג, ומה הכי מצפה לך?",
        "איזה כיף, יום הולדת! מה מתכננים לעשות?",
      ],
      userTurns,
    );
  }

  if (ctx.party && ctx.future) {
    return pick(
      [
        "וואו, מסיבה מחר! מי מזמין, ומה הכי מצפה לך שם?",
        "מסיבה מחר — איזה כיף! מה תרצה/י לעשות שם?",
      ],
      userTurns,
    );
  }

  if (ctx.party) {
    return pick(
      [
        "וואו, מסיבה! זה נשמע כיף. מי מזמין, ומה הכי מצפה לך שם?",
        "מסיבה — איזה כיף! את/ה יודע/ת מי יהיה שם?",
      ],
      userTurns,
    );
  }

  if (ctx.future && ctx.visitors) {
    return pick(
      [
        "נשמע שמגיעים אליך/אלייך! מי בא, ומה את/ה הכי מצפה לעשות יחד?",
        "אורחים מגיעים! ספר/י — מי, מתי, ומה הכי כיף לך בזה?",
      ],
      userTurns,
    );
  }

  if (ctx.future) {
    return pick(
      [
        "נשמע שמשהו מעניין מחכה לך! ספר/י — מה בדיוק קורה, ומה הכי מצפה לך?",
        "מעניין! מה מתוכנן למחר, ואיך את/ה מרגיש/ה?",
      ],
      userTurns,
    );
  }

  return null;
}

function buildTopicReply(clean: string, ctx: DetectedContext, userTurns: number): string | null {
  const eventReply = buildEventReply(ctx, userTurns);
  if (eventReply) return eventReply;

  if (ctx.excited) {
    return pick(
      [
        "נשמע שאת/ה מתרגש/ת! על מה בדיוק, ומה הכי מחכה לך?",
        "זה יפה שאת/ה מתרגש/ת. ספר/י — מה הדבר הכי כיף שמחכה לך?",
      ],
      userTurns,
    );
  }

  if (clean.includes("מפחד") || clean.includes("חושש") || clean.includes("לחוץ")) {
    return pick(
      [
        "זה בסדר להרגיש ככה. ממה בדיוק את/ה מפחד/ת?",
        "אני שומע שזה מלחיץ. ספר/י מה הכי מדאיג אותך.",
      ],
      userTurns,
    );
  }

  if (clean.includes("שמח") || clean.includes("כיף")) {
    return "איזה יופי! אני שמח לשמוע. מה הכי שמח אותך?";
  }

  if (ctx.school) {
    return "יום בבית ספר יכול להיות מלא. מה היה היום — קשה, כיף, או משהו באמצע?";
  }

  if (ctx.siblings && !ctx.birthday && !ctx.party) {
    return pick(
      [
        "ספר/י על האחים — מה קרה איתם, או מה את/ה רוצה לעשות יחד?",
        "אחים! מה עשיתם, או מה את/ה רוצה לספר עליהם?",
      ],
      userTurns,
    );
  }

  if (ctx.family && !ctx.birthday) {
    return "משפחה זה חשוב. ספר/י — מה קרה, או מה את/ה רוצה לספר?";
  }

  if (
    clean.includes("חבר") &&
    !clean.includes("אחים") &&
    !clean.includes("אחי")
  ) {
    return "חברים זה נחמד. ספר/י — מה קרה איתם?";
  }

  if (clean.includes("לשחק") || clean.includes("משחק")) {
    return "כיף! בא לך משחק בחוץ, בטלפון, או עם חבר?";
  }

  if (clean.includes("טיול") || clean.includes("יציאה") || clean.includes("נופש")) {
    return "טיול נשמע מעניין! לאן, ומה הכי מצפה לך?";
  }

  if (clean.includes("מתנה") || clean.includes("מתנות")) {
    return "מתנה! יש לך רעיון מה תרצה/י, או מה תרצה/י לתת?";
  }

  if (clean.includes("לא יודע") || clean.includes("לא יודעת")) {
    return "זה בסדר לא לדעת. בוא/י נבחר ביחד: אוכל, מנוחה, משחק, או עזרה.";
  }

  return null;
}

function buildNeedReply(need: string): string {
  switch (need) {
    case "water":
      return "בטח, מים זה רעיון טוב. תרצה/י כוס קרה, חמה, או בקבוק?";
    case "food":
      return "בוא/י נאכל משהו טוב. מה בא לך: לחם, פרי, ירק, או משהו מתוק?";
    case "bathroom":
      return "בסדר גמור. תרצה/י שאקרא למבוגר שיעזור לך?";
    case "rest":
      return "נשמע שאת/ה עייף/ה. תרצה/י לנוח או לספר למישהו?";
    case "sad":
      return "אני מצטער שקשה לך. לפעמים עוזר לדבר, לנוח, או לקבל חיבוק.";
    case "angry":
      return "זה בסדר להרגיש כעס. מה גרם לך להתעצבן?";
    case "help":
      return "אני כאן. תוכל/י לספר במה בדיוק קשה, ונחשוב יחד מה לעשות.";
    default:
      return "אני כאן. ספר/י לי עוד.";
  }
}

function buildYesNoReply(
  clean: string,
  lastAssistant: string,
  userTurns: number,
): string | null {
  if (clean.includes("כן")) {
    if (lastAssistant.includes("מים")) return "מעולה. קדימה, תביא/י כוס מים.";
    if (lastAssistant.includes("לנוח")) return "נחמד. מצא/י מקום שקט ותנוח/י קצת.";
    if (lastAssistant.includes("לשחק")) return "יופי! תבחר/י משחק שאת/ה אוהב/ת.";
    if (lastAssistant.includes("יום הולדת") || lastAssistant.includes("מזל טוב")) {
      return "יופי! ספר/י — מה הכי מצפה לך ליום ההולדת?";
    }
    if (lastAssistant.includes("מסיבה")) {
      return "יופי! ספר/י — מה הכי מצפה לך במסיבה?";
    }
    if (lastAssistant.includes("אחים")) {
      return "נהדר! מה תרצה/י לעשות עם האחים כשיגיעו?";
    }
    return pick(
      ["סבבה! ספר/י עוד — מה הצעד הבא?", "יופי! ספר/י פרט נוסף."],
      userTurns,
    );
  }

  if (clean.includes("לא")) {
    return "בסדר גמור. מה כן תרצה/י — משהו אחר, או עזרה?";
  }

  return null;
}

function buildCuriousFallback(text: string, userTurns: number): string {
  const words = text.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 2) {
    return pick(
      [
        "שמעתי אותך. ספר/י עוד — מה הכי חשוב לך בזה?",
        "נשמע שיש כאן משהו מעניין. ספר/י מה קורה, ואיך הרגשת?",
        "אני רוצה להבין יותר. ספר/י פרטים — מי, מה, ואיך זה גרם לך להרגיש?",
      ],
      userTurns,
    );
  }

  return pick(
    [
      "ספר/י לי עוד — על מה בדיוק את/ה רוצה לדבר?",
      "אני כאן ומקשיב. מה עובר עליך/עלייך עכשיו?",
    ],
    userTurns,
  );
}

// The replies above are written once with both forms ("ספר/י"); the child
// hears only their own, never the slash.
const GENDER_FORMS: Record<string, { boy: string; girl: string }> = {
  "את/ה": { boy: "אתה", girl: "את" },
  "שאת/ה": { boy: "שאתה", girl: "שאת" },
  "ספר/י": { boy: "ספר", girl: "ספרי" },
  "תרצה/י": { boy: "תרצה", girl: "תרצי" },
  "בוא/י": { boy: "בוא", girl: "בואי" },
  "תביא/י": { boy: "תביא", girl: "תביאי" },
  "ותנוח/י": { boy: "ותנוח", girl: "ותנוחי" },
  "מצא/י": { boy: "מצא", girl: "מצאי" },
  "תבחר/י": { boy: "תבחר", girl: "תבחרי" },
  "תוכל/י": { boy: "תוכל", girl: "תוכלי" },
  "אוהב/ת": { boy: "אוהב", girl: "אוהבת" },
  "יודע/ת": { boy: "יודע", girl: "יודעת" },
  "חושב/ת": { boy: "חושב", girl: "חושבת" },
  "מפחד/ת": { boy: "מפחד", girl: "מפחדת" },
  "מתרגש/ת": { boy: "מתרגש", girl: "מתרגשת" },
  "מרגיש/ה": { boy: "מרגיש", girl: "מרגישה" },
  "עייף/ה": { boy: "עייף", girl: "עייפה" },
  "אליך/אלייך": { boy: "אליך", girl: "אלייך" },
  "עליך/עלייך": { boy: "עליך", girl: "עלייך" },
};

const inGender = (text: string, gender: "boy" | "girl"): string =>
  text.replace(/[א-ת]+\/[א-ת]+/g, (form) => GENDER_FORMS[form]?.[gender] ?? form);

export function buildLocalChildAiAnswer(
  message: string,
  history: ChatTurn[] = [],
  gender: "boy" | "girl" = "boy",
): string {
  return inGender(buildBothFormsAnswer(message, history), gender);
}

function buildBothFormsAnswer(message: string, history: ChatTurn[]): string {
  const text = message.trim();
  const clean = text.toLowerCase();
  const userTurns = history.filter((item) => item.role === "user").length;
  const lastAssistant =
    [...history].reverse().find((item) => item.role === "assistant")?.content ?? "";
  const ctx = detectContext(clean);

  const reply = (candidate: string): string => {
    if (candidate.trim() !== lastAssistant.trim()) return candidate;
    return pick(
      [
        "ספר/י עוד — מה הכי חשוב לך בזה?",
        "אני מקשיב. מה עוד תרצה/י לספר?",
        "הבנתי. ספר/י פרט נוסף.",
      ],
      userTurns + 1,
    );
  };

  if (!clean) {
    return reply("אפשר לכתוב לי משפט קצר, ואני אמשיך איתך את השיחה.");
  }

  if (/^(שלום|היי|הי$|בוקר|ערב)/.test(clean)) {
    return reply("שלום! אני שמח לדבר איתך. מה עובר עליך/עלייך היום?");
  }

  if (ctx.needs) {
    return reply(buildNeedReply(ctx.needs));
  }

  if (isSharingMessage(clean, ctx)) {
    const topicReply = buildTopicReply(clean, ctx, userTurns);
    if (topicReply) return reply(topicReply);
  }

  if (userTurns > 0) {
    const yesNoReply = buildYesNoReply(clean, lastAssistant, userTurns);
    if (yesNoReply) return reply(yesNoReply);
  }

  if (
    clean.includes("?") ||
    clean.startsWith("מה ") ||
    clean.startsWith("למה ") ||
    clean.startsWith("איך ") ||
    clean.startsWith("מתי ") ||
    clean.startsWith("איפה ")
  ) {
    return reply(
      "שאלה טובה. אני לא תמיד יודע הכל, אבל אפשר לחשוב יחד — מה את/ה חושב/ת?",
    );
  }

  const fallbackTopic = buildTopicReply(clean, ctx, userTurns);
  if (fallbackTopic) return reply(fallbackTopic);

  return reply(buildCuriousFallback(text, userTurns));
}
