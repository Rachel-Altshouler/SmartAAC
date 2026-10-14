"use client";

import {
  type AacSymbol,
  type FunctionalityLevel,
  arasaacImageUrl,
  keshetCategoryOrder,
  keshetCoreSymbolIds,
  keshetPreviewCount,
  quickPhrases,
  symbols,
} from "@/lib/demo-data";
import {
  cx,
  resolveSymbolImage,
  CHILD_PHOTO_KEY,
  SymbolTile,
  CategoryIcon,
  customCategoryColors,
} from "@/components/smartaac/shared";

const keshetLabelStyles: Record<string, string> = {
  core: "bg-amber-300 text-amber-950",
  people: "bg-yellow-300 text-yellow-950",
  feelings: "bg-pink-300 text-pink-950",
  actions: "bg-emerald-400 text-emerald-950",
  food: "bg-orange-300 text-orange-950",
  school: "bg-sky-400 text-sky-950",
  games: "bg-violet-400 text-violet-950",
  colors: "bg-slate-200 text-slate-950",
};

function getKeshetRowSymbols(
  categoryId: string,
  allSymbols: AacSymbol[],
  favoriteSymbolIds: string[],
  limit: number,
): AacSymbol[] {
  const categorySymbols = allSymbols.filter((symbol) => symbol.categoryId === categoryId);

  // Favorites get priority to be included within the limit, but the returned
  // order always follows `categorySymbols` so a symbol's on-screen position
  // stays fixed regardless of which symbols happen to be favorited right now.
  const favorites = categorySymbols.filter((symbol) => favoriteSymbolIds.includes(symbol.id));
  const rest = categorySymbols.filter((symbol) => !favoriteSymbolIds.includes(symbol.id));
  const includedIds = new Set(
    [...favorites, ...rest].slice(0, limit).map((symbol) => symbol.id),
  );

  return categorySymbols.filter((symbol) => includedIds.has(symbol.id));
}

function KeshetRow({
  label,
  emoji,
  pictogramId,
  labelClassName,
  symbols,
  symbolImages,
  isPeople = false,
  childName,
  showNameCell = false,
  slotCount = 0,
  onSymbolClick,
  onMore,
}: {
  label: string;
  emoji: string;
  pictogramId?: number;
  labelClassName: string;
  symbols: AacSymbol[];
  symbolImages: Record<string, string>;
  isPeople?: boolean;
  childName?: string;
  showNameCell?: boolean;
  // Rows with fewer symbols (e.g. a new custom category) keep the same button
  // size as full rows: empty slots fill the rest instead of stretching tiles.
  slotCount?: number;
  onSymbolClick: (symbolId: string) => void;
  onMore?: () => void;
}) {
  return (
    <div className="flex min-h-[5.25rem] shrink-0 flex-row-reverse gap-1.5 sm:min-h-[6rem]">
      <div
        className={cx(
          "flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-slate-900 text-center font-black shadow-sm sm:w-[4.5rem]",
          labelClassName,
        )}
      >
        {pictogramId ? (
          <img src={arasaacImageUrl(pictogramId)} alt="" className="h-7 w-7 object-contain sm:h-8 sm:w-8" />
        ) : (
          <span className="text-xl leading-none sm:text-2xl">{emoji}</span>
        )}
        <span className="mt-1 text-xs leading-tight sm:text-sm">{label}</span>
      </div>
      {/* Phones: a 3-column grid, so tiles stay big enough to read and tap.
          Wider screens: the whole row on one line, as on a tablet board. */}
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 sm:flex">
        {showNameCell && childName ? (
          <div className="flex min-w-0 shrink-0 flex-col items-center justify-center rounded-xl border-[3px] border-slate-900 bg-violet-200 px-2 py-1 text-center font-black shadow-sm sm:min-w-[6rem]">
            {symbolImages[CHILD_PHOTO_KEY] ? (
              <img
                src={symbolImages[CHILD_PHOTO_KEY]}
                alt=""
                className="mb-0.5 h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm sm:h-12 sm:w-12"
              />
            ) : (
              <span className="text-xs leading-tight text-violet-800 sm:text-sm">שם</span>
            )}
            <span className="text-sm leading-tight sm:text-base">{childName}</span>
          </div>
        ) : null}
        {symbols.map((symbol) => (
          <SymbolTile
            key={symbol.id}
            symbol={symbol}
            imageUrl={resolveSymbolImage(symbol, symbolImages)}
            className="min-w-0 flex-1"
            variant={isPeople ? "keshet-people" : "keshet"}
            onClick={() => onSymbolClick(symbol.id)}
          />
        ))}
        {Array.from({ length: Math.max(0, slotCount - symbols.length) }, (_, index) => (
          <div
            key={`empty-slot-${index}`}
            // Same border + padding as a tile, so flex gives every slot the exact same width.
            className="hidden min-w-0 flex-1 border-[3px] border-transparent p-1 sm:block sm:p-1.5"
            aria-hidden
          />
        ))}
        {onMore ? (
          <button
            type="button"
            className="flex min-w-14 shrink-0 flex-col items-center justify-center rounded-xl border-[3px] border-slate-900 bg-white px-1 font-black shadow-sm transition active:scale-95 sm:min-w-16"
            onClick={onMore}
            aria-label={`עוד ${label}`}
          >
            <span className="text-xl leading-none sm:text-2xl">←</span>
            <span className="mt-1 text-xs leading-tight sm:text-sm">עוד</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function KeshetHomeView({
  childName,
  level,
  coreSymbolIds,
  enabledCategoryIds,
  allCategories,
  allSymbols,
  favoriteSymbolIds,
  symbolImages,
  onSymbolClick,
  onCategoryClick,
}: {
  childName: string;
  level: FunctionalityLevel;
  coreSymbolIds: string[];
  enabledCategoryIds: string[];
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
  allSymbols: AacSymbol[];
  favoriteSymbolIds: string[];
  symbolImages: Record<string, string>;
  onSymbolClick: (symbolId: string) => void;
  onCategoryClick: (categoryId: string) => void;
}) {
  const previewLimit = keshetPreviewCount[level];
  const keshetOrderSet = new Set<string>(keshetCategoryOrder);
  const coreSet = new Set(coreSymbolIds);
  const symbolById = Object.fromEntries(allSymbols.map((symbol) => [symbol.id, symbol])) as Record<
    string,
    AacSymbol
  >;

  const coreSymbols = keshetCoreSymbolIds
    .filter((symbolId) => coreSet.has(symbolId))
    .map((symbolId) => symbolById[symbolId])
    .filter((symbol): symbol is AacSymbol => Boolean(symbol));

  const orderedCategoryIds = [
    ...keshetCategoryOrder.filter((categoryId) => enabledCategoryIds.includes(categoryId)),
    ...allCategories
      .map((category) => category.id)
      .filter(
        (categoryId) =>
          enabledCategoryIds.includes(categoryId) && !keshetOrderSet.has(categoryId),
      ),
  ];

  return (
    <div className="flex flex-col gap-2 pb-2">
      <KeshetRow
        label="ליבה"
        emoji="⭐"
        labelClassName={keshetLabelStyles.core}
        symbols={coreSymbols}
        symbolImages={symbolImages}
        showNameCell
        childName={childName}
        onSymbolClick={onSymbolClick}
      />
      {orderedCategoryIds.map((categoryId) => {
        const category = allCategories.find((item) => item.id === categoryId);
        if (!category) return null;

        const rowSymbols = getKeshetRowSymbols(
          categoryId,
          allSymbols,
          favoriteSymbolIds,
          previewLimit,
        );

        return (
          <KeshetRow
            key={categoryId}
            label={category.label}
            emoji={category.emoji}
            pictogramId={category.pictogramId}
            labelClassName={keshetLabelStyles[categoryId] ?? customCategoryLabelColor(categoryId)}
            symbols={rowSymbols}
            symbolImages={symbolImages}
            isPeople={categoryId === "people"}
            slotCount={previewLimit}
            onSymbolClick={onSymbolClick}
            onMore={() => onCategoryClick(categoryId)}
          />
        );
      })}
    </div>
  );
}

function HomeView({
  level,
  enabledCategoryIds,
  allCategories,
  usefulSymbols,
  symbolImages,
  onPhraseClick,
  onSymbolClick,
  onCategoryClick,
}: {
  level: FunctionalityLevel;
  enabledCategoryIds: string[];
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
  usefulSymbols: AacSymbol[];
  symbolImages: Record<string, string>;
  onPhraseClick: (phrase: (typeof quickPhrases)[number]) => void;
  onSymbolClick: (symbolId: string) => void;
  onCategoryClick: (categoryId: string) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-[2rem] border border-blue-100 bg-white p-4 shadow-soft">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {usefulSymbols.map((symbol) => (
            <SymbolTile
              key={symbol.id}
              symbol={symbol}
              imageUrl={resolveSymbolImage(symbol, symbolImages)}
              className="min-h-20"
              onClick={() => onSymbolClick(symbol.id)}
              variant="home"
            />
          ))}
        </div>
      </section>

      {level !== "high" ? (
        <section className="rounded-[2rem] border border-orange-100 bg-white p-4 shadow-soft">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {quickPhrases.slice(0, level === "low" ? 8 : 12).map((phrase) => (
              <button
                key={phrase.text}
                type="button"
                className="flex min-h-20 items-center gap-2 rounded-[1.25rem] border-2 border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-100 p-3 text-right shadow-sm transition hover:-translate-y-0.5 active:scale-95"
                onClick={() => onPhraseClick(phrase)}
              >
                <span className="text-2xl">{phrase.emoji}</span>
                <span className="text-base font-black leading-5 text-slate-900">
                  {phrase.text}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-[2rem] border border-orange-100 bg-white p-4 shadow-soft">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {quickPhrases.map((phrase) => (
              <button
                key={phrase.text}
                type="button"
                className="flex min-h-20 items-center gap-2 rounded-[1.25rem] border-2 border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-100 p-3 text-right shadow-sm transition hover:-translate-y-0.5 active:scale-95"
                onClick={() => onPhraseClick(phrase)}
              >
                <span className="text-2xl">{phrase.emoji}</span>
                <span className="text-base font-black leading-5 text-slate-900">
                  {phrase.text}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-[2rem] border border-emerald-100 bg-white p-4 shadow-soft">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {allCategories
            .filter((category) => enabledCategoryIds.includes(category.id))
            .map((category) => (
              <CategoryTile
                key={category.id}
                category={category}
                onClick={() => onCategoryClick(category.id)}
              />
            ))}
        </div>
      </section>
    </div>
  );
}

export function CategoryView({
  categoryId,
  allCategories,
  symbols: categorySymbols,
  symbolImages,
  tileSize,
  onBack,
  onSymbolClick,
}: {
  categoryId: string;
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
  symbols: AacSymbol[];
  symbolImages: Record<string, string>;
  tileSize: string;
  onBack: () => void;
  onSymbolClick: (symbolId: string) => void;
}) {
  const category = allCategories.find((item) => item.id === categoryId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-xl border-2 border-slate-900 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <h2 className="text-2xl font-black text-slate-950">
          <CategoryIcon category={category} size="h-9 w-9" /> {category?.label}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-slate-950 p-2">
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9">
          {categorySymbols.map((symbol) => (
            <SymbolTile
              key={symbol.id}
              symbol={symbol}
              imageUrl={resolveSymbolImage(symbol, symbolImages)}
              className={tileSize}
              variant="board"
              onClick={() => onSymbolClick(symbol.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryTile({
  category,
  onClick,
}: {
  category: { id: string; label: string; emoji: string; pictogramId?: number };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(
        "min-h-24 rounded-[1.25rem] border-2 border-white p-3 text-center shadow-soft ring-1 ring-slate-900/5 transition hover:-translate-y-0.5 active:scale-95",
        categoryIdBackground(category.id),
      )}
      onClick={onClick}
    >
      {category.pictogramId ? (
        <img src={arasaacImageUrl(category.pictogramId)} alt="" className="mx-auto h-9 w-9 object-contain" />
      ) : (
        <span className="block text-3xl">{category.emoji}</span>
      )}
      <span className="mt-1 block text-base font-black text-slate-950">{category.label}</span>
    </button>
  );
}

function categoryIdBackground(categoryId: string): string {
  const backgrounds: Record<string, string> = {
    core: "bg-gradient-to-br from-amber-50 to-amber-200",
    feelings: "bg-gradient-to-br from-pink-50 to-pink-200",
    food: "bg-gradient-to-br from-lime-50 to-lime-200",
    people: "bg-gradient-to-br from-yellow-50 to-yellow-200",
    actions: "bg-gradient-to-br from-emerald-50 to-emerald-200",
    school: "bg-gradient-to-br from-cyan-50 to-cyan-200",
    games: "bg-gradient-to-br from-violet-50 to-violet-200",
  };

  return backgrounds[categoryId] ?? "bg-gradient-to-br from-white to-slate-100";
}

const customCategoryLabelColor = (categoryId: string): string =>
  customCategoryColors(categoryId).label;
