import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createAdminSupabaseClient } from "@/lib/supabase-server";

// 🔔 Runs once a day (vercel.json → crons). For every event happening
// tomorrow, emails the child's care team (creator + everyone who joined) a
// reminder to go over the event's symbols with the child. Each event is
// reminded once (calendar_events.reminder_sent_at, migration 007).

const SITE_URL = "https://smart-aac.vercel.app";

const israelDate = (offsetDays: number): string => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export async function GET(request: Request): Promise<NextResponse> {
  // Vercel sends "Authorization: Bearer <CRON_SECRET>"; nobody else may run this.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 500 });

  const tomorrow = israelDate(1);
  const events = await admin
    .from("calendar_events")
    .select("id, child_id, title, event_type, custom_label")
    .eq("event_date", tomorrow)
    .is("reminder_sent_at", null);
  if (events.error) return NextResponse.json({ error: events.error.message }, { status: 500 });

  let sent = 0;
  const byChild = new Map<string, typeof events.data>();
  (events.data ?? []).forEach((event) => byChild.set(event.child_id, [...(byChild.get(event.child_id) ?? []), event]));

  for (const [childId, childEvents] of byChild) {
    const child = await admin.from("children").select("display_name, parent_id").eq("id", childId).maybeSingle();
    if (!child.data) continue;
    const members = await admin.from("child_caregivers").select("caregiver_id").eq("child_id", childId);
    const userIds = [...new Set([child.data.parent_id, ...(members.data ?? []).map((row) => row.caregiver_id)])];

    const emails: string[] = [];
    for (const userId of userIds) {
      const user = await admin.auth.admin.getUserById(userId);
      const email = user.data.user?.email;
      if (email && !email.endsWith("@example.com")) emails.push(email);
    }
    if (emails.length === 0) continue;

    const name = child.data.display_name;
    const titles = childEvents.map((event) => event.title);
    const subject = `🔔 מחר: ${titles.join(", ")} — SmartAAC`;
    const lines = titles.map((title) => `מחר: ${title}`);
    const textBody = [
      "שלום,",
      "",
      ...lines,
      "",
      `כדאי לעבור היום עם ${name} על הסמלים של האירוע, כדי שיוכל/תוכל לדבר עליו.`,
      `במסך הילד ← "אירועים" יש לכל אירוע סמלים משלו.`,
      "",
      SITE_URL,
      "",
      "SmartAAC",
    ].join("\n");
    const html = [
      "<div dir='rtl' style='font-family:Arial,sans-serif;line-height:1.7'>",
      "<p>שלום,</p>",
      ...lines.map((line) => `<p><strong>${escapeHtml(line)}</strong></p>`),
      `<p>כדאי לעבור היום עם ${escapeHtml(name)} על הסמלים של האירוע, כדי שיוכל/תוכל לדבר עליו.<br/>במסך הילד ← "אירועים" יש לכל אירוע סמלים משלו.</p>`,
      `<p><a href="${SITE_URL}">לפתיחת SmartAAC</a></p>`,
      "</div>",
    ].join("");

    let delivered = false;
    for (const to of emails) {
      const result = await sendEmail({ to, subject, text: textBody, html });
      if (result.delivered) {
        delivered = true;
        sent += 1;
      }
    }
    if (delivered) {
      await admin
        .from("calendar_events")
        .update({ reminder_sent_at: new Date().toISOString() })
        .in(
          "id",
          childEvents.map((event) => event.id),
        );
    }
  }

  return NextResponse.json({ ok: true, date: tomorrow, events: events.data?.length ?? 0, emailsSent: sent });
}
