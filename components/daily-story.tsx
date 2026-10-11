"use client";

import { useEffect, useState } from "react";
import { arasaacImageUrl, type AacSymbol, type DemoState } from "@/lib/demo-data";
import { supabase } from "@/lib/supabase-browser";

// "מה עשינו היום": the teacher uploads photos from school and the parent photos
// from home (DailyStoryDashboard), and the child taps them to tell about the
// day (ChildDailyStoryView), in two parts: "בבית הספר" and "בבית".
// Photos are saved in Supabase Storage, one request per photo.

export type DailyStoryItem = {
  photo: string;
  sentence: string;
  words: Array<{ label: string; emoji: string; symbolId?: string; pictogramId?: number }>;
  needsWords?: boolean;
  place?: StoryPlace;
  photoKey?: string;
  // When the photo link was made (links work for 12 hours).
  linkedAt?: number;
};
export type StoryPlace = "school" | "home";
export type DailyStory = { date: string; items: DailyStoryItem[] };

const cx = (...classes: Array<string | false | undefined>): string => classes.filter(Boolean).join(" ");

const token = async (): Promise<string | null> => {
  if (!supabase) return null;
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
};

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return { error: "השרת לא הגיב כמו שצריך. נסו שוב." };
  }
};

// The last story is kept in memory and on the device, so the page shows it at
// once and refreshes from Supabase in the background. Photo links are reused
// while they still work, so the browser shows its saved copy of the photo.
const LINK_REUSE_MS = 10 * 60 * 60 * 1000;
const memoryCache = new Map<string, DailyStory | null>();
const cacheKey = (childId: string): string => `smartaac-daily-story-${childId}`;

export const readCachedStory = (childId: string | undefined): DailyStory | null | undefined => {
  if (!childId) return undefined;
  if (memoryCache.has(childId)) return memoryCache.get(childId);
  try {
    const raw = window.localStorage.getItem(cacheKey(childId));
    if (!raw) return undefined;
    const story = JSON.parse(raw) as DailyStory | null;
    // Old links stop working — drop photos whose link is too old.
    if (story) {
      story.items = story.items.filter((item) => item.photo && Date.now() - (item.linkedAt ?? 0) < LINK_REUSE_MS);
    }
    memoryCache.set(childId, story);
    return story;
  } catch {
    return undefined;
  }
};

const writeCachedStory = (childId: string, story: DailyStory | null): void => {
  memoryCache.set(childId, story);
  try {
    // Older photos saved inside the row are too big for the device cache.
    const small = story && { ...story, items: story.items.filter((item) => !item.photo.startsWith("data:")) };
    window.localStorage.setItem(cacheKey(childId), JSON.stringify(small));
  } catch {
    // the memory copy is enough
  }
};

// Keep the link the app already has for the same photo.
const withKnownLinks = (childId: string, story: DailyStory | null): DailyStory | null => {
  if (!story) return story;
  const known = new Map(
    (readCachedStory(childId)?.items ?? [])
      .filter((item) => item.photoKey && Date.now() - (item.linkedAt ?? 0) < LINK_REUSE_MS)
      .map((item) => [item.photoKey as string, item]),
  );
  return {
    ...story,
    items: story.items.map((item) => {
      const cached = item.photoKey ? known.get(item.photoKey) : undefined;
      return cached ? { ...item, photo: cached.photo, linkedAt: cached.linkedAt } : { ...item, linkedAt: Date.now() };
    }),
  };
};

const warmPhotos = (story: DailyStory | null): void => {
  for (const item of story?.items ?? []) {
    if (item.photo.startsWith("data:")) continue;
    const image = new Image();
    image.src = item.photo;
  }
};

// Saves a story from the server into the cache (and returns it).
const remember = (childId: string, story: DailyStory | null): DailyStory | null => {
  const linked = withKnownLinks(childId, story);
  writeCachedStory(childId, linked);
  warmPhotos(linked);
  return linked;
};

export const loadDailyStory = async (childId: string): Promise<{ story: DailyStory | null; error?: string }> => {
  const accessToken = await token();
  if (!accessToken) return { story: readCachedStory(childId) ?? null, error: "צריך להתחבר." };
  try {
    const response = await fetch(`/api/daily-story?childId=${childId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      return { story: readCachedStory(childId) ?? null, error: String(payload.error ?? "לא הצלחנו לטעון.") };
    }
    return { story: remember(childId, (payload.story as DailyStory | null) ?? null) };
  } catch {
    return { story: readCachedStory(childId) ?? null, error: "אין חיבור כרגע — מוצג מה שנשמר במכשיר." };
  }
};

// Called when the app opens, so the page is ready before it's opened.
let prefetching: Promise<unknown> | null = null;
export const prefetchDailyStory = (childId: string): void => {
  if (prefetching) return;
  prefetching = loadDailyStory(childId).finally(() => {
    prefetching = null;
  });
};

// Photos saved without symbols get them now (once — they are saved back).
const fillMissingWords = async (
  childId: string,
  story: DailyStory,
  symbols: AacSymbol[],
): Promise<DailyStory | null> => {
  if (!story.items.some((item) => item.needsWords || item.words.length === 0)) return null;
  const accessToken = await token();
  if (!accessToken) return null;
  try {
    const response = await fetch("/api/daily-story", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        childId,
        action: "fillWords",
        date: story.date,
        vocabulary: symbols.map((symbol) => ({ id: symbol.id, label: symbol.label, emoji: symbol.emoji })),
      }),
      signal: AbortSignal.timeout(90000),
    });
    const payload = await readJson(response);
    return response.ok ? remember(childId, (payload.story as DailyStory | null) ?? null) : null;
  } catch {
    return null;
  }
};

const PLACES: Array<{ id: StoryPlace; emoji: string; label: string }> = [
  { id: "school", emoji: "🏫", label: "בבית הספר" },
  { id: "home", emoji: "🏠", label: "בבית" },
];

const placeOf = (item: DailyStoryItem): StoryPlace => item.place ?? "school";

const formatDate = (date: string): string => date.split("-").reverse().join("/");

const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// ---------- dashboard (teacher / parent) ----------
export function DailyStoryDashboard({
  state,
  allSymbols,
  preparePhoto,
}: {
  state: DemoState;
  allSymbols: AacSymbol[];
  preparePhoto: (file: File) => Promise<string>;
}) {
  const [photos, setPhotos] = useState<Array<{ photo: string; note: string }>>([]);
  const [story, setStory] = useState<DailyStory | null>(() => readCachedStory(state.supabaseChildId) ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const childId = state.supabaseChildId;
  const canUse = state.isRegisteredInSupabase && Boolean(childId);
  // The teacher tells about school, the parent about home.
  const myPlace: StoryPlace = state.dashboardRole === "teacher" ? "school" : "home";
  const myPlaceInfo = PLACES.find((place) => place.id === myPlace) ?? PLACES[0];

  useEffect(() => {
    if (!canUse || !childId) return;
    void loadDailyStory(childId).then(async (result) => {
      setStory(result.story);
      if (result.error) setMessage(result.error);
      if (!result.story) return;
      const filled = await fillMissingWords(childId, result.story, allSymbols);
      if (filled) setStory(filled);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, childId]);

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/"));
    try {
      const prepared = await Promise.all(chosen.map((file) => preparePhoto(file)));
      setPhotos((current) => [...current, ...prepared.map((photo) => ({ photo, note: "" }))]);
      setMessage("");
    } catch {
      setMessage("לא הצלחנו לטעון את התמונה.");
    }
  };

  const post = async (body: Record<string, unknown>): Promise<{ story?: DailyStory; error?: string }> => {
    const accessToken = await token();
    if (!accessToken) return { error: "ההתחברות פגה. התחברו שוב." };
    try {
      const response = await fetch("/api/daily-story", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ childId, ...body }),
        signal: AbortSignal.timeout(90000),
      });
      const payload = await readJson(response);
      if (!response.ok) return { error: String(payload.error ?? "לא הצלחנו לשמור.") };
      return { story: remember(childId as string, payload.story as DailyStory) ?? undefined };
    } catch {
      return { error: "לקח יותר מדי זמן. נסו שוב." };
    }
  };

  // One photo per request, so there is no limit on how many.
  const create = async (): Promise<void> => {
    if (!childId || photos.length === 0) return;
    if (photos.some((item) => !item.note.trim())) {
      setMessage("כתבו משפט קצר מתחת לכל תמונה — מה עשינו.");
      return;
    }
    setBusy(true);
    const queue = [...photos];
    let done = 0;
    for (const item of queue) {
      setMessage(`שומרים ומכינים סמלים… (${done + 1} מתוך ${queue.length})`);
      const result = await post({
        photo: item.photo,
        sentence: item.note,
        place: myPlace,
        vocabulary: allSymbols.map((symbol) => ({ id: symbol.id, label: symbol.label, emoji: symbol.emoji })),
      });
      if (result.error) {
        setMessage(`${result.error}${done > 0 ? ` (${done} תמונות כבר נשמרו)` : ""}`);
        setBusy(false);
        return;
      }
      done += 1;
      if (result.story) setStory(result.story);
      setPhotos((current) => current.filter((photo) => photo !== item));
    }
    setBusy(false);
    setMessage(`הסיפור נשמר ✓ ${state.activeChildName || "הילד/ה"} יוכל/תוכל לספר אותו במסך "📸 מה עשיתי היום".`);
  };

  const removeSaved = async (index: number): Promise<void> => {
    if (!window.confirm("למחוק את התמונה מהסיפור של היום?")) return;
    setBusy(true);
    const result = await post({ action: "remove", index });
    setBusy(false);
    if (result.error) setMessage(result.error);
    else if (result.story) setStory(result.story);
  };

  if (!canUse) {
    return (
      <section>
        <h1 className="text-3xl font-black">📸 מה עשינו היום — בבית ובבית הספר</h1>
        <p className="mt-4 rounded-soft border border-amber-200 bg-amber-50 p-5 font-bold text-amber-900">
          הסיפור היומי זמין למשתמשים מחוברים, כדי שההורים והמורים יראו את אותן תמונות.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-3xl font-black">📸 מה עשינו היום</h1>
      <p className="mb-6 text-muted">
        המורה מעלה תמונות ממה שעשו בבית הספר, וההורה ממה שעשו בבית. מתחת לכל תמונה כותבים משפט קצר, ויופיעו גם
        סמלים שקשורים למה שעשו.
      </p>

      <div className="mb-6 rounded-soft border border-blue-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black">
          {myPlaceInfo.emoji} מה עשינו היום {myPlaceInfo.label}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {photos.map((item, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 p-3">
              <img src={item.photo} alt="" className="h-40 w-full rounded-xl object-cover" />
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder={myPlace === "school" ? "מה עשינו? למשל: ציירנו שמש" : "מה עשינו? למשל: אפינו עוגה"}
                value={item.note}
                maxLength={120}
                onChange={(event) =>
                  setPhotos((current) =>
                    current.map((photo, i) => (i === index ? { ...photo, note: event.target.value } : photo)),
                  )
                }
              />
              <button
                type="button"
                className="mt-2 text-sm font-black text-red-700"
                onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
              >
                הסרה
              </button>
            </div>
          ))}
          {!busy && (
            <label className="grid min-h-40 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/60 p-3 text-center font-black text-blue-800">
              <span>
                <span className="block text-4xl">📷</span>
                הוספת תמונה
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        <button
          type="button"
          disabled={busy || photos.length === 0}
          className="mt-4 rounded-2xl bg-blue-600 px-6 py-3 font-black text-white disabled:opacity-50"
          onClick={() => void create()}
        >
          {busy ? "שומרים…" : "💾 שמירה"}
        </button>
        {message && <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-800">{message}</p>}
      </div>

      {story && (
        <div className="rounded-soft border border-emerald-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">מה למדנו ועשינו ב-{formatDate(story.date)}</h2>
          {PLACES.map((place) => {
            const entries = story.items
              .map((item, index) => ({ item, index }))
              .filter((entry) => placeOf(entry.item) === place.id);
            return (
              <div key={place.id} className="mt-5">
                <h3 className="mb-3 text-lg font-black">
                  {place.emoji} {place.label}
                </h3>
                {entries.length === 0 ? (
                  <p className="text-sm text-muted">עוד אין תמונות.</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-3">
                    {entries.map(({ item, index }) => (
                      <div key={index} className="rounded-2xl bg-slate-50 p-3">
                        <img src={item.photo} alt="" className="h-36 w-full rounded-xl object-cover" />
                        <p className="mt-2 font-black">{item.sentence}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.words.map((word) => {
                            const symbol = word.symbolId
                              ? allSymbols.find((entry) => entry.id === word.symbolId)
                              : undefined;
                            const image = symbol ? state.symbolImages[symbol.id] : undefined;
                            return (
                              <span
                                key={`${index}-${word.label}`}
                                className="flex w-16 flex-col items-center rounded-xl border border-slate-200 bg-white p-1.5"
                              >
                                {image || symbol?.pictogramId || word.pictogramId ? (
                                  <img
                                    src={image || arasaacImageUrl((symbol?.pictogramId ?? word.pictogramId) as number)}
                                    alt=""
                                    className={cx("h-9 w-9 object-cover", image ? "rounded-full" : "rounded-md")}
                                  />
                                ) : (
                                  <span className="text-3xl leading-9">{word.emoji}</span>
                                )}
                                <span className="mt-0.5 text-[11px] font-black">{symbol?.label ?? word.label}</span>
                              </span>
                            );
                          })}
                          {item.words.length === 0 && <span className="text-sm text-muted">מכינים סמלים…</span>}
                        </div>
                        {story.date === todayIso() && place.id === myPlace && (
                          <button
                            type="button"
                            disabled={busy}
                            className="mt-2 text-sm font-black text-red-700 disabled:opacity-50"
                            onClick={() => void removeSaved(index)}
                          >
                            מחיקה
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- child screen ----------
export function ChildDailyStoryView({
  childId,
  symbolById,
  symbolImages,
  onBack,
  onSpeak,
  onSymbolClick,
  onWordClick,
}: {
  childId?: string;
  symbolById: Record<string, AacSymbol>;
  symbolImages: Record<string, string>;
  onBack: () => void;
  onSpeak: (text: string) => void;
  onSymbolClick: (symbolId: string) => void;
  onWordClick: (word: string, picture?: { pictogramId?: number; emoji?: string }) => void;
}) {
  const [story, setStory] = useState<DailyStory | null>(() => readCachedStory(childId) ?? null);
  const [loading, setLoading] = useState(() => readCachedStory(childId) === undefined);

  useEffect(() => {
    if (!childId) {
      setLoading(false);
      return;
    }
    void loadDailyStory(childId).then(async (result) => {
      setStory(result.story);
      setLoading(false);
      if (!result.story) return;
      const filled = await fillMissingWords(childId, result.story, Object.values(symbolById));
      if (filled) setStory(filled);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <div>
          <h2 className="text-3xl font-black">📸 מה עשיתי היום</h2>
          <p className="text-muted">לוחצים על תמונה כדי לספר מה עשיתי היום.</p>
        </div>
      </div>

      {loading ? (
        <p className="font-bold text-muted">טוען…</p>
      ) : !story ? (
        <p className="rounded-soft border border-dashed border-slate-300 bg-white p-6 text-center font-bold text-muted">
          עוד אין תמונות מהיום.
        </p>
      ) : (
        <div className="space-y-6">
          {PLACES.map((place) => {
            const entries = story.items
              .map((item, index) => ({ item, index }))
              .filter((entry) => placeOf(entry.item) === place.id);
            return (
              <section key={place.id}>
                <h3 className="mb-3 text-2xl font-black">
                  {place.emoji} {place.label}
                </h3>
                {entries.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center font-bold text-muted">
                    עוד אין תמונות.
                  </p>
                ) : (
                  <div className="grid gap-5 lg:grid-cols-3">
                    {entries.map(({ item, index }) => (
                      <article key={index} className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
                        <button
                          type="button"
                          className="block w-full overflow-hidden rounded-2xl transition active:scale-95"
                          onClick={() => onSpeak(item.sentence)}
                          aria-label={item.sentence}
                        >
                          <img src={item.photo} alt="" className="h-56 w-full object-cover" />
                        </button>
                        <p className="mt-2 text-center text-sm font-bold text-slate-500">🔊 {item.sentence}</p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                          {item.words.map((word) => {
                            const symbol = word.symbolId ? symbolById[word.symbolId] : undefined;
                            const image = symbol ? symbolImages[symbol.id] : undefined;
                            return (
                              <button
                                key={`${index}-${word.label}`}
                                type="button"
                                className="flex w-20 flex-col items-center rounded-xl border-2 border-slate-200 bg-white p-2 shadow-sm transition active:scale-95"
                                onClick={() =>
                                  symbol
                                    ? onSymbolClick(symbol.id)
                                    : onWordClick(word.label, { pictogramId: word.pictogramId, emoji: word.emoji })
                                }
                              >
                                {image || symbol?.pictogramId || word.pictogramId ? (
                                  <img
                                    src={image || arasaacImageUrl((symbol?.pictogramId ?? word.pictogramId) as number)}
                                    alt=""
                                    className={cx("h-12 w-12 object-cover", image ? "rounded-full" : "rounded-md")}
                                  />
                                ) : (
                                  <span className="text-4xl leading-[3rem]">{word.emoji}</span>
                                )}
                                <span className="mt-1 text-xs font-black">{symbol?.label ?? word.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
