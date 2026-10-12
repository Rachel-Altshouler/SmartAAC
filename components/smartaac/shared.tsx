"use client";

import {
  type AacSymbol,
  type CalendarEvent,
  type FunctionalityLevel,
  arasaacImageUrl,
  symbols,
  wordTypeColors,
} from "@/lib/demo-data";

export const MAX_TYPED_CHARS = 80;

export const sanitizeTypedText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, MAX_TYPED_CHARS);

export type DashboardView =
  | "overview"
  | "events"
  | "topic"
  | "symbols"
  | "library"
  | "daily"
  | "print"
  | "progress";

// API routes answer JSON, but a crash or a dev-server reload mid-request
// returns an HTML error page — surface that as a readable error instead of
// "Unexpected token '<' ... is not valid JSON".
export const readJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "השרת לא הגיב כמו שצריך (אולי הוא התעדכן באמצע). נסו שוב בעוד רגע." };
  }
};

export type AccountType = "create" | "join";

export const eventLabels: Record<CalendarEvent["type"], { label: string; emoji: string }> = {
  trip: { label: "טיול", emoji: "🚌" },
  birthday: { label: "יום הולדת", emoji: "🎂" },
  school: { label: "פעילות בכיתה", emoji: "🏫" },
  family: { label: "מפגש משפחתי", emoji: "👪" },
  special: { label: "פעילות מיוחדת", emoji: "⭐" },
  custom: { label: "סוג אחר", emoji: "📌" },
};

// An event's type label + emoji — its own ones for a custom type.
export const eventInfo = (event: CalendarEvent): { label: string; emoji: string } =>
  event.type === "custom"
    ? { label: event.customLabel || eventLabels.custom.label, emoji: event.customEmoji || eventLabels.custom.emoji }
    : eventLabels[event.type];

const levelLabels: Record<FunctionalityLevel, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};

// Local calendar date (YYYY-MM-DD). toISOString() is UTC, which in Israel is
// still "yesterday" between midnight and 2–3 AM.
export const localIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const today = (): string => localIsoDate(new Date());

export const cx = (...classes: Array<string | false | undefined>): string =>
  classes.filter(Boolean).join(" ");

export const resolveSymbolImage = (
  symbol: AacSymbol,
  symbolImages: Record<string, string>,
): string | undefined => symbol.imageUrl ?? symbolImages[symbol.id];

export const MAX_FAMILY_PHOTO_BYTES = 8 * 1024 * 1024;

// The child's own photo, shown on the name cell of the board. It rides with the
// board's photos (child_app_state.symbol_images_json in Supabase), so whoever on
// the care team uploads it, every device of the child gets it.
export const CHILD_PHOTO_KEY = "child-photo";

const readImageFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("לא הצלחנו לקרוא את התמונה."));
    };
    reader.onerror = () => reject(new Error("לא הצלחנו לקרוא את התמונה."));
    reader.readAsDataURL(file);
  });

const compressFamilyPhoto = async (file: File): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const maxSize = 640;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("לא הצלחנו לעבד את התמונה.");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const compressed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("לא הצלחנו לדחוס את התמונה."));
      },
      "image/jpeg",
      0.82,
    );
  });

  return readImageFileAsDataUrl(new File([compressed], "family-photo.jpg", { type: "image/jpeg" }));
};

export const prepareFamilyPhoto = async (file: File): Promise<string> => {
  if (file.size <= 400_000) {
    return readImageFileAsDataUrl(file);
  }
  return compressFamilyPhoto(file);
};

// Voices read emoji aloud by name ("🎉" → "אביזר מסיבות"), so strip them —
// they're only there for the eye.
export const stripEmoji = (text: string): string =>
  text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export const speakHebrew = (rawText: string, rate = 0.9, onEnd?: () => void): void => {
  const text = stripEmoji(rawText);
  if (!("speechSynthesis" in window) || !text) {
    onEnd?.();
    return;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "he-IL";
  utterance.rate = rate;
  if (onEnd) {
    utterance.addEventListener("end", onEnd, { once: true });
    utterance.addEventListener("error", onEnd, { once: true });
  }

  const assignVoice = (): void => {
    const voices = synth.getVoices();
    const hebrewVoices = voices.filter(
      (voice) =>
        voice.lang.startsWith("he") ||
        voice.lang.startsWith("iw") ||
        voice.name.toLowerCase().includes("hebrew"),
    );
    // Clearest first: the natural (neural) voices — Microsoft "Hila"/"Avri" in
    // Edge — then other installed voices, and Google's network voice last
    // (it ignores the `rate` we set below). The old robotic "Asaf" is a last resort.
    const score = (voice: SpeechSynthesisVoice): number => {
      const name = voice.name.toLowerCase();
      if (name.includes("natural")) return 0;
      if (name.includes("online")) return 1;
      if (name.includes("google")) return 3;
      if (name.includes("asaf")) return 4;
      return 2;
    };
    const hebrewVoice = [...hebrewVoices].sort((left, right) => score(left) - score(right))[0];
    if (hebrewVoice) {
      utterance.voice = hebrewVoice;
    }
  };

  const speakNow = (): void => {
    if (spoken) return;
    spoken = true;
    assignVoice();
    synth.speak(utterance);
  };

  let spoken = false;

  if (synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", speakNow, { once: true });
    window.setTimeout(speakNow, 300);
    return;
  }

  speakNow();
};

export type AuthMode = "parent" | "teacher";

// Hebrew search in the ARASAAC pictograms (the same symbols as the board).
export const searchPictograms = async (query: string): Promise<number[]> => {
  const response = await fetch(`https://api.arasaac.org/v1/pictograms/he/search/${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return [];
  const results = (await response.json()) as Array<{ _id?: number }>;
  return results
    .map((item) => item._id)
    .filter((id): id is number => typeof id === "number")
    .slice(0, 30);
};

export function SymbolTile({
  symbol,
  imageUrl,
  className,
  onClick,
  variant = "board",
}: {
  symbol: AacSymbol;
  imageUrl?: string;
  className?: string;
  onClick: () => void;
  variant?: "board" | "home" | "keshet" | "keshet-people";
}) {
  const isKeshet = variant === "keshet" || variant === "keshet-people";
  const isKeshetPeople = variant === "keshet-people";

  return (
    <button
      type="button"
      className={cx(
        "text-center shadow-sm transition active:scale-95",
        variant === "home"
          ? "rounded-xl border-2 p-2 shadow-soft ring-1 ring-slate-900/5 hover:-translate-y-0.5"
          : isKeshet
            ? "flex min-h-[5.25rem] flex-col items-center justify-center overflow-hidden rounded-xl border-[3px] p-1 sm:min-h-[6rem] sm:p-1.5"
            : "rounded-xl border-4 p-4",
        symbolBackground(symbol),
        className,
      )}
      onClick={onClick}
    >
      {imageUrl || symbol.pictogramId ? (
        <img
          src={imageUrl || arasaacImageUrl(symbol.pictogramId as number)}
          alt={symbol.label}
          className={cx(
            "mx-auto object-cover",
            imageUrl ? "rounded-full" : "rounded-md",
            isKeshetPeople
              ? "h-12 w-12 shrink-0 sm:h-14 sm:w-14"
              : variant === "home"
                ? "h-10 w-10 md:h-11 md:w-11"
                : isKeshet
                  ? "h-10 w-10 shrink-0 sm:h-12 sm:w-12"
                  : "h-14 w-14 md:h-16 md:w-16",
          )}
        />
      ) : (
        <span
          className={cx(
            "block leading-none",
            isKeshetPeople
              ? "text-3xl sm:text-4xl"
              : variant === "home"
                ? "text-3xl md:text-4xl"
                : isKeshet
                  ? "text-3xl sm:text-4xl"
                  : "text-5xl md:text-6xl",
          )}
        >
          {symbol.emoji}
        </span>
      )}
      <span
        className={cx(
          "block font-black text-slate-950",
          isKeshet
            ? "mt-1 text-xs leading-tight sm:text-sm"
            : variant === "home"
              ? "mt-1.5 text-sm leading-4 md:text-base"
              : "mt-2 text-base leading-5 md:text-lg",
        )}
      >
        {symbol.label}
      </span>
    </button>
  );
}

// A category's pictogram when one was chosen, otherwise its emoji.
export function CategoryIcon({
  category,
  size = "h-6 w-6",
}: {
  category?: { emoji: string; pictogramId?: number };
  size?: string;
}) {
  if (!category) return null;
  return category.pictogramId ? (
    <img src={arasaacImageUrl(category.pictogramId)} alt="" className={cx("inline-block object-contain align-middle", size)} />
  ) : (
    <>{category.emoji}</>
  );
}

// Each category's buttons get their own color, matching that row's label, so
// a child can find "food" or "people" by color alone. Core words keep the
// grammatical (Fitzgerald-key-style) coloring — they span every word type.
const categoryTileColors: Record<string, string> = {
  people: "border-yellow-400 bg-yellow-100",
  feelings: "border-pink-400 bg-pink-100",
  actions: "border-emerald-500 bg-emerald-100",
  food: "border-orange-400 bg-orange-100",
  school: "border-sky-400 bg-sky-100",
  games: "border-violet-400 bg-violet-100",
  // Neutral, so the color swatches themselves stand out.
  colors: "border-slate-400 bg-white",
};

// Custom categories have no fixed color — pick a stable one from their id.
const customCategoryPalette = [
  { tile: "border-teal-400 bg-teal-100", label: "bg-teal-300 text-teal-950" },
  { tile: "border-rose-400 bg-rose-100", label: "bg-rose-300 text-rose-950" },
  { tile: "border-indigo-400 bg-indigo-100", label: "bg-indigo-300 text-indigo-950" },
  { tile: "border-lime-500 bg-lime-100", label: "bg-lime-300 text-lime-950" },
  { tile: "border-cyan-400 bg-cyan-100", label: "bg-cyan-300 text-cyan-950" },
  { tile: "border-amber-500 bg-amber-100", label: "bg-amber-300 text-amber-950" },
];

export const customCategoryColors = (categoryId: string) => {
  const hash = [...categoryId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return customCategoryPalette[hash % customCategoryPalette.length];
};

function symbolBackground(symbol: AacSymbol): string {
  if (symbol.categoryId === "core") {
    return symbol.wordType ? wordTypeColors[symbol.wordType] : "border-amber-400 bg-amber-100";
  }
  return categoryTileColors[symbol.categoryId] ?? customCategoryColors(symbol.categoryId).tile;
}
