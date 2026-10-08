import { NextResponse } from "next/server";
import { createAuthedSupabaseClient, isServerSupabaseConfigured } from "@/lib/supabase-server";

type CalendarEventPayload = {
  id?: string;
  type: string;
  title: string;
  date: string;
};

type ChildDataPostRequest = {
  childId?: string;
  events?: CalendarEventPayload[];
  weeklyTopic?: { id: string; label?: string };
  symbolSettings?: Record<string, unknown>;
  symbolImages?: Record<string, string>;
  usageStats?: Record<string, unknown>;
};

const readAccessToken = (request: Request): string =>
  (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

const startOfWeekIso = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - date.getDay());
  return date.toISOString().slice(0, 10);
};

async function authorizeChildAccess(
  client: ReturnType<typeof createAuthedSupabaseClient>,
  accessToken: string,
  childId: string,
): Promise<{ userId: string } | { error: NextResponse }> {
  const userResult = await client.auth.getUser(accessToken);
  if (userResult.error || !userResult.data.user) {
    return { error: NextResponse.json({ error: "not authenticated" }, { status: 401 }) };
  }

  const access = await client.rpc("can_access_child", { child_uuid: childId });
  if (access.error || access.data !== true) {
    return { error: NextResponse.json({ error: "אין הרשאה." }, { status: 403 }) };
  }

  return { userId: userResult.data.user.id };
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const accessToken = readAccessToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const childId = new URL(request.url).searchParams.get("childId")?.trim() ?? "";
  if (!childId) {
    return NextResponse.json({ error: "חסר מזהה ילד." }, { status: 400 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const authorized = await authorizeChildAccess(client, accessToken, childId);
  if ("error" in authorized) return authorized.error;

  const [eventsResult, topicResult, appStateResult] = await Promise.all([
    client
      .from("calendar_events")
      .select("id, event_type, title, event_date")
      .eq("child_id", childId)
      .order("event_date", { ascending: true }),
    client
      .from("weekly_topics")
      .select("topic_slug, label")
      .eq("child_id", childId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("child_app_state")
      .select("symbol_settings_json, symbol_images_json, usage_stats_json, has_synced_at")
      .eq("child_id", childId)
      .maybeSingle(),
  ]);

  if (eventsResult.error) {
    return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });
  }
  if (topicResult.error) {
    return NextResponse.json({ error: topicResult.error.message }, { status: 500 });
  }
  if (appStateResult.error) {
    return NextResponse.json({ error: appStateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    events: (eventsResult.data ?? []).map((row) => ({
      id: row.id,
      type: row.event_type,
      title: row.title,
      date: row.event_date,
    })),
    weeklyTopicId: topicResult.data?.topic_slug ?? null,
    weeklyTopicLabel: topicResult.data?.label ?? null,
    symbolSettings: appStateResult.data?.symbol_settings_json ?? {},
    symbolImages: appStateResult.data?.symbol_images_json ?? {},
    usageStats: appStateResult.data?.usage_stats_json ?? {},
    hasSyncedBefore: Boolean(appStateResult.data?.has_synced_at),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  const accessToken = readAccessToken(request);
  if (!accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: ChildDataPostRequest;
  try {
    body = (await request.json()) as ChildDataPostRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const childId = body.childId?.trim() ?? "";
  if (!childId) {
    return NextResponse.json({ error: "חסר מזהה ילד." }, { status: 400 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const authorized = await authorizeChildAccess(client, accessToken, childId);
  if ("error" in authorized) return authorized.error;
  const { userId } = authorized;

  const result: { events?: CalendarEventPayload[] } = {};

  if (body.events) {
    const deleted = await client.from("calendar_events").delete().eq("child_id", childId);
    if (deleted.error) {
      return NextResponse.json({ error: deleted.error.message }, { status: 500 });
    }

    if (body.events.length > 0) {
      const inserted = await client
        .from("calendar_events")
        .insert(
          body.events.map((event) => ({
            child_id: childId,
            event_type: event.type,
            title: event.title,
            event_date: event.date,
            created_by: userId,
          })),
        )
        .select("id, event_type, title, event_date");

      if (inserted.error) {
        return NextResponse.json({ error: inserted.error.message }, { status: 500 });
      }

      result.events = (inserted.data ?? []).map((row) => ({
        id: row.id,
        type: row.event_type,
        title: row.title,
        date: row.event_date,
      }));
    } else {
      result.events = [];
    }
  }

  if (body.weeklyTopic?.id) {
    const latest = await client
      .from("weekly_topics")
      .select("topic_slug")
      .eq("child_id", childId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest.error) {
      return NextResponse.json({ error: latest.error.message }, { status: 500 });
    }

    if (latest.data?.topic_slug !== body.weeklyTopic.id) {
      const inserted = await client.from("weekly_topics").insert({
        child_id: childId,
        topic_slug: body.weeklyTopic.id,
        label: body.weeklyTopic.label ?? body.weeklyTopic.id,
        week_starts_on: startOfWeekIso(),
        selected_by: userId,
      });

      if (inserted.error) {
        return NextResponse.json({ error: inserted.error.message }, { status: 500 });
      }
    }
  }

  if (body.symbolSettings || body.symbolImages || body.usageStats) {
    const upsertRow: Record<string, unknown> = {
      child_id: childId,
      has_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (body.symbolSettings) upsertRow.symbol_settings_json = body.symbolSettings;
    if (body.symbolImages) upsertRow.symbol_images_json = body.symbolImages;
    if (body.usageStats) upsertRow.usage_stats_json = body.usageStats;

    const upserted = await client
      .from("child_app_state")
      .upsert(upsertRow, { onConflict: "child_id" });

    if (upserted.error) {
      return NextResponse.json({ error: upserted.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, ...result });
}
