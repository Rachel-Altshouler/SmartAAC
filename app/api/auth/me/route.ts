import { NextResponse } from "next/server";
import { createAuthedSupabaseClient } from "@/lib/supabase-server";

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const userResult = await client.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const userId = userResult.data.user.id;
  const email = userResult.data.user.email ?? "";

  const profile = await client
    .from("users")
    .select("full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (profile.error) {
    return NextResponse.json({ error: profile.error.message }, { status: 500 });
  }

  const role = profile.data?.role === "teacher" ? "teacher" : "parent";
  const name = profile.data?.full_name ?? (role === "parent" ? "הורה" : "מורה");

  // Ownership (who created the child profile) and role label are independent
  // now — a teacher can own a profile they created, just as a parent can join
  // one someone else created. Check real ownership/links, not `role`.
  const owned = await client
    .from("children")
    .select("id, display_name, teacher_email")
    .eq("parent_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (owned.error) {
    return NextResponse.json({ error: owned.error.message }, { status: 500 });
  }

  if (owned.data) {
    return NextResponse.json({
      userId,
      email,
      name,
      role,
      accountType: "create",
      childId: owned.data.id,
      childName: owned.data.display_name,
      teacherEmail: owned.data.teacher_email ?? undefined,
    });
  }

  const links = await client
    .from("child_caregivers")
    .select("child_id")
    .eq("caregiver_id", userId);

  let linkedChildren: Array<{ id: string; name: string }> = [];
  if (!links.error && links.data?.length) {
    const childIds = links.data.map((row) => row.child_id);
    const children = await client
      .from("children")
      .select("id, display_name")
      .in("id", childIds)
      .order("created_at", { ascending: true });

    if (!children.error && children.data) {
      linkedChildren = children.data.map((child) => ({
        id: child.id,
        name: child.display_name,
      }));
    }
  }

  const activeChild = linkedChildren[0];

  return NextResponse.json({
    userId,
    email,
    name,
    role,
    accountType: "join",
    childId: activeChild?.id,
    childName: activeChild?.name,
    linkedChildren,
  });
}
