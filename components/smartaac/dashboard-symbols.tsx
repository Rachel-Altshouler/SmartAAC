"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AacSymbol,
  type DemoState,
  arasaacImageUrl,
  allEmojiChoices,
  symbols,
} from "@/lib/demo-data";
import {
  cx,
  resolveSymbolImage,
  MAX_FAMILY_PHOTO_BYTES,
  prepareFamilyPhoto,
  searchPictograms,
  CategoryIcon,
} from "@/components/smartaac/shared";

const firstGrapheme = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
    const first = [...segmenter.segment(trimmed)][0];
    return first?.segment ?? trimmed;
  }

  return Array.from(trimmed)[0] ?? trimmed;
};

// "🖼️ סמלים": pick a real pictogram by searching a word.
function PictogramSearch({
  suggestion,
  value,
  onChange,
}: {
  suggestion: string;
  value?: number;
  onChange: (pictogramId: number | undefined) => void;
}) {
  const [query, setQuery] = useState(suggestion);
  const [results, setResults] = useState<number[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const touched = useRef(false);

  // Follows the name typed above until the user types a search of their own.
  useEffect(() => {
    if (!touched.current) setQuery(suggestion);
  }, [suggestion]);

  useEffect(() => {
    const word = query.trim();
    if (!word) {
      setResults([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      void searchPictograms(word)
        .then((ids) => {
          if (cancelled) return;
          setResults(ids);
          setStatus(ids.length ? "idle" : "empty");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div>
      <input
        className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        value={query}
        onChange={(event) => {
          touched.current = true;
          setQuery(event.target.value);
        }}
        placeholder="חיפוש סמל, למשל: מכונת כביסה"
      />
      <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {results.map((id) => (
            <button
              key={id}
              type="button"
              className={cx(
                "rounded-lg border bg-white p-1 transition",
                value === id ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:bg-slate-100",
              )}
              onClick={() => onChange(value === id ? undefined : id)}
              aria-label="בחר סמל"
            >
              <img src={arasaacImageUrl(id)} alt="" className="h-14 w-full object-contain" loading="lazy" />
            </button>
          ))}
        </div>
        {status === "loading" && <p className="p-3 text-center text-sm text-muted">מחפשים סמלים…</p>}
        {status === "empty" && <p className="p-3 text-center text-sm text-muted">לא נמצאו סמלים. נסו מילה אחרת.</p>}
        {status === "error" && <p className="p-3 text-center text-sm text-muted">החיפוש לא הצליח. נסו שוב.</p>}
        {status === "idle" && results.length === 0 && (
          <p className="p-3 text-center text-sm text-muted">כתבו מילה כדי לחפש סמל.</p>
        )}
      </div>
    </div>
  );
}

function EmojiPickerField({
  label,
  value,
  onChange,
  pictogramId,
  onPictogramChange,
  suggestion = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // With these, a "🖼️ סמלים" tab lets the user pick a real pictogram instead.
  pictogramId?: number;
  onPictogramChange?: (pictogramId: number | undefined) => void;
  suggestion?: string;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pictograms" | "emoji">(onPictogramChange ? "pictograms" : "emoji");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredChoices = useMemo(() => {
    const query = search.trim();
    if (!query) return allEmojiChoices;
    return allEmojiChoices.filter((emoji) => emoji.includes(query));
  }, [search]);

  const openSystemPicker = (): void => {
    inputRef.current?.focus();
    const input = inputRef.current;
    if (input && "showPicker" in input) {
      // showPicker() returns void in current DOM typings and throws (rather
      // than rejecting) when the picker can't open.
      try {
        input.showPicker();
      } catch {
        // focusing the input above is enough
      }
    }
  };

  return (
    <div>
      <label className="mb-2 block text-sm font-black text-slate-700">{label}</label>
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="mb-3 flex min-h-14 items-center justify-center rounded-xl bg-slate-50 text-4xl">
          {pictogramId ? (
            <img src={arasaacImageUrl(pictogramId)} alt="" className="h-14 w-14 object-contain" />
          ) : (
            value || "⭐"
          )}
        </div>
        {onPictogramChange && (
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["pictograms", "🖼️ סמלים"],
                ["emoji", "😀 אימוג׳י"],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-black text-slate-600",
                  tab === id && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => setTab(id)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {tab === "pictograms" && onPictogramChange ? (
          <PictogramSearch suggestion={suggestion} value={pictogramId} onChange={onPictogramChange} />
        ) : (
        <>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-center text-sm"
            value={value}
            onChange={(event) => {
              onChange(firstGrapheme(event.target.value));
              onPictogramChange?.(undefined);
            }}
            placeholder="הדביק/י אימוג׳י או הקליד/י"
            aria-label={label}
          />
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black"
            onClick={openSystemPicker}
          >
            בורר מערכת
          </button>
        </div>
        <input
          className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש באימוג׳ים..."
        />
        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-2">
          <div className="flex flex-wrap gap-1.5">
            {filteredChoices.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={cx(
                  "rounded-lg border px-2 py-1.5 text-xl transition",
                  value === emoji
                    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                    : "border-slate-200 bg-white hover:bg-slate-100",
                )}
                onClick={() => {
                  onChange(emoji);
                  onPictogramChange?.(undefined);
                }}
                aria-label={`בחר ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {filteredChoices.length === 0 && (
            <p className="p-3 text-center text-sm text-muted">לא נמצאו אימוג׳ים. נסו להדביק ידנית למעלה.</p>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {allEmojiChoices.length} אימוג׳ים · Windows: Win+. · Mac: Ctrl+Cmd+Space
        </p>
        </>
        )}
      </div>
    </div>
  );
}

function PeopleManager({
  state,
  peopleSymbols,
  update,
  onUploadPhoto,
  onRemovePhoto,
  photoError,
  onPhotoError,
}: {
  state: DemoState;
  peopleSymbols: AacSymbol[];
  update: (updater: (current: DemoState) => DemoState) => void;
  onUploadPhoto: (symbolId: string, file: File) => Promise<void>;
  onRemovePhoto: (symbolId: string) => void;
  photoError: string;
  onPhotoError: (message: string) => void;
}) {
  const peoplePresets = [
    { key: "brother", hint: "אח", emoji: "👦" },
    { key: "sister", hint: "אחות", emoji: "👧" },
    { key: "friend", hint: "חבר/ה", emoji: "🧒" },
    { key: "cousin", hint: "בן/בת דוד", emoji: "🧑" },
    { key: "grandma", hint: "סבתא", emoji: "👵" },
    { key: "grandpa", hint: "סבא", emoji: "👴" },
    { key: "teacher", hint: "מורה", emoji: "👩‍🏫" },
    { key: "therapist", hint: "מטפל/ת", emoji: "👩‍⚕️" },
    { key: "other", hint: "אחר", emoji: "👤" },
  ] as const;

  const [selectedPreset, setSelectedPreset] = useState<(typeof peoplePresets)[number]["key"]>("brother");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonImage, setNewPersonImage] = useState<string | undefined>(undefined);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  const selectedEmoji =
    peoplePresets.find((preset) => preset.key === selectedPreset)?.emoji ?? "👤";

  const savePersonName = (symbol: AacSymbol, name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      onPhotoError("השם לא יכול להיות ריק.");
      return;
    }

    onPhotoError("");
    if (symbol.id.startsWith("custom-")) {
      update((current) => ({
        ...current,
        customSymbols: current.customSymbols.map((item) =>
          item.id === symbol.id ? { ...item, label: trimmed } : item,
        ),
      }));
      return;
    }

    update((current) => ({
      ...current,
      symbolLabelOverrides: {
        ...current.symbolLabelOverrides,
        [symbol.id]: trimmed,
      },
    }));
  };

  const deletePerson = (symbolId: string): void => {
    if (!symbolId.startsWith("custom-")) return;

    update((current) => {
      const nextImages = { ...current.symbolImages };
      delete nextImages[symbolId];
      const nextOverrides = { ...current.symbolLabelOverrides };
      delete nextOverrides[symbolId];

      return {
        ...current,
        customSymbols: current.customSymbols.filter((item) => item.id !== symbolId),
        symbolImages: nextImages,
        symbolLabelOverrides: nextOverrides,
        hiddenSymbolIds: current.hiddenSymbolIds.filter((id) => id !== symbolId),
        favoriteSymbolIds: current.favoriteSymbolIds.filter((id) => id !== symbolId),
        coreSymbolIds: current.coreSymbolIds.filter((id) => id !== symbolId),
      };
    });
  };

  const addPerson = (): void => {
    const name = newPersonName.trim();
    if (!name) {
      onPhotoError("הקליד/י שם — למשל: יוני, מיכל, דני.");
      return;
    }

    const symbolId = `custom-person-${Date.now()}`;
    update((current) => ({
      ...current,
      customSymbols: [
        ...current.customSymbols,
        {
          id: symbolId,
          label: name,
          emoji: selectedEmoji,
          categoryId: "people",
        },
      ],
      symbolImages: newPersonImage
        ? { ...current.symbolImages, [symbolId]: newPersonImage }
        : current.symbolImages,
      favoriteSymbolIds: current.favoriteSymbolIds.includes(symbolId)
        ? current.favoriteSymbolIds
        : [...current.favoriteSymbolIds, symbolId],
    }));

    setNewPersonName("");
    setNewPersonImage(undefined);
    onPhotoError("");
  };

  const getDraftName = (symbol: AacSymbol): string =>
    nameDrafts[symbol.id] ?? symbol.label;

  return (
    <div className="mb-8 rounded-soft border border-yellow-100 bg-yellow-50/70 p-5 shadow-sm">
      <h2 className="text-xl font-black">👪 משפחה, אחים, חברים ועוד</h2>
      <p className="mt-1 text-muted">
        הוסיפו אנשים עם שם אישי ותמונה. אפשר כמה אחים, אחיות וחברים.
      </p>

      <div className="mt-4">
        <span className="mb-2 block text-sm font-black text-slate-700">סוג האדם</span>
        <div className="flex flex-wrap gap-2">
          {peoplePresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={cx(
                "rounded-2xl border px-4 py-2 text-sm font-black transition",
                selectedPreset === preset.key
                  ? "border-yellow-500 bg-yellow-400 text-yellow-950"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-yellow-100",
              )}
              onClick={() => setSelectedPreset(preset.key)}
            >
              {preset.emoji} {preset.hint}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <label>
          <span className="mb-2 block text-sm font-black text-slate-700">שם האדם</span>
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg font-black"
            value={newPersonName}
            onChange={(event) => setNewPersonName(event.target.value)}
            placeholder="למשל: יוני, שירה, דני"
          />
        </label>
        <div>
          <span className="mb-2 block text-sm font-black text-slate-700">תמונה (אופציונלי)</span>
          <div className="flex items-center gap-2">
            {newPersonImage ? (
              <img
                src={newPersonImage}
                alt="תצוגה מקדימה"
                className="h-14 w-14 rounded-full object-cover ring-2 ring-yellow-300"
              />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-full bg-yellow-100 text-2xl">
                {selectedEmoji}
              </span>
            )}
            <label className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black">
              בחר תמונה
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    onPhotoError("בחר/י קובץ תמונה בלבד.");
                    return;
                  }
                  if (file.size > MAX_FAMILY_PHOTO_BYTES) {
                    onPhotoError("התמונה גדולה מדי. עד 8MB.");
                    return;
                  }
                  void prepareFamilyPhoto(file)
                    .then((dataUrl) => {
                      setNewPersonImage(dataUrl);
                      onPhotoError("");
                    })
                    .catch(() => onPhotoError("לא הצלחנו לטעון את התמונה."));
                }}
              />
            </label>
            {newPersonImage && (
              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-black"
                onClick={() => setNewPersonImage(undefined)}
              >
                הסר
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          className="rounded-2xl bg-yellow-500 px-5 py-3 font-black text-yellow-950"
          onClick={addPerson}
        >
          הוספת אדם
        </button>
      </div>

      {photoError && (
        <p className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-800">
          {photoError}
        </p>
      )}

      <div className="mt-6 space-y-3">
        <h3 className="text-lg font-black">כל האנשים בלוח</h3>
        {peopleSymbols.length === 0 ? (
          <p className="text-muted">עדיין לא נוספו אנשים.</p>
        ) : (
          <div className="max-h-[min(32rem,60vh)] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {peopleSymbols.map((symbol) => {
            const isCustom = symbol.id.startsWith("custom-");
            const draftName = getDraftName(symbol);

            return (
              <div
                key={symbol.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-end gap-3">
                  {symbol.pictogramId ? (
                    <img
                      src={arasaacImageUrl(symbol.pictogramId)}
                      alt={symbol.label}
                      className="h-9 w-9 rounded-md object-cover"
                    />
                  ) : (
                    <span className="text-3xl">{symbol.emoji}</span>
                  )}
                  <label className="min-w-48 flex-1">
                    <span className="mb-1 block text-xs font-black text-slate-600">שם במסך הילד</span>
                    <input
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 font-black"
                      value={draftName}
                      onChange={(event) =>
                        setNameDrafts((current) => ({
                          ...current,
                          [symbol.id]: event.target.value,
                        }))
                      }
                      onBlur={() => savePersonName(symbol, draftName)}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white"
                    onClick={() => savePersonName(symbol, draftName)}
                  >
                    שמירת שם
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      className="rounded-xl bg-red-100 px-4 py-2 text-sm font-black text-red-700"
                      onClick={() => deletePerson(symbol.id)}
                    >
                      מחיקה
                    </button>
                  )}
                </div>
                <div className="mt-3">
                  <SymbolPhotoUpload
                    symbol={symbol}
                    imageUrl={resolveSymbolImage(symbol, state.symbolImages)}
                    onUpload={(file) => onUploadPhoto(symbol.id, file)}
                    onRemove={() => onRemovePhoto(symbol.id)}
                    compact
                  />
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}

function SymbolPhotoUpload({
  symbol,
  imageUrl,
  onUpload,
  onRemove,
  compact = false,
}: {
  symbol: AacSymbol;
  imageUrl?: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
  compact?: boolean;
}) {
  const inputId = `photo-${symbol.id}`;

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3",
        compact && "flex-wrap",
      )}
    >
      {imageUrl || symbol.pictogramId ? (
        <img
          src={imageUrl || arasaacImageUrl(symbol.pictogramId as number)}
          alt={symbol.label}
          className={cx(
            "h-14 w-14 shrink-0 object-cover",
            imageUrl ? "rounded-full ring-2 ring-yellow-300" : "rounded-xl bg-yellow-50",
          )}
        />
      ) : (
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-yellow-100 text-2xl">
          {symbol.emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-black">{symbol.label}</div>
        <div className="text-sm text-muted">{imageUrl ? "יש תמונה" : "אין תמונה"}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className="cursor-pointer rounded-2xl bg-yellow-400 px-4 py-2 text-sm font-black text-yellow-950"
        >
          {imageUrl ? "שנה" : "הוסף תמונה"}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void onUpload(file);
            }
          }}
        />
        {imageUrl && (
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black"
            onClick={onRemove}
          >
            הסר
          </button>
        )}
      </div>
    </div>
  );
}

export function SymbolsDashboard({
  state,
  allSymbols,
  allCategories,
  update,
}: {
  state: DemoState;
  allSymbols: AacSymbol[];
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
  update: (updater: (current: DemoState) => DemoState) => void;
}) {
  const [newSymbolLabel, setNewSymbolLabel] = useState("");
  const [newSymbolEmoji, setNewSymbolEmoji] = useState("⭐");
  const [newSymbolCategoryId, setNewSymbolCategoryId] = useState(allCategories[0]?.id ?? "feelings");
  const [newSymbolImage, setNewSymbolImage] = useState<string | undefined>(undefined);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newCategoryEmoji, setNewCategoryEmoji] = useState("📁");
  const [newCategoryPictogram, setNewCategoryPictogram] = useState<number | undefined>(undefined);
  const [newSymbolPictogram, setNewSymbolPictogram] = useState<number | undefined>(undefined);
  const [openCategoryIds, setOpenCategoryIds] = useState<string[]>([]);
  const [familyPhotoError, setFamilyPhotoError] = useState("");
  const [formError, setFormError] = useState("");

  const peopleSymbols = allSymbols.filter((symbol) => symbol.categoryId === "people");

  const setSymbolImage = (symbolId: string, imageUrl: string | undefined): void => {
    update((current) => {
      const nextImages = { ...current.symbolImages };
      if (imageUrl) {
        nextImages[symbolId] = imageUrl;
      } else {
        delete nextImages[symbolId];
      }
      return { ...current, symbolImages: nextImages };
    });
  };

  const handleSymbolImageUpload = async (symbolId: string, file: File): Promise<void> => {
    if (!file.type.startsWith("image/")) {
      setFamilyPhotoError("בחר/י קובץ תמונה בלבד.");
      return;
    }
    if (file.size > MAX_FAMILY_PHOTO_BYTES) {
      setFamilyPhotoError("התמונה גדולה מדי. עד 8MB.");
      return;
    }

    try {
      const dataUrl = await prepareFamilyPhoto(file);
      setSymbolImage(symbolId, dataUrl);
      setFamilyPhotoError("");
    } catch {
      setFamilyPhotoError("לא הצלחנו לטעון את התמונה.");
    }
  };

  // Only what the parent / teacher added can be deleted; built-in symbols can be hidden.
  const forgetSymbols = (current: DemoState, ids: Set<string>): DemoState => {
    const symbolImages = { ...current.symbolImages };
    ids.forEach((id) => delete symbolImages[id]);
    return {
      ...current,
      customSymbols: current.customSymbols.filter((symbol) => !ids.has(symbol.id)),
      hiddenSymbolIds: current.hiddenSymbolIds.filter((id) => !ids.has(id)),
      favoriteSymbolIds: current.favoriteSymbolIds.filter((id) => !ids.has(id)),
      coreSymbolIds: current.coreSymbolIds.filter((id) => !ids.has(id)),
      symbolImages,
    };
  };

  const isCustomSymbol = (symbolId: string): boolean => state.customSymbols.some((item) => item.id === symbolId);

  const deleteSymbol = (symbol: AacSymbol): void => {
    if (!window.confirm(`למחוק את הסמל "${symbol.label}"?`)) return;
    update((current) => {
      const next = forgetSymbols(current, new Set([symbol.id]));
      // A built-in symbol is only marked as deleted, so it can be restored.
      return isCustomSymbol(symbol.id)
        ? next
        : { ...next, deletedSymbolIds: [...new Set([...(current.deletedSymbolIds ?? []), symbol.id])] };
    });
  };

  const deletedCount = (state.deletedSymbolIds?.length ?? 0) + (state.deletedCategoryIds?.length ?? 0);
  const restoreDeleted = (): void => {
    update((current) => ({
      ...current,
      deletedSymbolIds: [],
      deletedCategoryIds: [],
      enabledCategoryIds: [...new Set([...current.enabledCategoryIds, ...(current.deletedCategoryIds ?? [])])],
    }));
  };

  const deleteCategory = (category: { id: string; label: string }): void => {
    const inside = allSymbols.filter((symbol) => symbol.categoryId === category.id);
    const question = inside.length
      ? `למחוק את הקטגוריה "${category.label}" ואת ${inside.length} הסמלים שבה?`
      : `למחוק את הקטגוריה "${category.label}"?`;
    if (!window.confirm(question)) return;
    const isCustom = state.customCategories.some((item) => item.id === category.id);
    update((current) => ({
      ...forgetSymbols(current, new Set(inside.filter((symbol) => isCustomSymbol(symbol.id)).map((symbol) => symbol.id))),
      customCategories: current.customCategories.filter((item) => item.id !== category.id),
      enabledCategoryIds: current.enabledCategoryIds.filter((id) => id !== category.id),
      ...(isCustom ? {} : { deletedCategoryIds: [...new Set([...(current.deletedCategoryIds ?? []), category.id])] }),
    }));
    if (newSymbolCategoryId === category.id) setNewSymbolCategoryId(allCategories[0]?.id ?? "feelings");
  };

  const toggleCategoryOpen = (categoryId: string): void => {
    setOpenCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const toggleListValue = (
    listName: "hiddenSymbolIds" | "favoriteSymbolIds" | "coreSymbolIds" | "enabledCategoryIds",
    value: string,
  ): void => {
    update((current) => ({
      ...current,
      [listName]: current[listName].includes(value)
        ? current[listName].filter((id) => id !== value)
        : [...current[listName], value],
    }));
  };

  return (
    <section>
      <h1 className="text-3xl font-black">ניהול סמלים</h1>
      <p className="mb-6 text-muted">
        אפשר להוסיף קטגוריות וסמלים אישיים, להסתיר סמלים, לסמן מועדפים ולבחור סמלי ליבה.
      </p>

      <PeopleManager
        state={state}
        peopleSymbols={peopleSymbols}
        update={update}
        onUploadPhoto={handleSymbolImageUpload}
        onRemovePhoto={(symbolId) => setSymbolImage(symbolId, undefined)}
        photoError={familyPhotoError}
        onPhotoError={setFamilyPhotoError}
      />

      <div className="mb-8 rounded-soft border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
        <h2 className="text-xl font-black">הוספת קטגוריה חדשה</h2>
        <p className="mt-1 text-muted">צרו קטגוריה משלכם ואז הוסיפו אליה סמלים.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)_auto] lg:items-end">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            value={newCategoryLabel}
            onChange={(event) => setNewCategoryLabel(event.target.value)}
            placeholder="שם הקטגוריה, למשל: חיות"
          />
          <EmojiPickerField
            label="סמל לקטגוריה"
            value={newCategoryEmoji}
            onChange={setNewCategoryEmoji}
            pictogramId={newCategoryPictogram}
            onPictogramChange={setNewCategoryPictogram}
            suggestion={newCategoryLabel}
          />
          <button
            type="button"
            className="rounded-2xl bg-emerald-500 px-5 py-3 font-black text-white"
            onClick={() => {
              const label = newCategoryLabel.trim();
              const emoji = newCategoryEmoji.trim() || "📁";
              if (!label) {
                setFormError("הזינ/י שם לקטגוריה.");
                return;
              }

              const categoryId = `custom-cat-${Date.now()}`;
              update((current) => ({
                ...current,
                customCategories: [
                  ...current.customCategories,
                  { id: categoryId, label, emoji, ...(newCategoryPictogram ? { pictogramId: newCategoryPictogram } : {}) },
                ],
                enabledCategoryIds: [...current.enabledCategoryIds, categoryId],
              }));
              setOpenCategoryIds((current) => [...current, categoryId]);
              setNewSymbolCategoryId(categoryId);
              setNewCategoryLabel("");
              setNewCategoryEmoji("📁");
              setNewCategoryPictogram(undefined);
              setFormError("");
            }}
          >
            הוספת קטגוריה
          </button>
        </div>
      </div>

      <div className="mb-8 rounded-soft border border-blue-100 bg-blue-50/70 p-5 shadow-sm">
        <h2 className="text-xl font-black">הוספת סמל חדש</h2>
        <p className="mt-1 text-muted">הוסיפו מילה אישית עם סמל או אימוג׳י — היא תופיע גם במסך הילד.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)_220px_auto] lg:items-end">
          <input
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
            value={newSymbolLabel}
            onChange={(event) => setNewSymbolLabel(event.target.value)}
            placeholder="שם הסמל, למשל: סבתא"
          />
          <EmojiPickerField
            label="סמל"
            value={newSymbolEmoji}
            onChange={setNewSymbolEmoji}
            pictogramId={newSymbolPictogram}
            onPictogramChange={setNewSymbolPictogram}
            suggestion={newSymbolLabel}
          />
          <div>
            <label className="mb-2 block text-sm font-black text-slate-700">קטגוריה</label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              value={newSymbolCategoryId}
              onChange={(event) => {
                setNewSymbolCategoryId(event.target.value);
                if (event.target.value !== "people") {
                  setNewSymbolImage(undefined);
                }
              }}
            >
              {allCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.emoji} {category.label}
                </option>
              ))}
            </select>
          </div>
          {newSymbolCategoryId === "people" && (
            <div className="lg:col-span-2">
              <label className="mb-2 block text-sm font-black text-slate-700">
                תמונה של בן/בת משפחה (אופציונלי)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {newSymbolImage ? (
                  <img
                    src={newSymbolImage}
                    alt="תצוגה מקדימה"
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-yellow-300"
                  />
                ) : (
                  <span className="grid h-16 w-16 place-items-center rounded-full bg-yellow-100 text-2xl">
                    👤
                  </span>
                )}
                <label className="cursor-pointer rounded-2xl bg-yellow-400 px-4 py-3 font-black text-yellow-950">
                  {newSymbolImage ? "שנה תמונה" : "בחר תמונה"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (!file.type.startsWith("image/")) {
                        setFamilyPhotoError("בחר/י קובץ תמונה בלבד.");
                        return;
                      }
                      if (file.size > MAX_FAMILY_PHOTO_BYTES) {
                        setFamilyPhotoError("התמונה גדולה מדי. עד 8MB.");
                        return;
                      }
                      void prepareFamilyPhoto(file)
                        .then((dataUrl) => {
                          setNewSymbolImage(dataUrl);
                          setFamilyPhotoError("");
                        })
                        .catch(() => {
                          setFamilyPhotoError("לא הצלחנו לטעון את התמונה.");
                        });
                    }}
                  />
                </label>
                {newSymbolImage && (
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-black"
                    onClick={() => setNewSymbolImage(undefined)}
                  >
                    הסר
                  </button>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            className="rounded-2xl bg-blue-500 px-5 py-3 font-black text-white"
            onClick={() => {
              const label = newSymbolLabel.trim();
              const emoji = newSymbolEmoji.trim() || (newSymbolCategoryId === "people" ? "👤" : "⭐");
              if (!label) {
                setFormError("הזינ/י שם לסמל.");
                return;
              }

              const symbolId = `custom-${Date.now()}`;
              const customSymbol: AacSymbol = {
                id: symbolId,
                label,
                emoji,
                categoryId: newSymbolCategoryId,
                ...(newSymbolPictogram ? { pictogramId: newSymbolPictogram } : {}),
              };

              update((current) => ({
                ...current,
                customSymbols: [...current.customSymbols, customSymbol],
                favoriteSymbolIds: [...current.favoriteSymbolIds, customSymbol.id],
                symbolImages: newSymbolImage
                  ? { ...current.symbolImages, [symbolId]: newSymbolImage }
                  : current.symbolImages,
              }));
              setOpenCategoryIds((current) =>
                current.includes(newSymbolCategoryId)
                  ? current
                  : [...current, newSymbolCategoryId],
              );
              setNewSymbolLabel("");
              setNewSymbolEmoji("⭐");
              setNewSymbolPictogram(undefined);
              setNewSymbolImage(undefined);
              setFormError("");
            }}
          >
            הוספת סמל
          </button>
        </div>
        {formError && (
          <p className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-800">
            {formError}
          </p>
        )}
      </div>

      <h2 className="mb-3 text-xl font-black">קטגוריות פעילות</h2>
      <div className="mb-8 flex flex-wrap gap-3">
        {allCategories.map((category) => {
          const isEnabled = state.enabledCategoryIds.includes(category.id);

          return (
          <button
            key={category.id}
            type="button"
            className={cx(
              "rounded-full border px-4 py-2 font-black",
              isEnabled
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-slate-200 bg-white text-slate-950",
            )}
            onClick={() => toggleListValue("enabledCategoryIds", category.id)}
          >
            <CategoryIcon category={category} /> {category.label}
          </button>
          );
        })}
      </div>

      <div className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 sm:grid-cols-2">
        <p>
          <strong>★ מועדף</strong> — במסך הבית כל קטגוריה מראה רק חלק מהסמלים שלה. סמל מועדף תמיד יופיע שם, בלי
          שצריך להיכנס לקטגוריה.
        </p>
        <p>
          <strong>סמל ליבה</strong> — יופיע בשורת &quot;סמלי ליבה&quot; הקבועה, מילים שמשתמשים בהן כל הזמן (אני, רוצה,
          עוד).
        </p>
        <p>
          <strong>הסתר</strong> — הסמל לא יופיע אצל הילד/ה, ואפשר להחזיר אותו בכל רגע.
        </p>
        <p>
          <strong>🗑️ מחיקה</strong> — מוחקת סמל או קטגוריה מהלוח. סמלים וקטגוריות שבאו עם המערכת אפשר תמיד
          לשחזר.
        </p>
      </div>

      {deletedCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <span className="font-bold text-amber-950">
            נמחקו {deletedCount} סמלים/קטגוריות שבאו עם המערכת.
          </span>
          <button
            type="button"
            className="rounded-2xl bg-white px-4 py-2 font-black text-amber-900 shadow-sm ring-1 ring-amber-200"
            onClick={() => {
              if (window.confirm("להחזיר את כל הסמלים והקטגוריות שנמחקו?")) restoreDeleted();
            }}
          >
            ↩️ שחזור
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* the categories the parent / teacher added come first */}
        {[
          ...allCategories.filter((category) => state.customCategories.some((item) => item.id === category.id)),
          ...allCategories.filter((category) => !state.customCategories.some((item) => item.id === category.id)),
        ].map((category) => {
          const isOpen = openCategoryIds.includes(category.id);
          const symbolCount = allSymbols.filter((symbol) => symbol.categoryId === category.id).length;

          return (
          <section key={category.id} className="rounded-soft border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 pl-5">
              <button
                type="button"
                className="flex flex-1 items-center justify-between gap-4 p-5 text-right"
                onClick={() => toggleCategoryOpen(category.id)}
              >
                <span className="text-sm font-black text-slate-500">{isOpen ? "סגור" : "פתח"}</span>
                <span className="flex flex-1 items-center justify-end gap-3">
                  <span className="text-sm text-muted">{symbolCount} סמלים</span>
                  <span className="text-xl font-black">
                    <CategoryIcon category={category} size="h-8 w-8" /> {category.label}
                  </span>
                </span>
              </button>
              {category.id !== "core" && (
                <button
                  type="button"
                  className="shrink-0 rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700"
                  onClick={() => deleteCategory(category)}
                >
                  🗑️ מחיקת קטגוריה
                </button>
              )}
            </div>
            {isOpen && (
            <div className="space-y-3 border-t border-slate-100 p-5 pt-4">
              {allSymbols
                .filter((symbol) => symbol.categoryId === category.id)
                .map((symbol) => {
                  const isHidden = state.hiddenSymbolIds.includes(symbol.id);
                  const isFavorite = state.favoriteSymbolIds.includes(symbol.id);
                  const isCore = state.coreSymbolIds.includes(symbol.id);

                  return (
                    <div
                      key={symbol.id}
                      className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      {resolveSymbolImage(symbol, state.symbolImages) ? (
                        <img
                          src={resolveSymbolImage(symbol, state.symbolImages)}
                          alt={symbol.label}
                          className="h-12 w-12 rounded-full object-cover ring-2 ring-yellow-300"
                        />
                      ) : symbol.pictogramId ? (
                        <img
                          src={arasaacImageUrl(symbol.pictogramId)}
                          alt={symbol.label}
                          className="h-12 w-12 rounded-md object-cover"
                        />
                      ) : (
                        <span className="text-3xl">{symbol.emoji}</span>
                      )}
                      <div className="min-w-40 flex-1">
                        <div className="font-black">{symbol.label}</div>
                        <div className="text-sm text-muted">
                          {isHidden ? "מוסתר מהילד/ה" : "מוצג לילד/ה"}
                          {isFavorite ? " · ★ מועדף" : ""}
                          {isCore ? " · סמל ליבה" : ""}
                        </div>
                      </div>
                      {category.id === "people" && (
                        <label className="cursor-pointer rounded-2xl bg-yellow-400 px-4 py-2 text-sm font-black text-yellow-950">
                          {resolveSymbolImage(symbol, state.symbolImages) ? "שנה תמונה" : "הוסף תמונה"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) {
                                void handleSymbolImageUpload(symbol.id, file);
                              }
                            }}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-black"
                        onClick={() => toggleListValue("hiddenSymbolIds", symbol.id)}
                      >
                        {isHidden ? "הצג" : "הסתר"}
                      </button>
                      <button
                        type="button"
                        className={cx(
                          "rounded-2xl border border-slate-200 bg-white px-4 py-2 font-black",
                          isFavorite && "bg-amber-100",
                        )}
                        onClick={() => toggleListValue("favoriteSymbolIds", symbol.id)}
                      >
                        ★ מועדף
                      </button>
                      <button
                        type="button"
                        className={cx(
                          "rounded-2xl border border-slate-200 bg-white px-4 py-2 font-black",
                          isCore && "bg-emerald-100",
                        )}
                        onClick={() => toggleListValue("coreSymbolIds", symbol.id)}
                      >
                        סמל ליבה
                      </button>
                      {(
                        <button
                          type="button"
                          className="rounded-2xl border border-red-200 bg-white px-4 py-2 font-black text-red-700"
                          onClick={() => deleteSymbol(symbol)}
                        >
                          🗑️ מחיקה
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
            )}
          </section>
          );
        })}
      </div>
    </section>
  );
}
