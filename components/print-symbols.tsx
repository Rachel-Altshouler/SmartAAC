"use client";

import { useMemo, useState } from "react";
import { arasaacImageUrl, type AacSymbol, type SymbolCategory } from "@/lib/demo-data";

// "הדפסת סמלים": the parent / teacher picks a category and prints its symbols
// as cards for table games (memory, matching, bingo…).

const cx = (...classes: Array<string | false | undefined>): string => classes.filter(Boolean).join(" ");

const SIZES = [
  { id: "small", label: "קטנים", perRow: 5 },
  { id: "medium", label: "בינוניים", perRow: 4 },
  { id: "large", label: "גדולים", perRow: 3 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

const imageFor = (symbol: AacSymbol, symbolImages: Record<string, string>): string | undefined =>
  symbol.imageUrl ?? symbolImages[symbol.id] ?? (symbol.pictogramId ? arasaacImageUrl(symbol.pictogramId) : undefined);

export function PrintSymbolsDashboard({
  allSymbols,
  allCategories,
  symbolImages,
  hiddenSymbolIds,
}: {
  allSymbols: AacSymbol[];
  allCategories: SymbolCategory[];
  symbolImages: Record<string, string>;
  hiddenSymbolIds: string[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [size, setSize] = useState<SizeId>("medium");
  const [copies, setCopies] = useState<1 | 2>(1);
  const [showLabels, setShowLabels] = useState(true);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const categoriesWithSymbols = allCategories.filter((category) =>
    allSymbols.some((symbol) => symbol.categoryId === category.id),
  );
  const categorySymbols = useMemo(
    () =>
      allSymbols.filter((symbol) => symbol.categoryId === categoryId && !hiddenSymbolIds.includes(symbol.id)),
    [allSymbols, categoryId, hiddenSymbolIds],
  );
  const chosen = categorySymbols.filter((symbol) => !skipped.includes(symbol.id));
  const category = allCategories.find((item) => item.id === categoryId);
  const perRow = SIZES.find((item) => item.id === size)?.perRow ?? 4;

  const print = (): void => {
    if (chosen.length === 0) return;
    const cards = chosen
      .flatMap((symbol) => Array.from({ length: copies }, () => symbol))
      .map((symbol) => {
        const image = imageFor(symbol, symbolImages);
        const picture = image
          ? `<img src="${escapeHtml(image)}" alt="" />`
          : `<span class="emoji">${escapeHtml(symbol.emoji)}</span>`;
        const label = showLabels ? `<div class="label">${escapeHtml(symbol.label)}</div>` : "";
        return `<div class="card">${picture}${label}</div>`;
      })
      .join("");
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8" />
<title>${escapeHtml(category?.label ?? "סמלים")}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Rubik, Assistant, Arial, sans-serif; color: #0f172a; }
  h1 { font-size: 18pt; margin: 0 0 6mm; }
  .grid { display: grid; grid-template-columns: repeat(${perRow}, 1fr); gap: 4mm; }
  .card { border: 1.5px dashed #94a3b8; border-radius: 4mm; padding: 3mm; text-align: center;
    break-inside: avoid; page-break-inside: avoid; aspect-ratio: 1 / 1.1; display: flex;
    flex-direction: column; align-items: center; justify-content: center; }
  .card img { width: 100%; height: 75%; object-fit: contain; }
  .emoji { font-size: ${perRow >= 5 ? 34 : perRow === 4 ? 44 : 60}pt; line-height: 1.1; }
  .label { margin-top: 2mm; font-weight: 800; font-size: ${perRow >= 5 ? 11 : perRow === 4 ? 13 : 16}pt; }
</style></head><body>
<h1>${escapeHtml(`${category?.emoji ?? ""} ${category?.label ?? ""}`.trim())}</h1>
<div class="grid">${cards}</div>
<script>
  Promise.all(Array.from(document.images).map(function (img) {
    return img.complete ? Promise.resolve() : new Promise(function (done) { img.onload = img.onerror = done; });
  })).then(function () { setTimeout(function () { window.print(); }, 200); });
</script>
</body></html>`;
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("הדפדפן חסם את חלון ההדפסה. אפשרו חלונות קופצים לאתר ונסו שוב.");
      return;
    }
    setMessage("");
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  };

  return (
    <section className="font-rubik">
      <h1 className="text-3xl font-black">🖨️ הדפסת סמלים</h1>
      <p className="mb-6 text-muted">
        בוחרים קטגוריה ומדפיסים כרטיסי סמלים למשחקים: זיכרון, התאמה, בינגו ועוד. אפשר לגזור לאורך הקו המקווקו.
      </p>

      <div className="mb-6 rounded-[1.75rem] border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">1. בחירת קטגוריה</h2>
        <div className="flex flex-wrap gap-2">
          {categoriesWithSymbols.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx(
                "rounded-full border px-4 py-2 font-bold",
                categoryId === item.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700",
              )}
              onClick={() => {
                setCategoryId(item.id);
                setSkipped([]);
              }}
            >
              {item.emoji} {item.label}
            </button>
          ))}
        </div>

        <h2 className="mb-3 mt-6 text-lg font-bold">2. איך להדפיס</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {SIZES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-bold text-slate-600",
                  size === item.id && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => setSize(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(
              [
                [1, "עותק אחד מכל סמל"],
                [2, "זוגות (למשחק זיכרון)"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-bold text-slate-600",
                  copies === value && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => setCopies(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />
            להדפיס את המילה מתחת לתמונה
          </label>
        </div>
      </div>

      {category && (
        <div className="rounded-[1.75rem] border border-slate-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">
              3. {category.emoji} {category.label} · {chosen.length * copies} כרטיסים
            </h2>
            <button
              type="button"
              disabled={chosen.length === 0}
              className="rounded-2xl bg-blue-600 px-6 py-3 font-black text-white disabled:opacity-50"
              onClick={print}
            >
              🖨️ הדפסה
            </button>
          </div>
          <p className="mb-3 text-sm text-muted">לחיצה על סמל מוציאה אותו מההדפסה (ולחיצה נוספת מחזירה).</p>
          {message && <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{message}</p>}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {categorySymbols.map((symbol) => {
              const image = imageFor(symbol, symbolImages);
              const isSkipped = skipped.includes(symbol.id);
              return (
                <button
                  key={symbol.id}
                  type="button"
                  className={cx(
                    "flex flex-col items-center rounded-2xl border-2 border-dashed p-3 transition",
                    isSkipped ? "border-slate-200 opacity-30" : "border-slate-300 bg-white",
                  )}
                  onClick={() =>
                    setSkipped((current) =>
                      isSkipped ? current.filter((id) => id !== symbol.id) : [...current, symbol.id],
                    )
                  }
                >
                  {image ? (
                    <img src={image} alt="" className="h-16 w-16 object-contain" />
                  ) : (
                    <span className="text-5xl leading-[4rem]">{symbol.emoji}</span>
                  )}
                  {showLabels && <span className="mt-1 text-sm font-bold">{symbol.label}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
