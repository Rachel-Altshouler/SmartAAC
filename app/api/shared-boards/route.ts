import { NextResponse } from "next/server";
import { isSharedBoardTopic, type SharedSymbol } from "@/lib/shared-library";
import { createAuthedSupabaseClient, isServerSupabaseConfigured } from "@/lib/supabase-server";

// "הספרייה המשותפת" — see supabase/migrations/003_shared_library.sql.

type ShareBody = {
  action: "share";
  title?: unknown;
  emoji?: unknown;
  topic?: unknown;
  description?: unknown;
  symbols?: unknown;
};

type LikeBody = { action: "like"; boardId?: unknown };

const MAX_SYMBOLS = 40;

const readAccessToken = (request: Request): string =>
  (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

// Keep only plain words/emoji/pictogram ids. Anything else (e.g. an uploaded
// photo as a data: URL) is dropped so personal pictures can never be shared.
const cleanSymbols = (value: unknown): SharedSymbol[] =>
  (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const label = text(record.label, 40);
      const emoji = text(record.emoji, 16) || "⭐";
      const pictogramId =
        typeof record.pictogramId === "number" && Number.isInteger(record.pictogramId) && record.pictogramId > 0
          ? record.pictogramId
          : undefined;
      return { label, emoji, ...(pictogramId ? { pictogramId } : {}) };
    })
    .filter((symbol) => symbol.label)
    .slice(0, MAX_SYMBOLS);

async function authorize(
  request: Request,
): Promise<
  { error: NextResponse } | { client: ReturnType<typeof createAuthedSupabaseClient>; userId: string }
> {
  if (!isServerSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Supabase is not configured" }, { status: 500 }) };
  }
  const accessToken = readAccessToken(request);
  if (!accessToken) {
    return { error: NextResponse.json({ error: "צריך להתחבר כדי להשתמש בספרייה." }, { status: 401 }) };
  }
  const client = createAuthedSupabaseClient(accessToken);
  const user = await client.auth.getUser(accessToken);
  if (user.error || !user.data.user) {
    return { error: NextResponse.json({ error: "ההתחברות פגה. התחבר/י שוב." }, { status: 401 }) };
  }
  return { client, userId: user.data.user.id };
}

const missingTableHint = (message: string): string =>
  message.includes("shared_board") && message.toLowerCase().includes("schema cache")
    ? "הספרייה עוד לא הופעלה. הריצ/י את supabase/migrations/003_shared_library.sql ב-Supabase → SQL Editor."
    : message;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { client, userId } = auth;

  const [boards, likes] = await Promise.all([
    client
      .from("shared_boards")
      .select("id, author_id, author_name, author_role, title, emoji, topic, description, symbols_json, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client.from("shared_board_likes").select("board_id, user_id"),
  ]);

  if (boards.error) {
    return NextResponse.json({ error: missingTableHint(boards.error.message) }, { status: 500 });
  }
  if (likes.error) {
    return NextResponse.json({ error: missingTableHint(likes.error.message) }, { status: 500 });
  }

  const likeCount = new Map<string, number>();
  const likedByMe = new Set<string>();
  (likes.data ?? []).forEach((like) => {
    likeCount.set(like.board_id, (likeCount.get(like.board_id) ?? 0) + 1);
    if (like.user_id === userId) likedByMe.add(like.board_id);
  });

  return NextResponse.json({
    boards: (boards.data ?? []).map((board) => ({
      id: board.id,
      authorName: board.author_name,
      authorRole: board.author_role,
      title: board.title,
      emoji: board.emoji,
      topic: board.topic,
      description: board.description,
      symbols: board.symbols_json ?? [],
      createdAt: board.created_at,
      likes: likeCount.get(board.id) ?? 0,
      likedByMe: likedByMe.has(board.id),
      isMine: board.author_id === userId,
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { client, userId } = auth;

  let body: ShareBody | LikeBody;
  try {
    body = (await request.json()) as ShareBody | LikeBody;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  if (body.action === "like") {
    const boardId = text(body.boardId, 64);
    if (!boardId) return NextResponse.json({ error: "חסר לוח." }, { status: 400 });

    const existing = await client
      .from("shared_board_likes")
      .select("board_id")
      .eq("board_id", boardId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ error: missingTableHint(existing.error.message) }, { status: 500 });
    }

    const result = existing.data
      ? await client.from("shared_board_likes").delete().eq("board_id", boardId).eq("user_id", userId)
      : await client.from("shared_board_likes").insert({ board_id: boardId, user_id: userId });
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, liked: !existing.data });
  }

  if (body.action !== "share") {
    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }

  const title = text(body.title, 60);
  const symbols = cleanSymbols(body.symbols);
  if (!title) return NextResponse.json({ error: "צריך שם ללוח." }, { status: 400 });
  if (symbols.length === 0) {
    return NextResponse.json({ error: "בקטגוריה הזו אין עדיין סמלים לשתף." }, { status: 400 });
  }

  const topicValue = text(body.topic, 20);
  const topic = isSharedBoardTopic(topicValue) ? topicValue : "other";

  const profile = await client.from("users").select("full_name, role").eq("id", userId).maybeSingle();
  const authorRole = profile.data?.role === "teacher" ? "teacher" : "parent";
  // First name only — enough to thank someone, without exposing a full name.
  const authorName =
    (profile.data?.full_name ?? "").trim().split(/\s+/)[0] || (authorRole === "teacher" ? "מורה" : "הורה");

  const inserted = await client
    .from("shared_boards")
    .insert({
      author_id: userId,
      author_name: authorName,
      author_role: authorRole,
      title,
      emoji: text(body.emoji, 16) || "📁",
      topic,
      description: text(body.description, 300),
      symbols_json: symbols,
    })
    .select("id")
    .single();

  if (inserted.error) {
    return NextResponse.json({ error: missingTableHint(inserted.error.message) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: inserted.data.id });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const { client, userId } = auth;

  const boardId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!boardId) return NextResponse.json({ error: "חסר לוח." }, { status: 400 });

  const deleted = await client
    .from("shared_boards")
    .delete()
    .eq("id", boardId)
    .eq("author_id", userId)
    .select("id");
  if (deleted.error) {
    return NextResponse.json({ error: deleted.error.message }, { status: 500 });
  }
  if (!deleted.data?.length) {
    return NextResponse.json({ error: "אפשר למחוק רק לוח ששיתפת." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
