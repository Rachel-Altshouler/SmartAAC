"use client";

import { type DemoState } from "@/lib/demo-data";
import { cx, speakHebrew } from "@/components/smartaac/shared";

// The child's own settings, shown under the weekly topic on the same page.
export function ChildSettingsDashboard({
  state,
  update,
}: {
  state: DemoState;
  update: (updater: (current: DemoState) => DemoState) => void;
}) {
  return (
    <section>
      <h1 className="text-3xl font-black">הגדרות</h1>
      <p className="mb-6 text-muted">איך המערכת פונה ל{state.activeChildName || "ילד/ה"} ומקריאה לו/ה.</p>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-soft border border-violet-200 bg-white p-4 shadow-sm">
        <span className="font-black">{state.activeChildName || "הילד/ה"} הוא/היא:</span>
        {(
          [
            ["boy", "👦 בן"],
            ["girl", "👧 בת"],
          ] as const
        ).map(([gender, label]) => (
          <button
            key={gender}
            type="button"
            className={cx(
              "rounded-2xl border px-4 py-2 font-black",
              (state.childGender ?? "boy") === gender
                ? "border-violet-600 bg-violet-600 text-white"
                : "border-violet-200 bg-white text-violet-950",
            )}
            onClick={() => update((current) => ({ ...current, childGender: gender }))}
          >
            {label}
          </button>
        ))}
        <span className="text-sm text-muted">
          המערכת תפנה לילד/ה ותקריא את המילים בלשון המתאימה.
        </span>
        <label className="mr-auto flex items-center gap-2 font-black">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={state.smartGrammar !== false}
            onChange={(event) =>
              update((current) => ({ ...current, smartGrammar: event.target.checked }))
            }
          />
          ✨ תיקון משפטים חכם (AI)
        </label>
      </div>

      <div className="rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">קצב דיבור</h2>
        <p className="mb-3 text-muted">
          כמה לאט או מהר המערכת מקריאה לילד/ה. לילדים שזקוקים לזמן עיבוד שמיעתי ארוך יותר — כדאי להאט.
        </p>
        <div className="flex items-center gap-4">
          <span className="text-sm font-black text-muted">איטי</span>
          <input
            type="range"
            min={0.5}
            max={1.3}
            step={0.05}
            value={state.speechRate}
            onChange={(event) =>
              update((current) => ({ ...current, speechRate: Number(event.target.value) }))
            }
            className="w-full"
            aria-label="קצב דיבור"
          />
          <span className="text-sm font-black text-muted">מהיר</span>
        </div>
        <button
          type="button"
          className="mt-3 rounded-2xl bg-blue-600 px-5 py-3 font-black text-white shadow-sm"
          onClick={() => speakHebrew("שלום, ככה אני נשמע עכשיו", state.speechRate)}
        >
          🔊 נסה
        </button>
      </div>
    </section>
  );
}
