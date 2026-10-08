import { NextResponse } from "next/server";
import { deliverTeacherInvite } from "@/lib/teacher-invite";
import { createAdminSupabaseClient, createAuthedSupabaseClient } from "@/lib/supabase-server";

type TeacherInviteRequest = {
  teacherEmail?: string;
  teacherInviteCode?: string;
  childId?: string;
  appOrigin?: string;
  inviteeRole?: "parent" | "teacher";
  inviterRole?: "parent" | "teacher";
};

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  let body: TeacherInviteRequest;
  try {
    body = (await request.json()) as TeacherInviteRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const teacherEmail = body.teacherEmail?.trim().toLowerCase() ?? "";
  const teacherInviteCode = body.teacherInviteCode?.trim() ?? "";

  if (!teacherEmail || !isValidEmail(teacherEmail)) {
    return NextResponse.json({ error: "צריך אימייל תקין." }, { status: 400 });
  }

  if (teacherInviteCode.length < 6) {
    return NextResponse.json({ error: "חסר קוד גישה." }, { status: 400 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const userResult = await client.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const userId = userResult.data.user.id;

  let childQuery = client
    .from("children")
    .select("id, display_name, parent_id")
    .eq("parent_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (body.childId) {
    childQuery = client
      .from("children")
      .select("id, display_name, parent_id")
      .eq("id", body.childId)
      .eq("parent_id", userId)
      .limit(1);
  }

  const childResult = await childQuery.maybeSingle();
  if (childResult.error) {
    return NextResponse.json({ error: childResult.error.message }, { status: 500 });
  }

  if (!childResult.data) {
    return NextResponse.json({ error: "לא נמצא פרופיל ילד." }, { status: 404 });
  }

  const profile = await client
    .from("users")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  const inviterRole = body.inviterRole === "teacher" ? "teacher" : "parent";
  const inviteeRole = body.inviteeRole === "parent" ? "parent" : "teacher";
  const parentName = profile.data?.full_name || (inviterRole === "teacher" ? "מורה" : "הורה");
  const appOrigin =
    body.appOrigin?.trim() ||
    request.headers.get("origin") ||
    process.env.APP_BASE_URL ||
    "http://localhost:3000";

  const invite = await deliverTeacherInvite({
    teacherEmail,
    teacherInviteCode,
    childName: childResult.data.display_name,
    parentName,
    appOrigin,
    inviteeRole,
  });

  const admin = createAdminSupabaseClient();
  const writer = admin ?? client;
  try {
    await writer
      .from("children")
      .update({
        teacher_email: teacherEmail,
        teacher_invite_sent_at: new Date().toISOString(),
      })
      .eq("id", childResult.data.id);
  } catch {
    // columns may not exist until schema migration is applied
  }

  if (!invite.delivered) {
    return NextResponse.json(
      {
        delivered: false,
        error:
          invite.error ??
          "לא הצלחנו לשלוח מייל. ודא/י ש-BREVO_API_KEY ו-BREVO_SENDER_EMAIL מוגדרים ב-.env.local.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    delivered: true,
    loginUrl: invite.loginUrl,
    teacherEmail,
  });
}
