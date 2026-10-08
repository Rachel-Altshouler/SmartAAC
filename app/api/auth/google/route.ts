import { NextResponse } from "next/server";
import { getGoogleOAuthUrl, isServerSupabaseConfigured } from "@/lib/supabase-server";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const requestUrl = new URL(request.url);
  const origin = requestUrl.searchParams.get("origin") ?? requestUrl.origin;
  const redirectTo = `${origin}/auth/callback`;
  const url = await getGoogleOAuthUrl(redirectTo);

  if (!url) {
    return NextResponse.json(
      { error: "Google לא מופעל ב-Supabase. הפעילי אותו ב-Authentication → Providers." },
      { status: 400 },
    );
  }

  return NextResponse.json({ url });
}
