import { NextResponse } from "next/server";
import { createAuthedSupabaseClient, isServerSupabaseConfigured } from "@/lib/supabase-server";

type ChildNameRequest = {
  childId?: string;
  name?: string;
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

  let body: ChildNameRequest;
  try {
    body = (await request.json()) as ChildNameRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!name || name.length > 40) {
    return NextResponse.json({ error: "שם הילד/ה לא תקין." }, { status: 400 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const userResult = await client.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const userId = userResult.data.user.id;
  let childId = body.childId?.trim() ?? "";

  if (!childId) {
    const ownedChild = await client
      .from("children")
      .select("id")
      .eq("parent_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (ownedChild.error) {
      return NextResponse.json({ error: ownedChild.error.message }, { status: 500 });
    }

    if (!ownedChild.data) {
      return NextResponse.json({ error: "לא נמצא פרופיל ילד." }, { status: 404 });
    }

    childId = ownedChild.data.id;
  }

  const profile = await client.from("users").select("role").eq("id", userId).maybeSingle();
  const role = profile.data?.role === "teacher" ? "teacher" : "parent";

  if (role === "parent") {
    const owned = await client
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("parent_id", userId)
      .maybeSingle();

    if (owned.error) {
      return NextResponse.json({ error: owned.error.message }, { status: 500 });
    }

    if (!owned.data) {
      return NextResponse.json({ error: "אין הרשאה לעדכן את שם הילד/ה." }, { status: 403 });
    }
  } else {
    const link = await client
      .from("child_caregivers")
      .select("child_id")
      .eq("child_id", childId)
      .eq("caregiver_id", userId)
      .maybeSingle();

    if (link.error) {
      return NextResponse.json({ error: link.error.message }, { status: 500 });
    }

    if (!link.data) {
      return NextResponse.json({ error: "אין הרשאה לעדכן את שם הילד/ה." }, { status: 403 });
    }
  }

  const updated = await client
    .from("children")
    .update({ display_name: name })
    .eq("id", childId)
    .select("id, display_name")
    .maybeSingle();

  if (updated.error) {
    return NextResponse.json({ error: updated.error.message }, { status: 500 });
  }

  if (!updated.data) {
    return NextResponse.json({ error: "לא נמצא פרופיל ילד." }, { status: 404 });
  }

  return NextResponse.json({
    childId: updated.data.id,
    name: updated.data.display_name,
  });
}
