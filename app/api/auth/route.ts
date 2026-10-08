import { NextResponse } from "next/server";
import { completeAuthSetup } from "@/lib/auth-setup";
import { authenticateUser, isServerSupabaseConfigured } from "@/lib/supabase-server";

type AuthMode = "parent" | "teacher";
type AccountType = "create" | "join";

type AuthRequest = {
  mode?: AuthMode;
  accountType?: AccountType;
  email?: string;
  password?: string;
  name?: string;
  childName?: string;
  childAccessCode?: string;
  knownInviteCode?: string;
  teacherEmail?: string;
  functionalityLevel?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  let body: AuthRequest;
  try {
    body = (await request.json()) as AuthRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const mode = body.mode;
  const accountType: AccountType = body.accountType === "join" ? "join" : "create";
  const email = body.email?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
  const password = body.password ?? "";
  const name = body.name?.trim() || (mode === "parent" ? "הורה" : "מורה");

  if (mode !== "parent" && mode !== "teacher") {
    return NextResponse.json({ error: "מצב כניסה לא תקין" }, { status: 400 });
  }

  if (accountType === "create") {
    const teacherEmail = body.teacherEmail?.trim().toLowerCase() ?? "";
    if (teacherEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) {
      return NextResponse.json({ error: "אימייל לא תקין." }, { status: 400 });
    }
  }

  if (!email || password.length < 6) {
    return NextResponse.json({ error: "צריך אימייל וסיסמה של לפחות 6 תווים." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Unable to validate email address: invalid format" }, { status: 400 });
  }

  try {
    const auth = await authenticateUser(email, password, name, mode);
    if (!auth.session) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const payload = await completeAuthSetup({
      session: auth.session,
      mode,
      accountType,
      email,
      name,
      childName: body.childName,
      childAccessCode: body.childAccessCode,
      knownInviteCode: body.knownInviteCode,
      teacherEmail: body.teacherEmail,
      functionalityLevel: body.functionalityLevel,
      appOrigin: request.headers.get("origin") ?? undefined,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "אירעה שגיאה. נסו שוב.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
