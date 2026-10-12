"use client";

import { useEffect, useMemo, useState } from "react";
import { type AacSymbol, type CalendarEvent, arasaacImageUrl, symbols } from "@/lib/demo-data";
import { getWeeklyTopicSentences } from "@/lib/context-engine";
import { genderWord } from "@/lib/hebrew-grammar";
import {
  FALLBACK_CORE_SYMBOLS,
  FALLBACK_EVENT_SYMBOLS,
  MAX_EVENT_SYMBOLS,
  type EventSymbolsResult,
} from "@/lib/event-symbols";
import {
  readJsonResponse,
  eventInfo,
  today,
  cx,
  resolveSymbolImage,
  SymbolTile,
} from "@/components/smartaac/shared";

const daysFromToday = (dateValue: string): number => {
  const current = new Date(today());
  const target = new Date(dateValue);
  return Math.round((target.getTime() - current.getTime()) / 86_400_000);
};

const EVENT_SYMBOLS_CACHE_KEY = "smartaac-event-symbols";

const eventWhenLabel = (event: CalendarEvent): string => {
  const distance = daysFromToday(event.date);
  if (distance === 0) return "היום";
  if (distance === 1) return "מחר";
  if (distance === -1) return "אתמול";
  return distance > 0 ? `בעוד ${distance} ימים` : `לפני ${Math.abs(distance)} ימים`;
};

// Before / on / after the day get different words ("מתרגש" vs "נהניתי"),
// so the cached AI answer is kept per phase.
const eventSymbolsKey = (event: CalendarEvent): string => {
  const distance = daysFromToday(event.date);
  const phase = distance > 0 ? "before" : distance === 0 ? "today" : "after";
  return `${event.id}|${event.title}|${event.customLabel ?? event.type}|${phase}`;
};

const readEventSymbolsCache = (): Record<string, EventSymbolsResult> => {
  try {
    return JSON.parse(window.localStorage.getItem(EVENT_SYMBOLS_CACHE_KEY) ?? "{}") as Record<
      string,
      EventSymbolsResult
    >;
  } catch {
    return {};
  }
};

const writeEventSymbolsCache = (cache: Record<string, EventSymbolsResult>): void => {
  try {
    // keep it small: only the 40 most recent events
    const entries = Object.entries(cache).slice(-40);
    window.localStorage.setItem(EVENT_SYMBOLS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // storage full or blocked — the symbols are just fetched again
  }
};

// "אני קצת עצוב" → "אני קצת עצובה" for a girl, word by word.
const genderSentence = (text: string, gender: "boy" | "girl"): string =>
  text
    .split(" ")
    .map((word) => {
      const core = word.replace(/[?!.,]+$/, "");
      return genderWord(core, gender) + word.slice(core.length);
    })
    .join(" ");

// The board symbols that appear in a sentence, so a child who can't read
// sees "אני · רוצה · ללכת" as pictures. Matches whole words against symbol
// labels, also without a one-letter prefix (ו/ה/ב/ל/מ/ש/כ: "וללכת" → "ללכת").
const sentenceSymbols = (text: string, byLabel: Map<string, AacSymbol>, max = 4): AacSymbol[] => {
  const found: AacSymbol[] = [];
  for (const word of text.replace(/[?!.,:;״"׳'()]/g, " ").split(/\s+/)) {
    if (!word) continue;
    const withoutPrefix = word.length > 2 && "ובהלמשכ".includes(word.charAt(0)) ? word.slice(1) : "";
    const symbol = byLabel.get(word) ?? (withoutPrefix ? byLabel.get(withoutPrefix) : undefined);
    if (symbol && !found.includes(symbol)) found.push(symbol);
    if (found.length >= max) break;
  }
  return found;
};

// A sentence the child taps to hear: big pictures on top, the words small
// underneath for the adult.
function SentenceCard({
  text,
  symbols,
  fallbackEmoji,
  symbolImages,
  tone,
  onClick,
}: {
  text: string;
  symbols: AacSymbol[];
  fallbackEmoji: string;
  symbolImages: Record<string, string>;
  tone: "amber" | "violet";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        "relative flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 p-4 text-center shadow-sm transition active:scale-95",
        tone === "amber" ? "border-amber-200 bg-amber-50" : "border-violet-200 bg-white",
      )}
      onClick={onClick}
      aria-label={text}
    >
      <span className="absolute left-3 top-3 text-xl" aria-hidden>
        🔊
      </span>
      <span className="flex flex-wrap items-end justify-center gap-3" aria-hidden>
        {symbols.length === 0 ? (
          <span className="text-6xl leading-none">{fallbackEmoji}</span>
        ) : (
          symbols.map((symbol) => {
            const imageUrl = resolveSymbolImage(symbol, symbolImages);
            return (
              <span key={symbol.id} className="flex w-20 flex-col items-center">
                {imageUrl || symbol.pictogramId ? (
                  <img
                    src={imageUrl || arasaacImageUrl(symbol.pictogramId as number)}
                    alt=""
                    className={cx("h-16 w-16 object-cover", imageUrl ? "rounded-full" : "rounded-md")}
                  />
                ) : (
                  <span className="text-5xl leading-[4rem]">{symbol.emoji}</span>
                )}
                <span className="mt-1 text-xs font-black text-slate-700">{symbol.label}</span>
              </span>
            );
          })
        )}
      </span>
      <span className="text-sm font-bold text-slate-500">{text}</span>
    </button>
  );
}

// Always shown at the top of the child's events screen.
const EVENT_CORE_SYMBOL_IDS = ["i", "want", "more", "yes", "no", "help", "stop", "done"];

export function ChildEventsView({
  eventsThisWeek,
  activeTopic,
  topicSymbols,
  allSymbols,
  symbolImages,
  onSymbolClick,
  onWordClick,
  onBack,
  onPhraseClick,
  childGender,
}: {
  childGender: "boy" | "girl";
  eventsThisWeek: CalendarEvent[];
  allSymbols: AacSymbol[];
  activeTopic: { id: string; label: string; emoji: string } | undefined;
  topicSymbols: AacSymbol[];
  symbolImages: Record<string, string>;
  onSymbolClick: (symbolId: string) => void;
  onWordClick: (word: string, picture?: { pictogramId?: number; emoji?: string }) => void;
  onBack: () => void;
  onPhraseClick: (phrase: string) => void;
}) {
  const [showTopicPanel, setShowTopicPanel] = useState(false);

  const sortedEvents = [...eventsThisWeek].sort(
    (left, right) => Math.abs(daysFromToday(left.date)) - Math.abs(daysFromToday(right.date)),
  );

  const topicSentences = activeTopic ? getWeeklyTopicSentences(activeTopic.id) : [];
  const symbolById = useMemo(
    () => Object.fromEntries(allSymbols.map((symbol) => [symbol.id, symbol])) as Record<string, AacSymbol>,
    [allSymbols],
  );
  const [eventSymbols, setEventSymbols] = useState<Record<string, EventSymbolsResult>>({});
  const [loadingKeys, setLoadingKeys] = useState<string[]>([]);

  // Ask the AI once per event (and per before/on/after phase) for the symbols
  // that fit it; answers are cached on the device.
  const eventKeys = sortedEvents.map(eventSymbolsKey).join("\n");
  useEffect(() => {
    const cache = readEventSymbolsCache();
    setEventSymbols(cache);
    const missing = sortedEvents.filter((event) => !cache[eventSymbolsKey(event)]);
    if (missing.length === 0) return;

    let cancelled = false;
    const vocabulary = allSymbols.map((symbol) => ({ id: symbol.id, label: symbol.label }));
    setLoadingKeys(missing.map(eventSymbolsKey));
    void (async () => {
      for (const event of missing) {
        const key = eventSymbolsKey(event);
        try {
          const response = await fetch("/api/event-symbols", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: { title: event.title, typeLabel: eventInfo(event).label, when: eventWhenLabel(event) },
              vocabulary,
            }),
            signal: AbortSignal.timeout(20000),
          });
          const payload = (await readJsonResponse(response)) as { result?: EventSymbolsResult | null };
          if (cancelled) return;
          if (payload.result) {
            const next = { ...readEventSymbolsCache(), [key]: payload.result };
            writeEventSymbolsCache(next);
            setEventSymbols(next);
          }
        } catch {
          // keep the built-in symbols for this event
        }
        if (!cancelled) setLoadingKeys((current) => current.filter((item) => item !== key));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKeys]);

  const symbolsForEvent = (event: CalendarEvent): { symbols: AacSymbol[]; extraWords: EventSymbolsResult["extraWords"] } => {
    const result = eventSymbols[eventSymbolsKey(event)];
    const ids = result
      ? result.symbolIds
      : [...(FALLBACK_EVENT_SYMBOLS[event.type] ?? []), ...FALLBACK_CORE_SYMBOLS];
    const symbols = [...new Set(ids)]
      .map((id) => symbolById[id])
      .filter((symbol): symbol is AacSymbol => Boolean(symbol))
      .slice(0, MAX_EVENT_SYMBOLS);
    return { symbols, extraWords: result?.extraWords ?? [] };
  };

  // Hidden symbols are already left out of allSymbols.
  const eventCoreSymbols = EVENT_CORE_SYMBOL_IDS.map((id) => symbolById[id]).filter(
    (symbol): symbol is AacSymbol => Boolean(symbol),
  );

  const symbolByLabel = useMemo(() => {
    const map = new Map<string, AacSymbol>();
    allSymbols.forEach((symbol) => {
      if (!map.has(symbol.label)) map.set(symbol.label, symbol);
    });
    return map;
  }, [allSymbols]);

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
          <h2 className="text-3xl font-black">🗓️ לוח אירועים</h2>
          <p className="text-muted">לכל אירוע יש סמלים משלו. לוחצים על סמלים כדי לדבר על האירוע.</p>
        </div>
      </div>

      {/* Core words are always here, whatever the events: "אני רוצה עוד",
          "די", "עזרה" go with any event (and with none). */}
      {eventCoreSymbols.length > 0 && (
        <section className="mb-4 shrink-0 rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-3">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {eventCoreSymbols.map((symbol) => (
              <SymbolTile
                key={`event-core-${symbol.id}`}
                symbol={symbol}
                imageUrl={resolveSymbolImage(symbol, symbolImages)}
                className="min-h-20"
                variant="home"
                onClick={() => onSymbolClick(symbol.id)}
              />
            ))}
          </div>
        </section>
      )}

      {activeTopic && (
        <button
          type="button"
          className={`mb-4 flex shrink-0 items-center gap-2 self-start rounded-2xl border-2 px-4 py-3 font-black shadow-sm ${
            showTopicPanel
              ? "border-violet-600 bg-violet-600 text-white"
              : "border-violet-300 bg-violet-50 text-violet-950"
          }`}
          onClick={() => setShowTopicPanel((current) => !current)}
        >
          <span className="text-2xl">{activeTopic.emoji}</span>
          נושא השבוע: {activeTopic.label}
        </button>
      )}

      {showTopicPanel && topicSymbols.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {topicSymbols.map((symbol) => (
            <SymbolTile
              key={`topic-symbol-${symbol.id}`}
              symbol={symbol}
              imageUrl={resolveSymbolImage(symbol, symbolImages)}
              variant="home"
              onClick={() => onSymbolClick(symbol.id)}
            />
          ))}
        </div>
      )}

      {showTopicPanel && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {topicSentences.map((sentence, index) => (
            <SentenceCard
              key={`topic-${sentence.text}-${index}`}
              text={genderSentence(sentence.text, childGender)}
              symbols={sentenceSymbols(sentence.text, symbolByLabel)}
              fallbackEmoji={sentence.emoji}
              symbolImages={symbolImages}
              tone="violet"
              onClick={() => onPhraseClick(genderSentence(sentence.text, childGender))}
            />
          ))}
        </div>
      )}

      {sortedEvents.length === 0 && (
        <p className="mb-3 text-sm font-black text-muted">אין אירועים השבוע</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sortedEvents.map((event) => {
          const distance = daysFromToday(event.date);
          const when =
            distance === 0
              ? "היום"
              : distance > 0
                ? `בעוד ${distance} ימים`
                : `לפני ${Math.abs(distance)} ימים`;
          const { symbols: eventBoard, extraWords } = symbolsForEvent(event);
          const isLoadingSymbols = loadingKeys.includes(eventSymbolsKey(event));

          return (
            <article
              key={event.id}
              className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-4xl">
                  {eventInfo(event).emoji}
                </span>
                <div>
                  <h3 className="text-2xl font-black">{event.title}</h3>
                  <p className="text-muted">
                    {eventInfo(event).label} · {when}
                  </p>
                </div>
              </div>
              {isLoadingSymbols && (
                <p className="mb-2 text-sm font-bold text-violet-700">✨ מכינים סמלים שמתאימים לאירוע…</p>
              )}
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {eventBoard.map((symbol) => (
                  <SymbolTile
                    key={`${event.id}-${symbol.id}`}
                    symbol={symbol}
                    imageUrl={resolveSymbolImage(symbol, symbolImages)}
                    variant="home"
                    onClick={() => onSymbolClick(symbol.id)}
                  />
                ))}
                {extraWords.map((word) => (
                  <button
                    key={`${event.id}-word-${word.label}`}
                    type="button"
                    className="rounded-xl border-2 border-slate-300 bg-white p-2 text-center shadow-soft ring-1 ring-slate-900/5 transition active:scale-95"
                    onClick={() => onWordClick(word.label, { emoji: word.emoji })}
                  >
                    <span className="block text-3xl leading-none md:text-4xl">{word.emoji}</span>
                    <span className="mt-1.5 block text-sm font-black leading-4 text-slate-950 md:text-base">
                      {word.label}
                    </span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
