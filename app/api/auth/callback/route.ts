import { NextResponse } from "next/server";

import { completeAuthSetup } from "@/lib/auth-setup";

import {

  exchangeOAuthCode,

  isServerSupabaseConfigured,

  sessionFromTokens,

  type SupabaseAuthSession,

} from "@/lib/supabase-server";



type CallbackRequest = {

  code?: string;

  accessToken?: string;

  refreshToken?: string;

  mode?: "parent" | "teacher";

  accountType?: "create" | "join";

  name?: string;

  childName?: string;

  childAccessCode?: string;

  knownInviteCode?: string;

  knownChildId?: string;

  mustBeMember?: boolean;

  teacherEmail?: string;

  functionalityLevel?: string;

  email?: string;

};



const readGoogleName = (metadata: Record<string, unknown> | undefined): string => {

  if (!metadata) return "";

  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) {

    return metadata.full_name.trim();

  }

  if (typeof metadata.name === "string" && metadata.name.trim()) {

    return metadata.name.trim();

  }

  return "";

};



async function resolveOAuthSession(

  body: CallbackRequest,

): Promise<{ session: SupabaseAuthSession | null; error?: string }> {

  const accessToken = body.accessToken?.trim() ?? "";

  const refreshToken = body.refreshToken?.trim() ?? "";



  if (accessToken && refreshToken) {

    return sessionFromTokens(accessToken, refreshToken);

  }



  const code = body.code?.trim() ?? "";

  if (code) {

    return exchangeOAuthCode(code);

  }



  return { session: null, error: "חסרים פרטי התחברות מ-Google." };

}



export async function POST(request: Request): Promise<NextResponse> {

  if (!isServerSupabaseConfigured()) {

    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });

  }



  let body: CallbackRequest;

  try {

    body = (await request.json()) as CallbackRequest;

  } catch {

    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });

  }



  const mode = body.mode === "teacher" ? "teacher" : "parent";

  const accountType = body.accountType === "join" ? "join" : "create";

  const fallbackName = body.name?.trim() || (mode === "parent" ? "הורה" : "מורה");



  try {

    const exchanged = await resolveOAuthSession(body);

    if (!exchanged.session) {

      return NextResponse.json({ error: exchanged.error }, { status: 401 });

    }



    // Joining / signing in with Google: the child's code is asked for after
    // Google, so the first round comes without one.
    if (accountType === "join" && !body.childAccessCode?.trim()) {
      return NextResponse.json(
        {
          needCode: true,
          email: exchanged.session.user.email ?? body.email ?? "",
          name: readGoogleName(exchanged.session.user.user_metadata) || fallbackName,
        },
        { status: 409 },
      );
    }

    const googleName = readGoogleName(exchanged.session.user.user_metadata);

    const resolvedName = googleName || fallbackName;

    const resolvedEmail =

      exchanged.session.user.email?.trim() ||

      body.email?.trim() ||

      exchanged.session.user.id;



    const payload = await completeAuthSetup({

      session: exchanged.session,

      mode,

      accountType,

      email: resolvedEmail,

      name: resolvedName,

      childName: body.childName,

      childAccessCode: body.childAccessCode,

      knownInviteCode: body.knownInviteCode,

      knownChildId: body.knownChildId,

      teacherEmail: body.teacherEmail,

      functionalityLevel: body.functionalityLevel,

      appOrigin: request.headers.get("origin") ?? undefined,

      mustBeMember: body.mustBeMember === true,

    });



    return NextResponse.json(payload);

  } catch (error) {

    const message = error instanceof Error ? error.message : "אירעה שגיאה. נסו שוב.";

    return NextResponse.json({ error: message }, { status: 500 });

  }

}


