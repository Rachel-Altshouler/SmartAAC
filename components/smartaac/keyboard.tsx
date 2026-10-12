"use client";

import { useState } from "react";
import { symbols } from "@/lib/demo-data";
import { MAX_TYPED_CHARS, sanitizeTypedText } from "@/components/smartaac/shared";

// The standard Israeli computer keyboard, left to right, so a child who knows
// the classroom keyboard finds every letter in the same place. Every row is
// 10 keys in one grid, so keys line up one above the other ("," sits next to
// the space bar).
const hebrewKeyboardRows = [
  ["/", "'", "ק", "ר", "א", "ט", "ו", "ן", "ם", "פ"],
  ["ש", "ד", "ג", "כ", "ע", "י", "ח", "ל", "ך", "ף"],
  ["ז", "ס", "ב", "ה", "נ", "מ", "צ", "ת", "ץ", "."],
] as const;

const keyboardPunctuation = new Set(["/", "'", ",", "."]);

const keyboardKeyClass =
  "min-h-12 min-w-0 rounded-xl border-2 border-slate-900 text-xl font-black text-slate-950 shadow-sm active:scale-95 sm:min-h-14 sm:text-2xl";

// Dictionary used for live word prediction while typing on the letter keyboard.
const keyboardWordDictionary = Array.from(new Set(symbols.map((symbol) => symbol.label)));

const getWordPredictions = (prefix: string, limit = 8): string[] => {
  if (!prefix) return [];
  return keyboardWordDictionary.filter((word) => word.startsWith(prefix)).slice(0, limit);
};

export function KeyboardView({
  onBack,
  onSpeak,
  onAddToSentence,
}: {
  onBack: () => void;
  onSpeak: (text: string) => void;
  onAddToSentence: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState("");

  const setSafeDraft = (value: string): void => {
    const next = value.slice(0, MAX_TYPED_CHARS);
    if (next.endsWith(" ") && !draft.endsWith(" ")) {
      const finishedWord = next.trim().split(" ").pop();
      if (finishedWord) onSpeak(finishedWord);
    }
    setDraft(next);
  };

  const appendLetter = (letter: string): void => {
    const next = (draft + letter).slice(0, MAX_TYPED_CHARS);
    if (letter === " " && !draft.endsWith(" ")) {
      const finishedWord = draft.trim().split(" ").pop();
      if (finishedWord) onSpeak(finishedWord);
    }
    setDraft(next);
  };

  const currentWordPrefix = draft.split(" ").pop() ?? "";
  const wordPredictions = getWordPredictions(currentWordPrefix);

  const applyWordPrediction = (word: string): void => {
    onSpeak(word);
    setDraft((current) => {
      const parts = current.split(" ");
      parts[parts.length - 1] = word;
      return `${parts.join(" ")} `.slice(0, MAX_TYPED_CHARS);
    });
  };

  const speakDraft = (): void => {
    const trimmed = sanitizeTypedText(draft);
    if (!trimmed) return;
    onSpeak(trimmed);
  };

  const addDraft = (): void => {
    if (onAddToSentence(draft)) {
      setDraft("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <div>
          <h2 className="text-2xl font-black sm:text-3xl">⌨️ מקלדת</h2>
          <p className="text-muted">הקלידו מילה או משפט, ואז הקראה או הוספה למשפט.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <input
          dir="rtl"
          lang="he"
          autoComplete="off"
          maxLength={MAX_TYPED_CHARS}
          className="mb-3 min-h-16 w-full rounded-2xl border-4 border-sky-200 bg-white px-4 text-2xl font-black shadow-inner"
          value={draft}
          onChange={(event) => setSafeDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder="הקלידו כאן..."
          aria-label="טקסט מוקלד"
        />

        {wordPredictions.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" dir="rtl">
            {wordPredictions.map((word) => (
              <button
                key={word}
                type="button"
                className="rounded-xl border-2 border-slate-900 bg-sky-100 px-3 py-2 text-sm font-black text-slate-950 shadow-sm active:scale-95"
                onClick={() => applyWordPrediction(word)}
              >
                {word}
              </button>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-2xl bg-blue-600 px-5 py-3 font-black text-white shadow-sm"
            onClick={speakDraft}
          >
            🔊 הקרא
          </button>
          <button
            type="button"
            className="rounded-2xl bg-emerald-500 px-5 py-3 font-black text-white shadow-sm"
            onClick={addDraft}
          >
            הוסף למשפט
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-slate-900 bg-white px-5 py-3 font-black shadow-sm"
            onClick={() => setDraft((current) => current.slice(0, -1))}
          >
            ⌫ מחק אות
          </button>
          <button
            type="button"
            className="rounded-2xl border-2 border-red-200 bg-red-50 px-5 py-3 font-black text-red-800 shadow-sm"
            onClick={() => setDraft("")}
          >
            נקה
          </button>
        </div>

        {/* Laid out left to right like a physical keyboard (the page itself is RTL). */}
        <div className="grid grid-cols-10 gap-1 rounded-2xl bg-slate-950 p-2" dir="ltr">
          {/* Numbers in a different color from the letters. */}
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
            <button
              key={digit}
              type="button"
              className={`${keyboardKeyClass} bg-amber-100`}
              onClick={() => appendLetter(digit)}
            >
              {digit}
            </button>
          ))}
          {hebrewKeyboardRows.flat().map((letter) => (
            <button
              key={letter}
              type="button"
              className={`${keyboardKeyClass} ${keyboardPunctuation.has(letter) ? "bg-slate-200" : "bg-sky-100"}`}
              onClick={() => appendLetter(letter)}
            >
              {letter}
            </button>
          ))}
          <button
            type="button"
            className={`${keyboardKeyClass} bg-slate-200`}
            onClick={() => appendLetter(",")}
          >
            ,
          </button>
          <button
            type="button"
            className="col-span-6 min-h-12 rounded-xl border-2 border-slate-900 bg-white text-lg font-black shadow-sm active:scale-95 sm:min-h-14"
            onClick={() => appendLetter(" ")}
          >
            רווח
          </button>
          <button
            type="button"
            className="col-span-3 min-h-12 rounded-xl border-2 border-slate-900 bg-amber-200 text-lg font-black shadow-sm active:scale-95 sm:min-h-14"
            onClick={() => setDraft((current) => current.slice(0, -1))}
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
