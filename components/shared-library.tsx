"use client";

import { useEffect, useMemo, useState } from "react";
import { arasaacImageUrl, getAllCategories, type AacSymbol, type DemoState } from "@/lib/demo-data";
import { SHARED_BOARD_TOPICS, type SharedBoard, type SharedSymbol } from "@/lib/shared-library";
import { supabase } from "@/lib/supabase-browser";

// "הספרייה המשותפת": parents and teachers share ready-made symbol boards and
// add each other's boards to their own child in one tap.

const cx = (...classes: Array<string | false | undefined>): string =>
  classes.filter(Boolean).join(" ");

const topicById = Object.fromEntries(SHARED_BOARD_TOPICS.map((topic) => [topic.id, topic]));

const getToken = async (): Promise<string | null> => {
  if (!supabase) return null;
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token ?? null;
};

const callApi = async <T,>(input: string, init: RequestInit = {}): Promise<T> => {
  const token = await getToken();
  if (!token) throw new Error("ההתחברות פגה. התחבר/י שוב.");
  const response = await fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let payload: T & { error?: string };
  try {
    payload = JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error("השרת לא הגיב כמו שצריך. נסו שוב בעוד רגע.");
  }
  if (!response.ok) throw new Error(payload.error ?? "משהו השתבש. נסו שוב.");
  return payload;
};

function SymbolChip({ symbol }: { symbol: SharedSymbol }) {
  return (
    <span className="flex w-16 flex-col items-center rounded-xl border border-slate-200 bg-white p-1 text-center shadow-sm">
      {symbol.pictogramId ? (
        <img src={arasaacImageUrl(symbol.pictogramId)} alt={symbol.label} className="h-8 w-8 object-contain" />
      ) : (
        <span className="text-2xl leading-8">{symbol.emoji}</span>
      )}
      <span className="mt-0.5 w-full truncate text-[11px] font-bold">{symbol.label}</span>
    </span>
  );
}

export function SharedLibraryDashboard({
  state,
  allSymbols,
  update,
}: {
  state: DemoState;
  allSymbols: AacSymbol[];
  update: (updater: (current: DemoState) => DemoState) => void;
}) {
  const [boards, setBoards] = useState<SharedBoard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"popular" | "new">("popular");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [addedBoardIds, setAddedBoardIds] = useState<string[]>([]);

  const [shareCategoryId, setShareCategoryId] = useState("");
  const [shareTopic, setShareTopic] = useState<string>("other");
  const [shareDescription, setShareDescription] = useState("");
  const [isSharing, setIsSharing] = useState(false);

  const canUseLibrary = state.isRegisteredInSupabase && Boolean(supabase);
  const normalizeTitle = (title: string): string => title.replace(/\s+/g, " ").trim();
  const myCategoryTitles = new Set(getAllCategories(state).map((category) => normalizeTitle(category.label)));

  // Only the user's own categories can be shared, and only their words —
  // personal photos (state.symbolImages) are never sent.
  const shareableCategories = state.customCategories
    .map((category) => ({
      category,
      symbols: allSymbols.filter((symbol) => symbol.categoryId === category.id),
    }))
    .filter((entry) => entry.symbols.length > 0);

  const loadBoards = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");
    try {
      const payload = await callApi<{ boards: SharedBoard[] }>("/api/shared-boards");
      setBoards(payload.boards);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "לא הצלחנו לטעון את הספרייה.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canUseLibrary) void loadBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseLibrary]);

  const visibleBoards = useMemo(() => {
    const query = search.trim();
    return boards
      .filter((board) => topicFilter === "all" || board.topic === topicFilter)
      .filter(
        (board) =>
          !query ||
          board.title.includes(query) ||
          board.description.includes(query) ||
          board.symbols.some((symbol) => symbol.label.includes(query)),
      )
      .sort((left, right) =>
        sortBy === "popular"
          ? right.likes - left.likes || right.createdAt.localeCompare(left.createdAt)
          : right.createdAt.localeCompare(left.createdAt),
      );
  }, [boards, search, topicFilter, sortBy]);

  const addToMyChild = (board: SharedBoard): void => {
    const stamp = Date.now();
    const categoryId = `custom-cat-${stamp}`;
    const newSymbols: AacSymbol[] = board.symbols.map((symbol, index) => ({
      id: `custom-${stamp}-${index}`,
      label: symbol.label,
      emoji: symbol.emoji,
      categoryId,
      ...(symbol.pictogramId ? { pictogramId: symbol.pictogramId } : {}),
    }));

    update((current) => ({
      ...current,
      customCategories: [...current.customCategories, { id: categoryId, label: board.title, emoji: board.emoji }],
      customSymbols: [...current.customSymbols, ...newSymbols],
      enabledCategoryIds: [...current.enabledCategoryIds, categoryId],
    }));
    setAddedBoardIds((current) => [...current, board.id]);
    setMessage(`"${board.title}" נוסף ללוח של ${state.activeChildName || "הילד/ה"} ✓`);
  };

  const toggleLike = async (board: SharedBoard): Promise<void> => {
    setBusyId(board.id);
    try {
      const result = await callApi<{ liked: boolean }>("/api/shared-boards", {
        method: "POST",
        body: JSON.stringify({ action: "like", boardId: board.id }),
      });
      setBoards((current) =>
        current.map((item) =>
          item.id === board.id
            ? { ...item, likedByMe: result.liked, likes: item.likes + (result.liked ? 1 : -1) }
            : item,
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא הצלחנו לשמור.");
    } finally {
      setBusyId("");
    }
  };

  const deleteBoard = async (board: SharedBoard): Promise<void> => {
    if (!window.confirm(`להסיר את "${board.title}" מהספרייה? מי שכבר הוסיף אותו ישאיר אותו אצלו.`)) return;
    setBusyId(board.id);
    try {
      await callApi("/api/shared-boards?id=" + encodeURIComponent(board.id), { method: "DELETE" });
      setBoards((current) => current.filter((item) => item.id !== board.id));
      setMessage("הלוח הוסר מהספרייה.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא הצלחנו למחוק.");
    } finally {
      setBusyId("");
    }
  };

  const shareCategory = async (): Promise<void> => {
    const entry = shareableCategories.find((item) => item.category.id === shareCategoryId);
    if (!entry) {
      setMessage("בחר/י קטגוריה לשיתוף.");
      return;
    }
    setIsSharing(true);
    try {
      await callApi("/api/shared-boards", {
        method: "POST",
        body: JSON.stringify({
          action: "share",
          title: entry.category.label,
          emoji: entry.category.emoji,
          topic: shareTopic,
          description: shareDescription,
          symbols: entry.symbols.map((symbol) => ({
            label: symbol.label,
            emoji: symbol.emoji,
            pictogramId: symbol.pictogramId,
          })),
        }),
      });
      setMessage(`תודה! "${entry.category.label}" שותף בספרייה 💛`);
      setShareCategoryId("");
      setShareDescription("");
      await loadBoards();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא הצלחנו לשתף.");
    } finally {
      setIsSharing(false);
    }
  };

  if (!canUseLibrary) {
    return (
      <section>
        <h1 className="text-3xl font-black">🌍 ספרייה משותפת</h1>
        <p className="mt-4 rounded-soft border border-amber-200 bg-amber-50 p-5 font-bold text-amber-900">
          הספרייה המשותפת זמינה למשתמשים מחוברים. התחבר/י עם אימייל וסיסמה כדי לראות לוחות ששיתפו הורים
          ומורים אחרים ולשתף משלך.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-3xl font-black">🌍 ספרייה משותפת</h1>
      <p className="mb-6 text-muted">
        לוחות מוכנים שהורים ומורים בנו ושיתפו. מצאת לוח שמתאים? לחיצה אחת והוא אצל הילד/ה שלך.
      </p>

      {message && (
        <p className="mb-4 rounded-2xl bg-emerald-50 p-3 font-bold text-emerald-900 shadow-sm">{message}</p>
      )}

      <div className="mb-6 rounded-soft border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-4 py-2"
            placeholder="🔍 חיפוש: חנוכה, רופא, ים..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(
              [
                ["popular", "❤️ הכי מועילים"],
                ["new", "🆕 חדשים"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-black text-slate-600",
                  sortBy === id && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => setSortBy(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[{ id: "all", label: "הכל", emoji: "📚" }, ...SHARED_BOARD_TOPICS].map((topic) => (
            <button
              key={topic.id}
              type="button"
              className={cx(
                "rounded-full border px-3 py-1 text-sm font-black",
                topicFilter === topic.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700",
              )}
              onClick={() => setTopicFilter(topic.id)}
            >
              {topic.emoji} {topic.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="font-bold text-muted">טוען את הספרייה…</p>}
      {loadError && (
        <p className="mb-4 rounded-2xl bg-red-50 p-3 font-bold text-red-900 shadow-sm">{loadError}</p>
      )}
      {!isLoading && !loadError && visibleBoards.length === 0 && (
        <p className="mb-6 rounded-soft border border-dashed border-slate-300 bg-white p-6 text-center font-bold text-muted">
          {boards.length === 0
            ? "הספרייה עדיין ריקה — היו הראשונים לשתף לוח! 🌱"
            : "לא נמצאו לוחות שמתאימים לחיפוש."}
        </p>
      )}

      <div className="mb-10 grid gap-4 lg:grid-cols-2">
        {visibleBoards.map((board) => {
          const topic = topicById[board.topic] ?? topicById.other;
          const isAdded = addedBoardIds.includes(board.id);
          const alreadyExists = !isAdded && myCategoryTitles.has(normalizeTitle(board.title));
          return (
            <article key={board.id} className="rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-3xl">
                  {board.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-black">{board.title}</h2>
                  <p className="text-sm text-muted">
                    {topic.emoji} {topic.label} · {board.symbols.length} סמלים · שיתף/ה {board.authorName} (
                    {board.authorRole === "teacher" ? "מורה" : "הורה"})
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === board.id}
                  className={cx(
                    "shrink-0 rounded-full border px-3 py-1.5 text-sm font-black",
                    board.likedByMe
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-slate-200 bg-white text-slate-600",
                  )}
                  onClick={() => void toggleLike(board)}
                  title="הלוח הזה עזר לי"
                >
                  {board.likedByMe ? "❤️" : "🤍"} עזר לי · {board.likes}
                </button>
              </div>
              {board.description && <p className="mt-3 text-slate-700">{board.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {board.symbols.slice(0, 10).map((symbol, index) => (
                  <SymbolChip key={`${board.id}-${index}`} symbol={symbol} />
                ))}
                {board.symbols.length > 10 && (
                  <span className="grid w-16 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-600">
                    +{board.symbols.length - 10}
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isAdded || alreadyExists}
                  className="rounded-2xl bg-emerald-600 px-5 py-2.5 font-black text-white disabled:bg-emerald-200 disabled:text-emerald-900"
                  onClick={() => addToMyChild(board)}
                >
                  {isAdded
                    ? "✓ נוסף"
                    : alreadyExists
                      ? `✓ קיים אצל ${state.activeChildName || "הילד/ה"}`
                      : `➕ הוסף ל${state.activeChildName || "ילד/ה שלי"}`}
                </button>
                {board.isMine && (
                  <button
                    type="button"
                    disabled={busyId === board.id}
                    className="rounded-2xl border border-red-200 bg-white px-4 py-2.5 font-black text-red-700"
                    onClick={() => void deleteBoard(board)}
                  >
                    הסר מהספרייה
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-soft border border-violet-200 bg-violet-50 p-5 shadow-sm">
        <h2 className="text-2xl font-black">📤 שתפו לוח משלכם</h2>
        <p className="mt-1 text-muted">
          בניתם קטגוריה שעובדת טוב? שתפו אותה ועזרו למשפחה אחרת. משותפים רק המילים והסמלים — תמונות
          אישיות ושם הילד/ה לא נשלחים לעולם.
        </p>
        {shareableCategories.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white p-4 font-bold text-slate-700">
            עוד אין לך קטגוריה משלך עם סמלים. אפשר ליצור אחת בלשונית &quot;סמלים&quot; ← &quot;הוספת קטגוריה
            חדשה&quot;.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <label className="grid gap-1">
              <span className="text-sm font-black">איזו קטגוריה לשתף?</span>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                value={shareCategoryId}
                onChange={(event) => setShareCategoryId(event.target.value)}
              >
                <option value="">בחר/י…</option>
                {shareableCategories.map(({ category, symbols }) => (
                  <option key={category.id} value={category.id}>
                    {category.emoji} {category.label} ({symbols.length} סמלים)
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-black">נושא</span>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                value={shareTopic}
                onChange={(event) => setShareTopic(event.target.value)}
              >
                {SHARED_BOARD_TOPICS.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.emoji} {topic.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={isSharing || !shareCategoryId}
              className="rounded-2xl bg-violet-600 px-5 py-2.5 font-black text-white disabled:opacity-60"
              onClick={() => void shareCategory()}
            >
              {isSharing ? "משתף…" : "שתף בספרייה"}
            </button>
            <label className="grid gap-1 lg:col-span-3">
              <span className="text-sm font-black">טיפ קצר לאחרים (לא חובה)</span>
              <input
                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                maxLength={300}
                placeholder='למשל: "עזר לנו מאוד לפני ביקור אצל רופא שיניים"'
                value={shareDescription}
                onChange={(event) => setShareDescription(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
