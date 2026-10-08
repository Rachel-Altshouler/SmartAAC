export type TeacherInviteInput = {

  teacherEmail: string;

  teacherInviteCode: string;

  childName: string;

  parentName: string;

  appOrigin: string;

  // Who is being invited — preselects that role on the login form and words
  // the email for it. The invitee can still switch roles in the form.
  inviteeRole?: "parent" | "teacher";

};



export type TeacherInviteContent = {

  subject: string;

  body: string;

  loginUrl: string;

  mailtoUrl: string;

};



const normalizeOrigin = (origin: string): string => {

  const trimmed = origin.trim();

  if (!trimmed) {

    return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";

  }

  try {

    return new URL(trimmed).origin;

  } catch {

    return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";

  }

};



export function buildTeacherLoginUrl(
  origin: string,
  code: string,
  inviteeRole?: "parent" | "teacher",
): string {

  const url = new URL(normalizeOrigin(origin));

  // The code alone means "join". `mode` only preselects the role the
  // inviter chose — the invitee can still change it in the form.

  url.searchParams.set("code", code.trim());

  if (inviteeRole) url.searchParams.set("mode", inviteeRole);

  return url.toString();

}



export function buildTeacherInviteContent(input: TeacherInviteInput): TeacherInviteContent {

  const loginUrl = buildTeacherLoginUrl(input.appOrigin, input.teacherInviteCode, input.inviteeRole);

  const asRole =
    input.inviteeRole === "parent" ? " כהורה" : input.inviteeRole === "teacher" ? " כמורה" : "";

  const subject = `SmartAAC — הזמנה להצטרפות עבור ${input.childName}`;

  const body = [

    "שלום,",

    "",

    `${input.parentName} הזמין/ה אותך להצטרף${asRole} למערכת SmartAAC עבור ${input.childName}.`,

    "",

    `קוד הגישה: ${input.teacherInviteCode}`,

    "",

    "קישור לכניסה:",

    loginUrl,

    "",

    "איך להתחבר:",

    '1. פתח/י את הקישור (או היכנס/י לאפליקציה ולחצ/י "כניסת הורה / מטפל")',

    '2. בחר/י את התפקיד שמתאים לך (הורה או מורה) ואת "יש לי קוד להצטרפות"',

    "3. הירשם/י עם האימייל שלך ובחר/י סיסמה אישית",

    `4. הזינ/י את קוד הגישה: ${input.teacherInviteCode}`,

    "",

    "בברכה,",

    "SmartAAC",

  ].join("\n");



  const mailtoUrl = `mailto:${encodeURIComponent(input.teacherEmail.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;



  return { subject, body, loginUrl, mailtoUrl };

}



function buildTeacherInviteHtml(input: TeacherInviteInput, loginUrl: string): string {

  const asRole =
    input.inviteeRole === "parent" ? " כהורה" : input.inviteeRole === "teacher" ? " כמורה" : "";

  return [

    "<div dir='rtl' style='font-family:Arial,sans-serif;line-height:1.6'>",

    "<p>שלום,</p>",

    `<p><strong>${input.parentName}</strong> הזמין/ה אותך להצטרף${asRole} ל-SmartAAC עבור <strong>${input.childName}</strong>.</p>`,

    `<p>קוד הגישה: <strong>${input.teacherInviteCode}</strong></p>`,

    `<p><a href="${loginUrl}">לחץ/י כאן לכניסה</a></p>`,

    "<p style='color:#666;font-size:14px'>אם הקישור לא נפתח, היכנס/י לאפליקציה → \"כניסת הורה / מטפל\" → בחר/י תפקיד ו\"יש לי קוד להצטרפות\" → הזנ/י את הקוד.</p>",

    "</div>",

  ].join("");

}



function parseBrevoError(raw: string): string {

  let message = raw.slice(0, 300);

  try {

    const parsed = JSON.parse(raw) as { message?: string; code?: string };

    message = parsed.message || parsed.code || message;

  } catch {

    // raw wasn't JSON — keep the truncated text above

  }

  if (/unrecognised ip|unauthorized/i.test(message)) {

    return "שליחת המייל נחסמה כי כתובת ה-IP של השרת לא מורשית בחשבון Brevo. היכנס/י ל-app.brevo.com → Security → Authorised IPs והוסיפ/י את הכתובת שמופיעה במייל האזהרה ששלחו, או פשוט שתפ/י את קוד הגישה עם המורה ידנית בינתיים.";

  }

  return `שליחת המייל נכשלה: ${message}`;

}



async function sendViaBrevo(

  input: TeacherInviteInput,

  subject: string,

  body: string,

  html: string,

): Promise<{ delivered: boolean; error?: string }> {

  const apiKey = process.env.BREVO_API_KEY?.trim();

  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();

  if (!apiKey || !senderEmail) {

    return {

      delivered: false,

      error:

        "Brevo לא מוגדר. הוסיפ/י BREVO_API_KEY ו-BREVO_SENDER_EMAIL ל-.env.local (brevo.com — חינם).",

    };

  }



  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "SmartAAC";



  try {

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {

      method: "POST",

      headers: {

        "api-key": apiKey,

        "Content-Type": "application/json",

        Accept: "application/json",

      },

      body: JSON.stringify({

        sender: { name: senderName, email: senderEmail },

        to: [{ email: input.teacherEmail.trim() }],

        subject,

        textContent: body,

        htmlContent: html,

      }),

    });



    const raw = await response.text();

    if (!response.ok) {

      return { delivered: false, error: parseBrevoError(raw) };

    }



    return { delivered: true };

  } catch (error) {

    return {

      delivered: false,

      error: error instanceof Error ? error.message : "brevo send failed",

    };

  }

}



async function sendViaResend(

  input: TeacherInviteInput,

  subject: string,

  body: string,

  html: string,

): Promise<{ delivered: boolean; error?: string }> {

  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {

    return { delivered: false, error: "RESEND_API_KEY לא מוגדר." };

  }



  const from =

    process.env.RESEND_FROM_EMAIL?.trim() || "SmartAAC <onboarding@resend.dev>";



  try {

    const response = await fetch("https://api.resend.com/emails", {

      method: "POST",

      headers: {

        Authorization: `Bearer ${apiKey}`,

        "Content-Type": "application/json",

      },

      body: JSON.stringify({

        from,

        to: [input.teacherEmail.trim()],

        subject,

        text: body,

        html,

      }),

    });



    if (!response.ok) {

      const raw = await response.text();

      return { delivered: false, error: raw.slice(0, 300) };

    }



    return { delivered: true };

  } catch (error) {

    return {

      delivered: false,

      error: error instanceof Error ? error.message : "resend send failed",

    };

  }

}



export async function sendTeacherInviteEmail(

  input: TeacherInviteInput,

): Promise<{ delivered: boolean; error?: string }> {

  const { subject, body, loginUrl } = buildTeacherInviteContent(input);

  const html = buildTeacherInviteHtml(input, loginUrl);



  if (process.env.BREVO_API_KEY?.trim()) {

    return sendViaBrevo(input, subject, body, html);

  }



  if (process.env.RESEND_API_KEY?.trim()) {

    return sendViaResend(input, subject, body, html);

  }



  return {

    delivered: false,

    error:

      "שירות מייל לא מוגדר. הוסיפ/י BREVO_API_KEY + BREVO_SENDER_EMAIL ל-.env.local (brevo.com — חינם, בלי דומיין).",

  };

}



export async function deliverTeacherInvite(input: TeacherInviteInput): Promise<{

  delivered: boolean;

  mailtoUrl: string;

  loginUrl: string;

  error?: string;

}> {

  const content = buildTeacherInviteContent(input);

  const sendResult = await sendTeacherInviteEmail(input);



  return {

    delivered: sendResult.delivered,

    mailtoUrl: content.mailtoUrl,

    loginUrl: content.loginUrl,

    error: sendResult.error,

  };

}


