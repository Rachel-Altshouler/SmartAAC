import { NextResponse } from "next/server";
import { readActiveChildCode } from "@/lib/auth-setup";
import { createAuthedSupabaseClient, isServerSupabaseConfigured } from "@/lib/supabase-server";

type CalendarEventPayload = {
  id?: string;
  type: string;
  title: string;
  date: string;
  customLabel?: string;
  customEmoji?: string;
};

type ChildDataPostRequest = {
  childId?: string;
  // Events are added / deleted one at a time, so two people editing the same
  // child's calendar never overwrite each other's changes.
  addEvent?: CalendarEventPayload;
  deleteEventId?: string;
  weeklyTopic?: { id: string; label?: string };
  symbolSettings?: Record<string, unknown>;
  symbolImages?: Record<string, string>;
  // Photo changes from one device: only these are written, so a parent and a
  // teacher changing different photos never undo each other.
  symbolImagesPatch?: { set?: Record<string, string>; remove?: string[] };
  // With a deviceId, usageStats is that device's own slice (see lib/usage-stats.ts).
  deviceId?: string;
  usageStats?: Record<string, unknown>;
};

const EVENT_TYPES = ["school", "trip", "birthday", "family", "special", "custom"];

type EventRow = {
  id: string;
  event_type: string;
  title: string;
  event_date: string;
  custom_label?: string | null;
  custom_emoji?: string | null;
};

const toEvent = (row: EventRow): CalendarEventPayload => ({
  id: row.id,
  type: row.event_type,
  title: row.title,
  date: row.event_date,
  ...(row.custom_label ? { customLabel: row.custom_label } : {}),
  ...(row.custom_emoji ? { customEmoji: row.custom_emoji } : {}),
});

// Migration 004 adds the custom_* columns; until it runs, fall back to the
// original columns so events keep working.
const isMissingCustomColumns = (message: string): boolean =>
  /custom_(label|emoji)|event_type_check|schema cache/i.test(message);

async function loadEvents(
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
): Promise<{ events: CalendarEventPayload[] } | { error: string }> {
  const full = await client
    .from("calendar_events")
    .select("id, event_type, title, event_date, custom_label, custom_emoji")
    .eq("child_id", childId)
    .order("event_date", { ascending: true });
  if (!full.error) return { events: (full.data ?? []).map(toEvent) };
  if (!isMissingCustomColumns(full.error.message)) return { error: full.error.message };

  const basic = await client
    .from("calendar_events")
    .select("id, event_type, title, event_date")
    .eq("child_id", childId)
    .order("event_date", { ascending: true });
  if (basic.error) return { error: basic.error.message };
  return { events: (basic.data ?? []).map(toEvent) };
}

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

  const searchParams = new URL(request.url).searchParams;
  const childId = searchParams.get("childId")?.trim() ?? "";
  if (!childId) {
    return NextResponse.json({ error: "חסר מזהה ילד." }, { status: 400 });
  }

  const client = createAuthedSupabaseClient(accessToken);
  const authorized = await authorizeChildAccess(client, accessToken, childId);
  if ("error" in authorized) return authorized.error;

  // Cheap refresh used when the app regains focus: events only, without the
  // (possibly large) photo payload.
  if (searchParams.get("only") === "events") {
    const loaded = await loadEvents(client, childId);
    if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 500 });
    return NextResponse.json({ events: loaded.events });
  }

  const [eventsResult, topicResult, appStateResult] = await Promise.all([
    loadEvents(client, childId),
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

  if ("error" in eventsResult) {
    return NextResponse.json({ error: eventsResult.error }, { status: 500 });
  }
  if (topicResult.error) {
    return NextResponse.json({ error: topicResult.error.message }, { status: 500 });
  }
  if (appStateResult.error) {
    return NextResponse.json({ error: appStateResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    events: eventsResult.events,
    weeklyTopicId: topicResult.data?.topic_slug ?? null,
    weeklyTopicLabel: topicResult.data?.label ?? null,
    symbolSettings: appStateResult.data?.symbol_settings_json ?? {},
    symbolImages: appStateResult.data?.symbol_images_json ?? {},
    usageStats: appStateResult.data?.usage_stats_json ?? {},
    hasSyncedBefore: Boolean(appStateResult.data?.has_synced_at),
    accessCode: await readActiveChildCode(childId),
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

  const result: { event?: CalendarEventPayload } = {};

  if (body.deleteEventId) {
    const deleted = await client
      .from("calendar_events")
      .delete()
      .eq("child_id", childId)
      .eq("id", body.deleteEventId.trim());
    if (deleted.error) {
      return NextResponse.json({ error: deleted.error.message }, { status: 500 });
    }
  }

  if (body.addEvent) {
    const event = body.addEvent;
    const title = typeof event.title === "string" ? event.title.trim().slice(0, 80) : "";
    const date = typeof event.date === "string" ? event.date.trim() : "";
    const type = EVENT_TYPES.includes(event.type) ? event.type : "special";
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "חסר שם או תאריך לאירוע." }, { status: 400 });
    }
    const customLabel =
      type === "custom" && typeof event.customLabel === "string" ? event.customLabel.trim().slice(0, 30) : "";
    const customEmoji =
      type === "custom" && typeof event.customEmoji === "string" ? event.customEmoji.trim().slice(0, 16) : "";

    const base = { child_id: childId, title, event_date: date, created_by: userId };
    let inserted = await client
      .from("calendar_events")
      .insert({
        ...base,
        event_type: type,
        ...(type === "custom" ? { custom_label: customLabel || null, custom_emoji: customEmoji || null } : {}),
      })
      .select("*")
      .single();

    if (inserted.error && type === "custom" && isMissingCustomColumns(inserted.error.message)) {
      // Before migration 004: keep the event as a "special" one.
      inserted = await client
        .from("calendar_events")
        .insert({ ...base, event_type: "special" })
        .select("*")
        .single();
    }
    if (inserted.error) {
      return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    }
    result.event = toEvent(inserted.data as EventRow);
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

  if (body.symbolImagesPatch) {
    const current = await client
      .from("child_app_state")
      .select("symbol_images_json")
      .eq("child_id", childId)
      .maybeSingle();
    if (current.error) {
      return NextResponse.json({ error: current.error.message }, { status: 500 });
    }
    const merged: Record<string, string> = {
      ...((current.data?.symbol_images_json as Record<string, string> | null) ?? {}),
      ...(body.symbolImagesPatch.set ?? {}),
    };
    (body.symbolImagesPatch.remove ?? []).forEach((symbolId) => delete merged[symbolId]);
    body.symbolImages = merged;
  }

  if (body.usageStats && body.deviceId) {
    const current = await client
      .from("child_app_state")
      .select("usage_stats_json")
      .eq("child_id", childId)
      .maybeSingle();
    if (current.error) {
      return NextResponse.json({ error: current.error.message }, { status: 500 });
    }
    const stored = (current.data?.usage_stats_json ?? {}) as { devices?: Record<string, unknown> };
    // An older single record becomes one more slice, so nothing is lost.
    const devices: Record<string, unknown> = stored.devices
      ? { ...stored.devices }
      : Object.keys(stored).length > 0
        ? { legacy: stored }
        : {};
    devices[body.deviceId.slice(0, 80)] = body.usageStats;
    body.usageStats = { devices };
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
