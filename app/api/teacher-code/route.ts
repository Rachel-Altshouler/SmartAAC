import { NextResponse } from "next/server";
import { rotateTeacherAccessCode } from "@/lib/auth-setup";
import { isServerSupabaseConfigured } from "@/lib/supabase-server";

type TeacherCodeRequest = {
  childId?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: TeacherCodeRequest = {};
  try {
    body = (await request.json()) as TeacherCodeRequest;
  } catch {
    body = {};
  }

  try {
    const code = await rotateTeacherAccessCode({
      accessToken,
      childId: body.childId,
    });

    return NextResponse.json({ code });
  } catch (error) {
    const message = error instanceof Error ? error.message : "אירעה שגיאה. נסו שוב.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
