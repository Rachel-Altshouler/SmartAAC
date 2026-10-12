"use client";

import { useState } from "react";
import {
  type AacSymbol,
  type DemoState,
  type WeeklyTopic,
  arasaacImageUrl,
  symbols,
  weeklyTopics,
} from "@/lib/demo-data";
import { cx, searchPictograms } from "@/components/smartaac/shared";

// Category of words typed in while creating a weekly topic: no such category
// on the board, so they appear only with their topic, not in the board's rows.
const TOPIC_WORDS_CATEGORY_ID = "topic-words";

const TOPIC_EMOJI_CHOICES = ["⭐", "🌳", "🐶", "🚗", "🏖️", "❄️", "🕎", "🍎", "🎵", "⚽", "🧸", "🌈", "🦁", "🚌", "🩺", "🎉"];

export function TopicDashboard({
  state,
  allSymbols,
  update,
}: {
  state: DemoState;
  allSymbols: AacSymbol[];
  update: (updater: (current: DemoState) => DemoState) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState(TOPIC_EMOJI_CHOICES[0] ?? "⭐");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  // Words typed in for this topic that aren't symbols yet; they become symbols
  // only when the topic is saved (cancel leaves nothing behind).
  const [newWords, setNewWords] = useState<AacSymbol[]>([]);
  const [isAddingWord, setIsAddingWord] = useState(false);

  const customTopics = state.customTopics ?? [];
  const symbolById = Object.fromEntries([...allSymbols, ...newWords].map((symbol) => [symbol.id, symbol])) as Record<
    string,
    AacSymbol
  >;
  const query = search.trim();
  const searchResults = [...newWords, ...allSymbols]
    .filter((symbol) => !query || symbol.label.includes(query))
    .slice(0, 48);
  const queryExists = [...allSymbols, ...newWords].some((symbol) => symbol.label === query);

  // A word that isn't on the board: a new symbol (with the ARASAAC pictogram
  // for it, when there is one), picked for this topic.
  const addNewWord = async (): Promise<void> => {
    const word = query.slice(0, 30);
    if (!word || queryExists || isAddingWord) return;
    setIsAddingWord(true);
    const pictogramId = (await searchPictograms(word).catch(() => []))[0];
    const symbol: AacSymbol = {
      id: `custom-${Date.now()}`,
      label: word,
      emoji: "⭐",
      categoryId: TOPIC_WORDS_CATEGORY_ID,
      ...(pictogramId ? { pictogramId } : {}),
    };
    setNewWords((current) => [...current, symbol]);
    setPickedIds((current) => [...current, symbol.id]);
    setSearch("");
    setFormError("");
    setIsAddingWord(false);
  };

  const togglePicked = (symbolId: string): void =>
    setPickedIds((current) =>
      current.includes(symbolId) ? current.filter((id) => id !== symbolId) : [...current, symbolId],
    );

  const saveTopic = (): void => {
    if (!label.trim()) {
      setFormError("הזינ/י שם לנושא, למשל: חנוכה, חורף, בעלי חיים.");
      return;
    }
    if (pickedIds.length === 0) {
      setFormError("בחר/י לפחות סמל אחד שמתאים לנושא.");
      return;
    }
    const topic: WeeklyTopic = {
      id: `custom-topic-${Date.now()}`,
      label: label.trim().slice(0, 30),
      emoji,
      symbolIds: pickedIds,
    };
    const addedWords = newWords.filter((symbol) => pickedIds.includes(symbol.id));
    update((current) => ({
      ...current,
      customSymbols: [...current.customSymbols, ...addedWords],
      customTopics: [...(current.customTopics ?? []), topic],
      weeklyTopicId: topic.id,
    }));
    setIsCreating(false);
    setLabel("");
    setPickedIds([]);
    setNewWords([]);
    setSearch("");
    setFormError("");
  };

  const deleteTopic = (topicId: string): void => {
    if (!window.confirm("למחוק את הנושא הזה?")) return;
    update((current) => {
      const remaining = (current.customTopics ?? []).filter((topic) => topic.id !== topicId);
      // Words added just for topics go too, unless another topic still uses them.
      const stillUsed = new Set(remaining.flatMap((topic) => topic.symbolIds));
      return {
        ...current,
        customTopics: remaining,
        customSymbols: current.customSymbols.filter(
          (symbol) => symbol.categoryId !== TOPIC_WORDS_CATEGORY_ID || stillUsed.has(symbol.id),
        ),
        weeklyTopicId: current.weeklyTopicId === topicId ? "feelings" : current.weeklyTopicId,
      };
    });
  };

  const topicButton = (topic: WeeklyTopic, isCustom: boolean) => {
    const isSelected = state.weeklyTopicId === topic.id;
    return (
      <div key={topic.id} className="relative">
        <button
          type="button"
          className={cx(
            "w-full rounded-soft border p-5 text-center font-black shadow-sm",
            isSelected ? "border-blue-500 bg-blue-500 text-white" : "border-slate-200 bg-white text-slate-950",
          )}
          onClick={() => update((current) => ({ ...current, weeklyTopicId: topic.id }))}
        >
          <span className="block text-4xl">{topic.emoji}</span>
          <span className={cx("mt-2 block", isSelected ? "text-white" : "text-slate-950")}>{topic.label}</span>
          {isCustom && (
            <span className={cx("mt-1 block text-xs", isSelected ? "text-blue-100" : "text-muted")}>
              נושא שלי · {topic.symbolIds.length} סמלים
            </span>
          )}
        </button>
        {isCustom && (
          <button
            type="button"
            className="absolute left-2 top-2 rounded-full bg-white/90 px-2 text-sm font-black text-red-700 shadow-sm"
            onClick={() => deleteTopic(topic.id)}
            aria-label={`מחק את הנושא ${topic.label}`}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <section>
      <h1 className="text-3xl font-black">נושא שבועי</h1>
      <p className="mb-6 text-muted">
        הנושא מוסיף לילד סמלים ומשפטים מתאימים. אפשר לבחור נושא מוכן או ליצור נושא משלכם.
      </p>
      <div className="grid gap-4 md:grid-cols-4">
        {weeklyTopics.map((topic) => topicButton(topic, false))}
        {customTopics.map((topic) => topicButton(topic, true))}
        <button
          type="button"
          className="rounded-soft border-2 border-dashed border-blue-300 bg-blue-50/60 p-5 text-center font-black text-blue-800"
          onClick={() => setIsCreating(true)}
        >
          <span className="block text-4xl">➕</span>
          <span className="mt-2 block">נושא משלי</span>
        </button>
      </div>

      {isCreating && (
        <div className="mt-6 rounded-soft border border-blue-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">נושא חדש</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="grid gap-1">
              <span className="text-sm font-black">שם הנושא</span>
              <input
                className="rounded-2xl border border-slate-200 px-4 py-3"
                value={label}
                maxLength={30}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="למשל: חנוכה, חורף, בעלי חיים"
              />
            </label>
          </div>
          <span className="mt-4 block text-sm font-black">סמל לנושא</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {TOPIC_EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={cx(
                  "grid h-11 w-11 place-items-center rounded-xl border text-2xl",
                  emoji === choice ? "border-blue-500 ring-2 ring-blue-300" : "border-slate-200",
                )}
                onClick={() => setEmoji(choice)}
                aria-label={`סמל ${choice}`}
              >
                {choice}
              </button>
            ))}
          </div>

          <span className="mt-4 block text-sm font-black">
            הסמלים שיופיעו לילד בנושא ({pickedIds.length} נבחרו)
          </span>
          {pickedIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {pickedIds.map((symbolId) => (
                <button
                  key={`picked-${symbolId}`}
                  type="button"
                  className="rounded-full bg-blue-100 px-3 py-1 text-sm font-black text-blue-900"
                  onClick={() => togglePicked(symbolId)}
                  title="הסרה"
                >
                  {symbolById[symbolId]?.emoji} {symbolById[symbolId]?.label ?? symbolId} ×
                </button>
              ))}
            </div>
          )}
          <input
            className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-2"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="🔍 חיפוש סמל: כדור, שמח, אמא..."
            onKeyDown={(event) => {
              if (event.key === "Enter" && !queryExists) void addNewWord();
            }}
          />
          {query && !queryExists && (
            <button
              type="button"
              className="mt-2 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50 px-4 py-2 font-black text-blue-800 disabled:opacity-60"
              disabled={isAddingWord}
              onClick={() => void addNewWord()}
            >
              {isAddingWord ? "מחפש תמונה לסמל..." : `➕ להוסיף את "${query}" כסמל חדש בנושא`}
            </button>
          )}
          <div className="mt-3 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
            {searchResults.map((symbol) => {
              const isPicked = pickedIds.includes(symbol.id);
              return (
                <button
                  key={symbol.id}
                  type="button"
                  className={cx(
                    "flex flex-col items-center rounded-xl border p-2 text-center",
                    isPicked ? "border-blue-500 bg-blue-50 ring-2 ring-blue-300" : "border-slate-200 bg-white",
                  )}
                  onClick={() => togglePicked(symbol.id)}
                >
                  {symbol.pictogramId ? (
                    <img
                      src={arasaacImageUrl(symbol.pictogramId)}
                      alt={symbol.label}
                      className="h-10 w-10 object-contain"
                    />
                  ) : (
                    <span className="text-3xl leading-10">{symbol.emoji}</span>
                  )}
                  <span className="mt-1 w-full truncate text-xs font-bold">{symbol.label}</span>
                </button>
              );
            })}
          </div>

          {formError && (
            <p className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-800">{formError}</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-2xl bg-blue-600 px-5 py-3 font-black text-white"
              onClick={saveTopic}
            >
              שמירה ובחירה כנושא השבוע
            </button>
            <button
              type="button"
              className="rounded-2xl border border-slate-200 px-5 py-3 font-black"
              onClick={() => {
                setIsCreating(false);
                setNewWords([]);
                // The typed-in words are dropped, so they can't stay picked.
                setPickedIds((current) => current.filter((id) => allSymbols.some((symbol) => symbol.id === id)));
                setFormError("");
              }}
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
