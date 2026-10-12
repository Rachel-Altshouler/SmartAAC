"use client";

import { type ReactNode } from "react";
import { type AacSymbol, type DemoState, type StoryResult, arasaacImageUrl } from "@/lib/demo-data";
import { today, cx, CategoryIcon } from "@/components/smartaac/shared";

// Colorful number card (progress page).
function StatCard({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: string;
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div className={cx("rounded-2xl bg-gradient-to-br px-4 py-3 shadow-sm ring-1 ring-black/5", tone)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold opacity-80">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-base">{icon}</span>
      </div>
      <div className="mt-1 text-2xl font-extrabold">{value}</div>
      {hint && <div className="mt-1 text-xs font-medium opacity-70">{hint}</div>}
    </div>
  );
}

// A section card with an icon heading (progress page).
function SectionCard({ icon, title, tint, children }: { icon: string; title: string; tint: string; children: ReactNode }) {
  return (
    <div className="rounded-[1.75rem] border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <span className={cx("grid h-9 w-9 place-items-center rounded-full text-lg", tint)}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-black text-muted">{label}</div>
      <div className="mt-2 text-3xl font-black">{value}</div>
    </div>
  );
}

export function ProgressDashboard({
  state,
  activeSymbolCount,
  activeTopic,
  averageLength,
  allSymbolById,
  allCategories,
}: {
  state: DemoState;
  activeSymbolCount: number;
  activeTopic: { id: string; label: string; emoji: string } | undefined;
  averageLength: string;
  allSymbolById: Record<string, AacSymbol>;
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
}) {
  const symbolUses = Object.values(state.usageBySymbolId).reduce((total, value) => total + value, 0);
  const topCategories = Object.entries(state.categoryUsageById)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);
  const topSymbols = Object.entries(state.usageBySymbolId)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
  const activeTopicUsage = activeTopic?.id
    ? (state.topicUsageById[activeTopic.id] ?? 0)
    : 0;
  const trend =
    state.sentenceCount >= 5
      ? "עלייה יפה בשימוש"
      : state.sentenceCount > 0
        ? "מתחילים לצבור שימוש"
        : "עדיין אין נתוני שימוש";

  const maxCategory = Math.max(1, ...topCategories.map(([, count]) => count));
  const maxSymbol = Math.max(1, ...topSymbols.map(([, count]) => count));

  return (
    <section className="font-rubik">
      <div className="relative mb-6 overflow-hidden rounded-[2rem] bg-gradient-to-l from-emerald-500 via-teal-500 to-sky-500 p-6 text-white shadow-soft">
        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
        <div className="relative">
          <p className="text-sm font-medium text-emerald-50">מעקב התקדמות</p>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight">📈 {trend}</h1>
          <p className="mt-2 text-sm text-emerald-50">המגמה מבוססת על מספר המשפטים והשימוש בסמלים.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard icon="💬" label="משפטים שנבנו" value={String(state.sentenceCount)} tone="from-sky-50 to-sky-100 text-sky-900" />
        <StatCard
          icon="📏"
          label="אורך משפט ממוצע"
          value={averageLength}
          hint="מילים במשפט"
          tone="from-indigo-50 to-indigo-100 text-indigo-900"
        />
        <StatCard icon="👆" label="שימושים בסמלים" value={String(symbolUses)} tone="from-violet-50 to-violet-100 text-violet-900" />
        <StatCard
          icon={activeTopic?.emoji ?? "📚"}
          label="סמלים מנושא השבוע שנלחצו"
          value={String(activeTopicUsage)}
          hint={activeTopic ? `נושא: ${activeTopic.label}` : undefined}
          tone="from-amber-50 to-amber-100 text-amber-900"
        />
        <StatCard icon="🔣" label="סמלים פעילים" value={String(activeSymbolCount)} tone="from-emerald-50 to-emerald-100 text-emerald-900" />
        <StatCard
          icon="📖"
          label="סיפורים שהושלמו"
          value={String((state.storyResults ?? []).filter((item) => !item.partial).length)}
          tone="from-rose-50 to-rose-100 text-rose-900"
        />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <SectionCard icon="🗂️" title="קטגוריות הכי בשימוש" tint="bg-sky-100">
          {topCategories.length === 0 ? (
            <p className="text-muted">עדיין אין מספיק נתונים. נסו לבנות כמה משפטים במסך הילד.</p>
          ) : (
            <div className="space-y-3">
              {topCategories.map(([categoryId, count]) => {
                const category = allCategories.find((item) => item.id === categoryId);
                return (
                  <div key={categoryId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-bold">
                        <CategoryIcon category={category} size="h-5 w-5" /> {category?.label ?? categoryId}
                      </span>
                      <span className="font-bold text-slate-500">{count}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-l from-sky-400 to-indigo-400"
                        style={{ width: `${Math.round((count / maxCategory) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard icon="⭐" title="סמלים נפוצים" tint="bg-amber-100">
          {topSymbols.length === 0 ? (
            <p className="text-muted">הסמלים הנפוצים יופיעו כאן אחרי שימוש.</p>
          ) : (
            <div className="space-y-3">
              {topSymbols.map(([symbolId, count]) => {
                const symbol = allSymbolById[symbolId];
                return (
                  <div key={symbolId} className="flex items-center gap-3">
                    {symbol?.pictogramId ? (
                      <img
                        src={arasaacImageUrl(symbol.pictogramId)}
                        alt={symbol.label}
                        className="h-10 w-10 shrink-0 rounded-xl bg-slate-50 object-contain p-1"
                      />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-2xl">
                        {symbol?.emoji}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-bold">{symbol?.label ?? symbolId}</span>
                        <span className="font-bold text-slate-500">{count}</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-amber-400 to-rose-400"
                          style={{ width: `${Math.round((count / maxSymbol) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <StoryProgress results={state.storyResults ?? []} />
    </section>
  );
}

// "📖 משחק הסיפור" on the progress page: per day the child played — how many
// stories, how many words they matched to the sentence on the first try out
// of all the words, and the success rate.
function StoryProgress({ results }: { results: StoryResult[] }) {
  const summarize = (items: StoryResult[]) => {
    const words = items.reduce((total, item) => total + item.steps, 0);
    const matched = items.reduce((total, item) => total + item.firstTry, 0);
    return {
      stories: items.length,
      finished: items.filter((item) => !item.partial).length,
      words,
      matched,
      percent: words ? Math.round((matched / words) * 100) : 0,
    };
  };

  const byDay = Object.entries(
    results.reduce<Record<string, StoryResult[]>>((days, item) => {
      days[item.date] = [...(days[item.date] ?? []), item];
      return days;
    }, {}),
  )
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, items]) => ({ date, ...summarize(items) }));

  const todayRow = byDay.find((row) => row.date === today());
  const formatDate = (date: string): string => date.split("-").reverse().join("/");

  return (
    <div className="mt-5 rounded-[1.75rem] border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-100 text-lg">📖</span>
        משחק הסיפור — התאמת מילה למשפט
      </h2>
      {results.length === 0 ? (
        <p className="mt-2 text-muted">עוד לא שוחק סיפור. התוצאות יופיעו כאן אחרי הסיפור הראשון.</p>
      ) : (
        <>
          <h3 className="mt-4 mb-2 font-black">היום</h3>
          {todayRow ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Metric label="סיפורים היום" value={String(todayRow.stories)} />
              <Metric label="מילים שהותאמו היום" value={`${todayRow.matched} מתוך ${todayRow.words}`} />
              <Metric label="הצלחה היום" value={`${todayRow.percent}%`} />
            </div>
          ) : (
            <p className="rounded-2xl bg-slate-50 p-3 text-muted">היום עוד לא שוחק סיפור.</p>
          )}

          <h3 className="mt-5 mb-2 font-black">לפי ימים</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="text-sm text-muted">
                  <th className="p-2 font-black">תאריך</th>
                  <th className="p-2 font-black">סיפורים</th>
                  <th className="p-2 font-black">מילים שהותאמו</th>
                  <th className="p-2 font-black">הצלחה</th>
                </tr>
              </thead>
              <tbody>
                {byDay.slice(0, 14).map((row) => (
                  <tr key={row.date} className="border-t border-slate-100">
                    <td className="p-2 font-black">{formatDate(row.date)}</td>
                    <td className="p-2">
                      {row.stories}
                      {row.finished < row.stories && (
                        <span className="text-sm text-muted"> ({row.stories - row.finished} לא הושלמו)</span>
                      )}
                    </td>
                    <td className="p-2">
                      {row.matched} מתוך {row.words}
                    </td>
                    <td className="p-2">
                      <span
                        className={cx(
                          "rounded-full px-3 py-1 text-sm font-black",
                          row.percent >= 80
                            ? "bg-emerald-100 text-emerald-800"
                            : row.percent >= 50
                              ? "bg-amber-100 text-amber-900"
                              : "bg-rose-100 text-rose-800",
                        )}
                      >
                        {row.percent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}
    </div>
  );
}
