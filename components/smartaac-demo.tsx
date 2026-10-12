"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type AacSymbol,
  type CalendarEvent,
  type DemoState,
  type FunctionalityLevel,
  type StoryResult,
  type WeeklyTopic,
  arasaacImageUrl,
  getAllCategories,
  allEmojiChoices,
  initialState,
  keshetCategoryOrder,
  keshetCoreSymbolIds,
  keshetPreviewCount,
  quickPhrases,
  symbols,
  weeklyTopics,
  wordTypeColors,
} from "@/lib/demo-data";
import { getEventsThisWeek, getWeeklyTopicSentences } from "@/lib/context-engine";
import { genderWord, localFixSentence } from "@/lib/hebrew-grammar";
import {
  emptyUsage,
  getDeviceId,
  pickUsage,
  splitServerUsage,
  withCombinedUsage,
} from "@/lib/usage-stats";
import {
  FALLBACK_CORE_SYMBOLS,
  FALLBACK_EVENT_SYMBOLS,
  MAX_EVENT_SYMBOLS,
  type EventSymbolsResult,
} from "@/lib/event-symbols";
import { SharedLibraryDashboard } from "@/components/shared-library";
import { ChildDailyStoryView, DailyStoryDashboard, prefetchDailyStory } from "@/components/daily-story";
import { PrintSymbolsDashboard } from "@/components/print-symbols";
import { ChildDevicePanel, isChildDeviceEnabled, ParentPinModal } from "@/components/child-device";
import { buildLocalChildAiAnswer } from "@/lib/local-ai";
import { buildTeacherInviteContent } from "@/lib/teacher-invite";
import { isSupabaseConfigured, supabase } from "@/lib/supabase-browser";
import {
  parseStory,
  pickLocalStory,
  STORY_ENDING_LINE,
  STORY_FEEDBACK,
  storyStepChoices,
  storyStepContinuation,
  storyStepSentence,
  type Story,
  type StoryChoice,
} from "@/lib/story-game";

type ChildView =
  | { type: "home" }
  | { type: "category"; categoryId: string }
  | { type: "keyboard" }
  | { type: "events" }
  | { type: "assistant" }
  | { type: "story" }
  | { type: "daily" };

const TYPED_TOKEN_PREFIX = "typed:";
const MAX_TYPED_CHARS = 80;

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

const isTypedToken = (token: string): boolean => token.startsWith(TYPED_TOKEN_PREFIX);

const typedTokenLabel = (token: string): string => token.slice(TYPED_TOKEN_PREFIX.length);

const encodeTypedToken = (text: string): string => `${TYPED_TOKEN_PREFIX}${text}`;

const sanitizeTypedText = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, MAX_TYPED_CHARS);

const sentenceItemLabel = (
  token: string,
  byId: Record<string, AacSymbol>,
): string => (isTypedToken(token) ? typedTokenLabel(token) : (byId[token]?.label ?? ""));

type DashboardView =
  | "overview"
  | "events"
  | "topic"
  | "symbols"
  | "library"
  | "daily"
  | "print"
  | "progress";

const storageKey = "smartaac-next-demo";
const imagesStorageKey = "smartaac-next-demo-images";

// API routes answer JSON, but a crash or a dev-server reload mid-request
// returns an HTML error page — surface that as a readable error instead of
// "Unexpected token '<' ... is not valid JSON".
const readJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: "השרת לא הגיב כמו שצריך (אולי הוא התעדכן באמצע). נסו שוב בעוד רגע." };
  }
};

// The child this browser last worked on — sent on login so a returning user
// lands on the same child.
const readKnownChildId = (): string | undefined => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as { supabaseChildId?: string }).supabaseChildId : undefined;
  } catch {
    return undefined;
  }
};

// The access code this browser last showed — sent on login so the server can
// keep it instead of issuing (and emailing) a new one every time.
const readKnownInviteCode = (): string | undefined => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as { teacherInviteCode?: string }).teacherInviteCode : undefined;
  } catch {
    return undefined;
  }
};
const authDraftKey = "smartaac-auth-draft";
const rememberedAuthKey = "smartaac-remembered-auth";

type AccountType = "create" | "join";

type AuthDraft = {
  mode: "parent" | "teacher";
  accountType: AccountType;
  // started from "כניסה": only for someone already on the child's team
  mustBeMember?: boolean;
  name: string;
  email: string;
  childName: string;
  childAccessCode: string;
  functionalityLevel: string;
};

type RecoveredAuth = {
  email: string;
  name: string;
  teacherInviteCode?: string;
  teacherEmail?: string;
  isFirstLogin?: boolean;
  userId: string;
  childId?: string;
  childName?: string;
  linkedChildren?: Array<{ id: string; name: string }>;
  mode: "parent" | "teacher";
  accountType: AccountType;
};

const readAuthDraft = (): AuthDraft => {
  const raw = window.sessionStorage.getItem(authDraftKey);
  if (raw) {
    return JSON.parse(raw) as AuthDraft;
  }
  return {
    mode: "parent",
    accountType: "create",
    name: "הורה",
    email: "",
    childName: "דניאל",
    childAccessCode: "",
    functionalityLevel: "medium",
  };
};

const readGoogleNameFromMetadata = (
  metadata: Record<string, unknown> | undefined,
): string => {
  if (!metadata) return "";
  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }
  if (typeof metadata.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }
  return "";
};

type NeedChildCode = { needCode: true; mode: "parent" | "teacher"; mustBeMember: boolean; email: string; name: string };

async function recoverOAuthAuthResult(): Promise<RecoveredAuth | NeedChildCode | null> {
  if (!supabase) return null;

  const rawResult = window.sessionStorage.getItem("smartaac-auth-result");
  if (rawResult) {
    try {
      const parsed = JSON.parse(rawResult) as Partial<RecoveredAuth>;
      window.sessionStorage.removeItem("smartaac-auth-result");
      if (parsed.userId && parsed.email) {
        return {
          email: parsed.email,
          name: parsed.name ?? "הורה",
          teacherInviteCode: parsed.teacherInviteCode,
          teacherEmail: parsed.teacherEmail,
          isFirstLogin: parsed.isFirstLogin,
          userId: parsed.userId,
          childId: parsed.childId,
          childName: parsed.childName,
          linkedChildren: parsed.linkedChildren,
          mode: parsed.mode ?? "parent",
          accountType: parsed.accountType ?? "create",
        };
      }
    } catch {
      window.sessionStorage.removeItem("smartaac-auth-result");
    }
  }

  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;
  if (!session) return null;

  // Only right after this app's own Google button (its draft is waiting) —
  // never a silent sign-in from a Google session left in the browser: the
  // child's code is needed at every sign-in.
  if (!window.sessionStorage.getItem(authDraftKey)) return null;

  const draft = readAuthDraft();
  const googleEmail = session.user.email ?? draft.email;
  const googleName =
    readGoogleNameFromMetadata(session.user.user_metadata) || draft.name;

  const setupRes = await fetch("/api/auth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      mode: draft.mode,
      accountType: draft.accountType,
      name: googleName,
      email: googleEmail,
      childName: draft.childName,
      childAccessCode: draft.childAccessCode,
      mustBeMember: draft.mustBeMember === true,
      knownInviteCode: readKnownInviteCode(),
      knownChildId: readKnownChildId(),
      functionalityLevel: draft.functionalityLevel,
    }),
  });

  const payload = (await readJsonResponse(setupRes)) as {
    userId?: string;
    email?: string;
    name?: string;
    teacherInviteCode?: string;
    teacherEmail?: string;
    isFirstLogin?: boolean;
    childId?: string;
    childName?: string;
    linkedChildren?: Array<{ id: string; name: string }>;
    session?: { access_token: string; refresh_token: string };
    accountType?: AccountType;
    mode?: "parent" | "teacher";
  };

  if (setupRes.status === 409 && (payload as { needCode?: boolean }).needCode) {
    window.sessionStorage.removeItem(authDraftKey);
    return {
      needCode: true,
      mode: draft.mode === "teacher" ? "teacher" : "parent",
      mustBeMember: draft.mustBeMember === true,
      email: payload.email ?? googleEmail,
      name: payload.name ?? googleName,
    };
  }

  if (!setupRes.ok || !payload.userId) {
    return null;
  }

  await supabase.auth.setSession({
    access_token: payload.session?.access_token ?? session.access_token,
    refresh_token: payload.session?.refresh_token ?? session.refresh_token,
  });

  window.sessionStorage.removeItem(authDraftKey);

  return {
    email: payload.email ?? googleEmail,
    name: payload.name ?? googleName,
    teacherInviteCode: payload.teacherInviteCode,
    teacherEmail: payload.teacherEmail,
    isFirstLogin: payload.isFirstLogin,
    userId: payload.userId,
    childId: payload.childId,
    childName: payload.childName,
    linkedChildren: payload.linkedChildren,
    mode: payload.mode ?? draft.mode,
    accountType: payload.accountType ?? draft.accountType,
  };
}

const applyRecoveredAuthToState = (
  recovered: RecoveredAuth,
  updateStateFn: (updater: (current: DemoState) => DemoState) => void,
  setSavedSessionFn: (session: { name: string; email: string; role: "parent" | "teacher" }) => void,
  setTeacherEmailFn: (email: string) => void,
): void => {
  const role: "parent" | "teacher" = recovered.mode === "teacher" ? "teacher" : "parent";

  setSavedSessionFn({
    name: recovered.name,
    email: recovered.email,
    role,
  });

  if (recovered.accountType === "join") {
    updateStateFn((current) => ({
      ...current,
      dashboardRole: role,
      isProfileCreator: false,
      teacherInviteCode: recovered.teacherInviteCode ?? "",
      connectedTeacherEmail: recovered.email,
      parentEmail: current.parentEmail || recovered.email,
      activeChildName: recovered.childName ?? current.activeChildName,
      linkedChildren: recovered.linkedChildren ?? current.linkedChildren,
      isRegisteredInSupabase: true,
      supabaseUserId: recovered.userId,
      supabaseChildId: recovered.childId ?? current.supabaseChildId,
    }));
    return;
  }

  updateStateFn((current) => ({
    ...current,
    dashboardRole: role,
    isProfileCreator: true,
    parentEmail: recovered.email,
    parentName: recovered.name,
    activeChildName: recovered.childName ?? current.activeChildName,
    teacherInviteCode: recovered.teacherInviteCode ?? current.teacherInviteCode,
    connectedTeacherEmail: recovered.teacherEmail ?? current.connectedTeacherEmail,
    pendingTeacherInvite: recovered.isFirstLogin ? true : current.pendingTeacherInvite,
    isRegisteredInSupabase: true,
    supabaseUserId: recovered.userId,
    supabaseChildId: recovered.childId,
  }));

  if (recovered.teacherEmail) {
    setTeacherEmailFn(recovered.teacherEmail);
  }
};

const findWeeklyTopic = (customTopics: WeeklyTopic[] | undefined, topicId: string) =>
  [...weeklyTopics, ...(customTopics ?? [])].find((topic) => topic.id === topicId);

// Server-issued event ids are UUIDs; anything else is a local id that was
// never saved (offline, or still on its way to the server).
const isServerId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);

const EVENT_EMOJI_CHOICES = ["📌", "🩺", "🦷", "🏥", "🎭", "🎨", "🎵", "🏊", "⚽", "✈️", "🚗", "🕍", "🎉", "🛒", "💇", "🐶"];

const eventLabels: Record<CalendarEvent["type"], { label: string; emoji: string }> = {
  trip: { label: "טיול", emoji: "🚌" },
  birthday: { label: "יום הולדת", emoji: "🎂" },
  school: { label: "פעילות בכיתה", emoji: "🏫" },
  family: { label: "מפגש משפחתי", emoji: "👪" },
  special: { label: "פעילות מיוחדת", emoji: "⭐" },
  custom: { label: "סוג אחר", emoji: "📌" },
};

// An event's type label + emoji — its own ones for a custom type.
const eventInfo = (event: CalendarEvent): { label: string; emoji: string } =>
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
const localIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const today = (): string => localIsoDate(new Date());

const cx = (...classes: Array<string | false | undefined>): string =>
  classes.filter(Boolean).join(" ");

const resolveSymbolImage = (
  symbol: AacSymbol,
  symbolImages: Record<string, string>,
): string | undefined => symbol.imageUrl ?? symbolImages[symbol.id];

const MAX_FAMILY_PHOTO_BYTES = 8 * 1024 * 1024;

// The child's own photo, shown on the name cell of the board. It rides with the
// board's photos (child_app_state.symbol_images_json in Supabase), so whoever on
// the care team uploads it, every device of the child gets it.
const CHILD_PHOTO_KEY = "child-photo";

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

const prepareFamilyPhoto = async (file: File): Promise<string> => {
  if (file.size <= 400_000) {
    return readImageFileAsDataUrl(file);
  }
  return compressFamilyPhoto(file);
};

// Voices read emoji aloud by name ("🎉" → "אביזר מסיבות"), so strip them —
// they're only there for the eye.
const stripEmoji = (text: string): string =>
  text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const speakHebrew = (rawText: string, rate = 0.9, onEnd?: () => void): void => {
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

const isOpenAiQuotaError = (message?: string): boolean => {
  const text = (message ?? "").toLowerCase();
  return text.includes("insufficient_quota") || text.includes("exceeded your current quota");
};

const openAiQuotaMessage =
  "נגמרה המכסה של OpenAI. הוסיפ/י GEMINI_API_KEY (חינם) ל-.env.local מ-aistudio.google.com";

const aiApiErrorMessage = (error?: string, detail?: string): string => {
  const combined = `${error ?? ""} ${detail ?? ""}`.toLowerCase();
  if (isOpenAiQuotaError(combined)) return openAiQuotaMessage;
  if (combined.includes("network filter") || combined.includes("invalid response")) {
    return "Groq/Gemini חסומים ברשת. התקינ/י Ollama מקומי: ollama pull llama3.2";
  }
  if (error === "GROQ_API_KEY is not configured") {
    return "חסר GROQ_API_KEY. קבל/י מפתח חינם ב-console.groq.com/keys";
  }
  if (error === "GEMINI_API_KEY is not configured") {
    return "חסר GEMINI_API_KEY. קבל/י מפתח חינם ב-aistudio.google.com/apikey";
  }
  if (combined.includes("api key not valid") || combined.includes("invalid api key")) {
    return "מפתח GEMINI_API_KEY לא תקין. קבל/י מפתח חדש ב-aistudio.google.com/apikey ורעננ/י את השרת.";
  }
  if (combined.includes("quota") || combined.includes("rate limit") || combined.includes("resource exhausted")) {
    return "נגמרה מכסת Gemini (חינם). נס/י: מפתח חדש ב-aistudio.google.com/apikey, GEMINI_MODEL=gemini-2.0-flash-lite, או כתיבת המשפט במקום דיבור.";
  }
  if (error === "gemini transcription failed" || combined.includes("gemini")) {
    return `שגיאת Gemini: ${detail?.trim() || error?.trim() || "בדק/י GEMINI_API_KEY ו-GEMINI_MODEL ב-.env.local"}`;
  }
  return "";
};

const speechApiErrorMessage = (error?: string, detail?: string): string => {
  const aiMessage = aiApiErrorMessage(error, detail);
  if (aiMessage) return aiMessage;
  const combined = `${error ?? ""} ${detail ?? ""}`;
  if (error === "OPENAI_API_KEY is not configured") {
    return "חסר מפתח AI. הוסיפ/י GEMINI_API_KEY (חינם) ל-.env.local";
  }
  if (error === "local speech unavailable" || detail?.includes("gemma4")) {
    return "דיבור מקומי דורש Ollama + מודל gemma4:e4b. הריצ/י: ollama pull gemma4:e4b";
  }
  if (error === "ollama whisper model not available") {
    return "חסר מודל דיבור ב-Ollama. הריצ/י: ollama pull gemma4:e4b";
  }
  if (error === "empty transcript") {
    return "לא שמעתי מילים. דבר/י קרוב יותר למיקרופון ונס/י שוב.";
  }
  return "לא הצלחתי להבין את הדיבור. נס/י שוב, או כתב/י את המשפט.";
};

const audioExtensionForMime = (mimeType: string): string => {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
};

const SPEECH_SAMPLE_RATE = 44100;
const MIN_RECORDING_MS = 700;

const getSpeechRecognition = (): SpeechRecognitionInstance | null => {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionCtor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "he-IL";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  return recognition;
};

const pickBestTranscript = (results: SpeechRecognitionResultList): string => {
  let best = "";
  let bestConfidence = -1;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result.isFinal && i < results.length - 1) continue;

    for (let j = 0; j < result.length; j++) {
      const alternative = result[j];
      if (alternative.confidence >= bestConfidence) {
        bestConfidence = alternative.confidence;
        best = alternative.transcript;
      }
    }
  }

  if (best.trim()) return best.trim();

  let fallback = "";
  for (let i = 0; i < results.length; i++) {
    fallback += results[i][0]?.transcript ?? "";
  }
  return fallback.trim();
};

const normalizeAudio = (samples: Float32Array): Float32Array => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak < 0.02) return samples;

  const gain = Math.min(0.95 / peak, 4);
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return normalized;
};

const resampleMono = (
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (sourceRate === targetRate) return samples;

  const ratio = sourceRate / targetRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const weight = position - index;
    result[i] = samples[index] * (1 - weight) + samples[next] * weight;
  }

  return result;
};

const encodeWavBlob = (samples: Float32Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

// Peak level (0–1) under which a recording is treated as silence.
const SILENCE_PEAK = 0.02;

const recordingToWavBlob = async (blob: Blob): Promise<{ wav: Blob; peak: number }> => {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = new Float32Array(audioBuffer.length);

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < audioBuffer.length; i++) {
        mono[i] += channelData[i] / audioBuffer.numberOfChannels;
      }
    }

    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));

    const resampled = resampleMono(mono, audioBuffer.sampleRate, SPEECH_SAMPLE_RATE);
    const normalized = normalizeAudio(resampled);
    return { wav: encodeWavBlob(normalized, SPEECH_SAMPLE_RATE), peak };
  } finally {
    await audioContext.close();
  }
};

type AuthMode = "parent" | "teacher";

type ChildAiResponse = {
  answer?: string;
  note?: string;
  error?: string;
  provider?: string;
};

type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const createLocalId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

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

// Hebrew search in the ARASAAC pictograms (the same symbols as the board).
const searchPictograms = async (query: string): Promise<number[]> => {
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

const createTeacherInviteCode = (): string =>
  `AAC-${Math.floor(1000 + Math.random() * 9000)}`;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "אירעה שגיאה. נסו שוב.";

const normalizeEmail = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "");

const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

const resolveAuthFields = (
  name: string,
  email: string,
): { name: string; email: string; swapped: boolean } => {
  const trimmedName = name.trim();
  const normalizedEmail = normalizeEmail(email);

  if (isValidEmail(normalizedEmail)) {
    return { name: trimmedName, email: normalizedEmail, swapped: false };
  }

  const normalizedNameAsEmail = normalizeEmail(trimmedName);
  if (isValidEmail(normalizedNameAsEmail) && trimmedName.includes("@")) {
    return {
      name: normalizedEmail || trimmedName,
      email: normalizedNameAsEmail,
      swapped: true,
    };
  }

  return { name: trimmedName, email: normalizedEmail, swapped: false };
};

const translateAuthError = (message: string): string => {
  const lower = message.toLowerCase();

  if (lower.includes("invalid format") || lower.includes("unable to validate email")) {
    return "פורמט אימייל לא תקין. כתב/י כתובת אימייל תקינה, באותיות לועזיות ובלי רווחים.";
  }

  if (lower.includes("rate limit")) {
    return "יותר מדי ניסיונות הרשמה. המתינו כמה דקות, או כבו Confirm email ב-Supabase → Authentication → Email.";
  }
  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "הסיסמה שגויה, או שהאימייל לא מאושר. ב-Supabase: Users → בחר/י משתמש → Send password recovery.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "הסיסמה לא תואמת לאימייל הזה. אפשר ללחוץ על \"שכחתי סיסמה\" ולקבל מייל לבחירת סיסמה חדשה.";
  }
  if (lower.includes("email not confirmed")) {
    return "האימייל לא מאושר. הוסיפ/י SUPABASE_SERVICE_ROLE_KEY ל-.env.local, או כבו Confirm email ב-Supabase → Authentication → Email.";
  }
  if (lower.includes("supabase_service_role_key")) {
    return message;
  }
  if (lower.includes("not authenticated")) {
    return "ההתחברות לא הושלמה. נסו שוב, או כבו Confirm email ב-Supabase → Authentication → Email.";
  }
  if (lower.includes("failed to fetch")) {
    return "לא הצלחנו להתחבר לשרת. בדקו אינטרנט ורעננו את הדף.";
  }
  if (lower.includes("children_parent_id_fkey") || lower.includes("foreign key constraint")) {
    return "פרופיל ההורה לא נוצר ב-Supabase. ודא/י ש-SUPABASE_SERVICE_ROLE_KEY מוגדר, והריצ/י שוב את supabase/schema.sql.";
  }
  if (lower.includes("get_or_create_parent_child") || lower.includes("schema cache")) {
    return "חסרה פונקציה ב-Supabase. הריצו שוב את supabase/schema.sql ב-SQL Editor ואז רעננו.";
  }
  if (lower.includes("invalid child access code")) {
    return "קוד הילד/ה לא נכון. בדקו אותו — הקוד מופיע בלוח הבקרה, במסך \"סקירה\".";
  }
  if (lower.includes("gen_salt") || lower.includes("function crypt")) {
    return "עדכנו את הקוד. הפעילי מחדש npm run dev, ההורה יוצרת קוד חדש, והמורה מתחברת עם הקוד החדש.";
  }
  if (lower.includes("unsupported provider")) {
    return "Google לא מופעל ב-Supabase. השתמשו באימייל וסיסמה.";
  }

  return message;
};

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

export function SmartAACDemo() {
  const [state, setState] = useState<DemoState>(initialState);
  // False until the saved state has been read from localStorage. Saving before
  // that would write the empty initialState over the user's data — and in
  // React dev/StrictMode the load effect runs twice, so the second read would
  // then see that empty state and wipe photos, custom categories and settings.
  const [hasLoadedStoredState, setHasLoadedStoredState] = useState(false);
  const [sentence, setSentence] = useState<string[]>([]);
  // The AI-corrected version of `sentence`, keyed by the words it was made
  // from so a stale answer is never read aloud for a different sentence.
  const [fixedSentence, setFixedSentence] = useState<{ key: string; text: string } | null>(null);
  const [isFixingSentence, setIsFixingSentence] = useState(false);
  const [childView, setChildView] = useState<ChildView>({ type: "home" });
  const [isEntryOpen, setIsEntryOpen] = useState(true);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  // "מכשיר של ילד": this device opens straight to the board, and the hidden
  // corner asks for the parent PIN instead of the full login.
  const [isChildDevice, setIsChildDevice] = useState(false);
  const [isParentPinOpen, setIsParentPinOpen] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("parent");
  const [authAccountType, setAuthAccountType] = useState<AccountType>("create");
  const [childName, setChildName] = useState("דניאל");
  const [childAccessCode, setChildAccessCode] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  // "login" = the child's code + password only; "register" = all the details.
  const [authScreen, setAuthScreen] = useState<"login" | "register">("login");
  // After Google: who signed in, waiting for the child's code.
  const [googleCodeStep, setGoogleCodeStep] = useState<{
    mode: AuthMode;
    mustBeMember: boolean;
    email: string;
    name: string;
  } | null>(null);
  const [savedSession, setSavedSession] = useState<{
    name: string;
    email: string;
    role: "parent" | "teacher";
  } | null>(null);
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  // Supabase sync: child-scoped data (events, weekly topic, symbol settings,
  // family photos, usage stats) that used to live only in localStorage.
  // syncedChildIdRef ensures the initial pull-or-push-on-login effect runs
  // once per login per child. The five skip*SyncRef flags suppress a single
  // echo of a debounced sync effect right after its own data was just written
  // by the login reconcile (or, for events, by adopting server-issued ids) —
  // without them each sync would immediately re-fire and re-post the data it
  // just received.
  const syncedChildIdRef = useRef<string | null>(null);
  const initialSyncDoneRef = useRef(false);
  const skipTopicSyncRef = useRef(false);
  const skipSymbolSettingsSyncRef = useRef(false);
  // The photos as the server last had them — the base for sending only what
  // changed on this device (null until this child's data was loaded).
  const syncedImagesRef = useRef<Record<string, string> | null>(null);
  const latestStateRef = useRef<DemoState>(initialState);
  const skipRememberedFieldsRef = useRef(false);
  const googleCodePendingRef = useRef(false);
  latestStateRef.current = state;
  const skipUsageStatsSyncRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "need-code") {
      googleCodePendingRef.current = true;
      try {
        const raw = window.sessionStorage.getItem("smartaac-auth-need-code");
        window.sessionStorage.removeItem("smartaac-auth-need-code");
        const pending = raw ? (JSON.parse(raw) as { mode?: AuthMode; mustBeMember?: boolean; email?: string; name?: string }) : null;
        if (pending) {
          setGoogleCodeStep({
            mode: pending.mode === "teacher" ? "teacher" : "parent",
            mustBeMember: pending.mustBeMember === true,
            email: pending.email ?? "",
            name: pending.name ?? "",
          });
        }
      } catch {
        // nothing to resume — the regular sign-in stays available
      }
      window.history.replaceState({}, "", "/");
    }
    const mode = params.get("mode");
    const code = params.get("code");
    if (code) {
      // An invite link always means "join with this code" — the invitee
      // still picks their own role (parent/teacher) label in the form.
      setAuthAccountType("join");
      setAuthScreen("register");
      if (mode === "parent" || mode === "teacher") {
        setAuthMode(mode);
      }
      // the details of whoever used this browser before (e.g. the inviting
      // parent) must not be filled in for the invited teacher
      setParentEmail("");
      setParentName("");
      setPassword("");
      skipRememberedFieldsRef.current = true;
      setIsLoginOpen(true);
      setChildAccessCode(code);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      // Images live in their own storage slot (see the save effect below) so a
      // large photo library never blocks the rest of the app state from saving.
      // parsed.symbolImages is only read here as a fallback for data saved
      // before that split existed.
      let storedImages: Record<string, string> = {};
      try {
        const rawImages = window.localStorage.getItem(imagesStorageKey);
        if (rawImages) {
          const parsedImages = JSON.parse(rawImages) as Record<string, unknown>;
          storedImages =
            "symbolImages" in parsedImages
              ? (parsedImages.symbolImages as Record<string, string>) ?? {}
              : (parsedImages as Record<string, string>);
        }
      } catch {
        // corrupted images blob — fall back to whatever was in the main blob
      }

      setState({
        ...initialState,
        ...parsed,
        categoryUsageById: parsed.categoryUsageById ?? {},
        customSymbols: parsed.customSymbols ?? [],
        customCategories: parsed.customCategories ?? [],
        symbolImages:
          Object.keys(storedImages).length > 0 ? storedImages : parsed.symbolImages ?? {},
        symbolLabelOverrides: parsed.symbolLabelOverrides ?? {},
        coreSymbolIds: parsed.coreSymbolIds
          ? [...new Set([...initialState.coreSymbolIds, ...parsed.coreSymbolIds])]
          : initialState.coreSymbolIds,
        // The new "colors" category should show up for existing saved
        // profiles too, not just brand-new ones — but only add that specific
        // category, so a category someone deliberately disabled stays off.
        enabledCategoryIds:
          parsed.enabledCategoryIds && !parsed.enabledCategoryIds.includes("colors")
            ? [...parsed.enabledCategoryIds, "colors"]
            : (parsed.enabledCategoryIds ?? initialState.enabledCategoryIds),
        parentEmail: parsed.parentEmail ?? "",
        parentName: parsed.parentName ?? "",
        teacherInviteCode: parsed.teacherInviteCode ?? createTeacherInviteCode(),
        connectedTeacherEmail: parsed.connectedTeacherEmail ?? "",
        pendingTeacherInvite: parsed.pendingTeacherInvite ?? false,
        activeChildName: parsed.activeChildName ?? "דניאל",
        linkedChildren: parsed.linkedChildren ?? [],
        topicUsageById: parsed.topicUsageById ?? {},
        // Profiles saved before this flag existed: only parents could create.
        isProfileCreator: parsed.isProfileCreator ?? parsed.dashboardRole !== "teacher",
      });
    }
    setHasLoadedStoredState(true);
    if (isChildDeviceEnabled()) {
      setIsChildDevice(true);
      setIsEntryOpen(false);
    }
    const rememberedRaw = window.localStorage.getItem(rememberedAuthKey);
    if (rememberedRaw) {
      const remembered = JSON.parse(rememberedRaw) as {
        email?: string;
        name?: string;
        rememberMe?: boolean;
      };
      if (!skipRememberedFieldsRef.current) {
        if (remembered.rememberMe !== false && remembered.email) {
          setParentEmail(remembered.email);
          setRememberMe(true);
        }
        if (remembered.name) {
          setParentName(remembered.name);
        }
      }
    }
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !isSupabaseConfigured) return;

    const restoreSession = async (): Promise<void> => {
      const sessionResult = await client.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken) return;

      const params = new URLSearchParams(window.location.search);
      if (params.get("auth") === "success") return;
      // back from Google, waiting for the child's code: don't open a child yet
      if (googleCodePendingRef.current) return;

      const recovered = await recoverOAuthAuthResult();
      if (recovered && "needCode" in recovered) {
        setGoogleCodeStep(recovered);
        setIsEntryOpen(true);
      } else if (recovered) {
        applyRecoveredAuthToState(recovered, updateState, setSavedSession, setTeacherEmail);
      }
    };

    void restoreSession();
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredState) return;
    // Images are saved to their own storage slot so a full photo library can
    // never push the (frequently-changing) rest of the app state over the
    // localStorage quota and silently stop it from saving.
    const { symbolImages, ...stateWithoutImages } = state;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(stateWithoutImages));
    } catch (error) {
      console.warn("smartaac: failed to save app state to localStorage", error);
    }
    try {
      window.localStorage.setItem(imagesStorageKey, JSON.stringify({ symbolImages }));
    } catch (error) {
      console.warn("smartaac: failed to save family photos to localStorage", error);
    }
  }, [state, hasLoadedStoredState]);

  useEffect(() => {
    if (tapCount === 0) return;

    const timeout = window.setTimeout(() => setTapCount(0), 900);
    return () => window.clearTimeout(timeout);
  }, [tapCount]);

  const getSupabaseAccessToken = async (): Promise<string | null> => {
    if (!supabase) return null;
    const session = await supabase.auth.getSession();
    return session.data.session?.access_token ?? null;
  };

  const postChildData = async (
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> => {
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return null;
    }
    const token = await getSupabaseAccessToken();
    if (!token) return null;
    try {
      const response = await fetch("/api/child-data", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ childId: state.supabaseChildId, ...payload }),
      });
      const result = (await readJsonResponse(response)) as Record<string, unknown>;
      if (!response.ok) {
        console.warn("smartaac: Supabase sync rejected", response.status, result.error);
        return null;
      }
      return result;
    } catch (error) {
      console.warn("smartaac: failed to sync to Supabase", error);
      return null;
    }
  };

  const addEvent = (event: Omit<CalendarEvent, "id">): void => {
    // "local-" prefix: never mistaken for a server UUID (see isServerId).
    const localId = `local-${createLocalId("event")}`;
    setState((current) => ({ ...current, events: [...current.events, { ...event, id: localId }] }));
    void postChildData({ addEvent: event }).then((result) => {
      const saved = result?.event as CalendarEvent | undefined;
      if (!saved) return;
      // Swap the local id for the server's (a refresh may already have it).
      setState((current) => ({
        ...current,
        events: current.events.some((item) => item.id === saved.id)
          ? current.events.filter((item) => item.id !== localId)
          : current.events.map((item) => (item.id === localId ? saved : item)),
      }));
    });
  };

  const deleteEvent = (eventId: string): void => {
    setState((current) => ({ ...current, events: current.events.filter((item) => item.id !== eventId) }));
    if (isServerId(eventId)) void postChildData({ deleteEventId: eventId });
  };

  // One-time, per login/child: pull saved data down from Supabase (server wins,
  // since it's the shared source of truth for the account), or — the first time
  // this child has ever synced — push the current local snapshot up as the
  // starting point.
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return;
    if (!state.isRegisteredInSupabase || !state.supabaseChildId) return;
    if (syncedChildIdRef.current === state.supabaseChildId) return;
    syncedChildIdRef.current = state.supabaseChildId;

    const childId = state.supabaseChildId;

    void (async () => {
      const token = await getSupabaseAccessToken();
      if (!token) {
        initialSyncDoneRef.current = true;
        return;
      }

      try {
        const response = await fetch(`/api/child-data?childId=${childId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json()) as {
          events?: CalendarEvent[];
          weeklyTopicId?: string | null;
          symbolSettings?: Partial<DemoState>;
          symbolImages?: Record<string, string>;
          usageStats?: unknown;
          hasSyncedBefore?: boolean;
          accessCode?: string | null;
        };

        if (!response.ok) {
          console.warn("smartaac: failed to load synced data from Supabase", response.status, payload);
          initialSyncDoneRef.current = true;
          return;
        }

        if (payload.hasSyncedBefore) {
          // An empty photo set on the server must not wipe photos that only
          // exist locally (e.g. uploaded while a sync was failing) — keep the
          // local ones and let the images sync effect push them up.
          const serverImages = payload.symbolImages ?? {};
          const keepLocalImages =
            Object.keys(serverImages).length === 0 && Object.keys(state.symbolImages).length > 0;

          // weeklyTopicId is a string: if the server's value equals the local
          // one the sync effect never fires, and a lingering skip flag would
          // swallow the user's next real topic change.
          skipTopicSyncRef.current = Boolean(
            payload.weeklyTopicId && payload.weeklyTopicId !== state.weeklyTopicId,
          );
          skipSymbolSettingsSyncRef.current = true;
          skipUsageStatsSyncRef.current = true;
          // local-only photos (keepLocalImages) differ from this base, so the
          // photo sync uploads them
          syncedImagesRef.current = serverImages;

          setState((current) => ({
            ...current,
            teacherInviteCode: payload.accessCode || current.teacherInviteCode,
            events: payload.events ?? [],
            weeklyTopicId: payload.weeklyTopicId || current.weeklyTopicId,
            hiddenSymbolIds: payload.symbolSettings?.hiddenSymbolIds ?? current.hiddenSymbolIds,
            favoriteSymbolIds: payload.symbolSettings?.favoriteSymbolIds ?? current.favoriteSymbolIds,
            coreSymbolIds: payload.symbolSettings?.coreSymbolIds ?? current.coreSymbolIds,
            enabledCategoryIds:
              payload.symbolSettings?.enabledCategoryIds ?? current.enabledCategoryIds,
            customSymbols: payload.symbolSettings?.customSymbols ?? current.customSymbols,
            customCategories: payload.symbolSettings?.customCategories ?? current.customCategories,
            deletedSymbolIds: payload.symbolSettings?.deletedSymbolIds ?? current.deletedSymbolIds,
            deletedCategoryIds: payload.symbolSettings?.deletedCategoryIds ?? current.deletedCategoryIds,
            typedPictograms: { ...(current.typedPictograms ?? {}), ...(payload.symbolSettings?.typedPictograms ?? {}) },
            symbolLabelOverrides:
              payload.symbolSettings?.symbolLabelOverrides ?? current.symbolLabelOverrides,
            childGender: payload.symbolSettings?.childGender ?? current.childGender,
            smartGrammar: payload.symbolSettings?.smartGrammar ?? current.smartGrammar,
            customTopics: payload.symbolSettings?.customTopics ?? current.customTopics,
            symbolImages: keepLocalImages ? { ...current.symbolImages } : serverImages,
            ...(() => {
              const usage = splitServerUsage(payload.usageStats, getDeviceId());
              return { ...(usage.mine ?? emptyUsage()), otherUsage: usage.others };
            })(),
            level: payload.symbolSettings?.level ?? current.level,
            speechRate: payload.symbolSettings?.speechRate ?? current.speechRate,
            showHolidays: payload.symbolSettings?.showHolidays ?? current.showHolidays,
          }));

          initialSyncDoneRef.current = true;
        } else {
          // Events are stored per child on the server already — adopt them
          // instead of uploading whatever this device showed for another child.
          setState((current) => ({
            ...current,
            events: payload.events ?? [],
            teacherInviteCode: payload.accessCode || current.teacherInviteCode,
          }));
          initialSyncDoneRef.current = true;
          syncedImagesRef.current = { ...state.symbolImages };
          void postChildData({
            weeklyTopic: {
              id: state.weeklyTopicId,
              label:
                findWeeklyTopic(state.customTopics, state.weeklyTopicId)?.label ??
                state.weeklyTopicId,
            },
            symbolSettings: {
              hiddenSymbolIds: state.hiddenSymbolIds,
              favoriteSymbolIds: state.favoriteSymbolIds,
              coreSymbolIds: state.coreSymbolIds,
              enabledCategoryIds: state.enabledCategoryIds,
              customSymbols: state.customSymbols,
              customCategories: state.customCategories,
              deletedSymbolIds: state.deletedSymbolIds ?? [],
              deletedCategoryIds: state.deletedCategoryIds ?? [],
              typedPictograms: state.typedPictograms ?? {},
              symbolLabelOverrides: state.symbolLabelOverrides,
              childGender: state.childGender,
              smartGrammar: state.smartGrammar,
              customTopics: state.customTopics,
              level: state.level,
              speechRate: state.speechRate,
            },
            symbolImages: state.symbolImages,
            usageStats: pickUsage(state),
            deviceId: getDeviceId(),
          });
        }
      } catch (error) {
        console.warn("smartaac: failed to load synced data from Supabase", error);
        initialSyncDoneRef.current = true;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRegisteredInSupabase, state.supabaseChildId]);

  // Events are saved one by one (add / delete), so a parent and a teacher
  // editing the same child at once never overwrite each other's changes.
  // Whenever the app comes back into view, this child's events are re-read
  // from the server so changes made on another device show up.
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return;
    }
    const childId = state.supabaseChildId;
    let lastRefresh = 0;

    const refresh = (): void => {
      if (document.visibilityState !== "visible" || !initialSyncDoneRef.current) return;
      if (Date.now() - lastRefresh < 5000) return;
      lastRefresh = Date.now();
      void (async () => {
        const token = await getSupabaseAccessToken();
        if (!token) return;
        try {
          const response = await fetch(`/api/child-data?childId=${childId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const payload = (await readJsonResponse(response)) as {
            events?: CalendarEvent[];
            weeklyTopicId?: string | null;
            symbolSettings?: Partial<DemoState>;
            symbolImages?: Record<string, string>;
            accessCode?: string | null;
            usageStats?: unknown;
          };
          const local = latestStateRef.current;
          if (!response.ok || !payload.events || local.supabaseChildId !== childId) return;

          const updates: Partial<DemoState> = {
            // keep events still on their way to the server
            events: [...payload.events, ...local.events.filter((event) => !isServerId(event.id))],
          };

          // Photos: the server's, plus any change on this device not sent yet.
          const serverImages = payload.symbolImages ?? {};
          const synced = syncedImagesRef.current ?? {};
          const images = { ...serverImages };
          Object.entries(local.symbolImages).forEach(([symbolId, image]) => {
            if (synced[symbolId] !== image) images[symbolId] = image;
          });
          Object.keys(synced).forEach((symbolId) => {
            if (!(symbolId in local.symbolImages)) delete images[symbolId];
          });
          syncedImagesRef.current = serverImages;
          if (JSON.stringify(images) !== JSON.stringify(local.symbolImages)) updates.symbolImages = images;

          // Settings changed on the other device.
          const settings = payload.symbolSettings ?? {};
          const settingKeys = [
            "hiddenSymbolIds",
            "favoriteSymbolIds",
            "coreSymbolIds",
            "enabledCategoryIds",
            "customSymbols",
            "customCategories",
            "deletedSymbolIds",
            "deletedCategoryIds",
            "typedPictograms",
            "symbolLabelOverrides",
            "childGender",
            "smartGrammar",
            "customTopics",
            "level",
            "speechRate",
            "showHolidays",
          ] as const;
          const changedSettings = settingKeys.filter(
            (key) => settings[key] !== undefined && JSON.stringify(settings[key]) !== JSON.stringify(local[key]),
          );
          if (changedSettings.length > 0) {
            skipSymbolSettingsSyncRef.current = true;
            changedSettings.forEach((key) => {
              (updates as Record<string, unknown>)[key] = settings[key];
            });
          }

          updates.otherUsage = splitServerUsage(payload.usageStats, getDeviceId()).others;

          if (payload.accessCode && payload.accessCode !== local.teacherInviteCode) {
            updates.teacherInviteCode = payload.accessCode;
          }

          if (payload.weeklyTopicId && payload.weeklyTopicId !== local.weeklyTopicId) {
            skipTopicSyncRef.current = true;
            updates.weeklyTopicId = payload.weeklyTopicId;
          }

          setState((current) => (current.supabaseChildId === childId ? { ...current, ...updates } : current));
        } catch (error) {
          console.warn("smartaac: failed to refresh events", error);
        }
      })();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    // both screens open side by side: pick up the other side's changes too
    const interval = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRegisteredInSupabase, state.supabaseChildId]);

  // Debounced sync: weekly topic.
  useEffect(() => {
    if (!initialSyncDoneRef.current) return;
    if (skipTopicSyncRef.current) {
      skipTopicSyncRef.current = false;
      return;
    }
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return;
    }

    const topicLabel =
      findWeeklyTopic(state.customTopics, state.weeklyTopicId)?.label ?? state.weeklyTopicId;

    const timeout = window.setTimeout(() => {
      void postChildData({ weeklyTopic: { id: state.weeklyTopicId, label: topicLabel } });
    }, 1500);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.weeklyTopicId]);

  // Debounced sync: symbol favorites/hidden/core/enabled-category flags, plus
  // custom symbols/categories and label overrides. Bundled together since they
  // change together via the same dashboard screen and are cheap to send as one
  // small JSON blob.
  useEffect(() => {
    if (!initialSyncDoneRef.current) return;
    if (skipSymbolSettingsSyncRef.current) {
      skipSymbolSettingsSyncRef.current = false;
      return;
    }
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void postChildData({
        symbolSettings: {
          hiddenSymbolIds: state.hiddenSymbolIds,
          favoriteSymbolIds: state.favoriteSymbolIds,
          coreSymbolIds: state.coreSymbolIds,
          enabledCategoryIds: state.enabledCategoryIds,
          customSymbols: state.customSymbols,
          customCategories: state.customCategories,
          deletedSymbolIds: state.deletedSymbolIds ?? [],
          deletedCategoryIds: state.deletedCategoryIds ?? [],
          typedPictograms: state.typedPictograms ?? {},
          symbolLabelOverrides: state.symbolLabelOverrides,
          childGender: state.childGender,
          smartGrammar: state.smartGrammar,
          customTopics: state.customTopics,
          level: state.level,
          speechRate: state.speechRate,
          showHolidays: state.showHolidays,
        },
      });
    }, 1500);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.hiddenSymbolIds,
    state.favoriteSymbolIds,
    state.coreSymbolIds,
    state.enabledCategoryIds,
    state.customSymbols,
    state.customCategories,
    state.deletedSymbolIds,
    state.deletedCategoryIds,
    state.typedPictograms,
    state.symbolLabelOverrides,
    state.childGender,
    state.smartGrammar,
    state.customTopics,
    state.level,
    state.speechRate,
    state.showHolidays,
  ]);

  // Debounced sync: family photos — isolated from the settings bundle above
  // since photo payloads are large (same reason they're a separate
  // localStorage slot) and shouldn't re-upload on every favorite/hide toggle.
  useEffect(() => {
    if (!initialSyncDoneRef.current || syncedImagesRef.current === null) return;
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const synced = syncedImagesRef.current ?? {};
      const set = Object.fromEntries(
        Object.entries(state.symbolImages).filter(([symbolId, image]) => synced[symbolId] !== image),
      );
      const remove = Object.keys(synced).filter((symbolId) => !(symbolId in state.symbolImages));
      if (Object.keys(set).length === 0 && remove.length === 0) return;
      void postChildData({ symbolImagesPatch: { set, remove } }).then((result) => {
        if (!result) return;
        const next = { ...(syncedImagesRef.current ?? {}), ...set };
        remove.forEach((symbolId) => delete next[symbolId]);
        syncedImagesRef.current = next;
      });
    }, 2000);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.symbolImages]);

  // Debounced sync: usage statistics. Longer debounce since these change on
  // every symbol tap / sentence spoken — no need to sync them in near-real-time.
  useEffect(() => {
    if (!initialSyncDoneRef.current) return;
    if (skipUsageStatsSyncRef.current) {
      skipUsageStatsSyncRef.current = false;
      return;
    }
    if (!supabase || !isSupabaseConfigured || !state.isRegisteredInSupabase || !state.supabaseChildId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void postChildData({ usageStats: pickUsage(state), deviceId: getDeviceId() });
    }, 10000);

    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.usageBySymbolId,
    state.categoryUsageById,
    state.topicUsageById,
    state.sentenceCount,
    state.sentenceLengths,
    state.storyResults,
  ]);

  const saveRememberedAuth = (email: string, name: string): void => {
    if (!rememberMe) {
      window.localStorage.removeItem(rememberedAuthKey);
      return;
    }
    window.localStorage.setItem(
      rememberedAuthKey,
      JSON.stringify({ email, name, rememberMe: true }),
    );
  };

  const activeTopic = findWeeklyTopic(state.customTopics, state.weeklyTopicId);
  // Israeli holidays and national days, refreshed once a day (see /api/holidays).
  const [holidays, setHolidays] = useState<Array<{ date: string; title: string; emoji: string }>>([]);
  useEffect(() => {
    const key = "smartaac-holidays-v2"; // bump when the list format changes
    try {
      const cached = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
        day?: string;
        holidays?: Array<{ date: string; title: string; emoji: string }>;
      } | null;
      if (cached?.holidays) setHolidays(cached.holidays);
      if (cached?.day === today()) return;
    } catch {
      // no cache — fetch below
    }
    void fetch("/api/holidays")
      .then((response) => readJsonResponse(response))
      .then((payload) => {
        const list = (payload as { holidays?: Array<{ date: string; title: string; emoji: string }> }).holidays;
        if (!list?.length) return;
        setHolidays(list);
        try {
          window.localStorage.setItem(key, JSON.stringify({ day: today(), holidays: list }));
        } catch {
          // storage full — fetched again next time
        }
      })
      .catch(() => undefined);
  }, []);
  const holidayEvents: CalendarEvent[] = useMemo(
    () =>
      state.showHolidays === false
        ? []
        : holidays.map((holiday) => ({
            id: `holiday-${holiday.date}-${holiday.title}`,
            type: "custom",
            title: holiday.title,
            date: holiday.date,
            customLabel: "חג / מועד",
            customEmoji: holiday.emoji,
          })),
    [holidays, state.showHolidays],
  );
  const eventsThisWeek = useMemo(
    () => getEventsThisWeek({ ...state, events: [...state.events, ...holidayEvents] }),
    [state, holidayEvents],
  );
  const allSymbols = useMemo(() => {
    const deletedSymbols = new Set(state.deletedSymbolIds ?? []);
    const deletedCategories = new Set(state.deletedCategoryIds ?? []);
    return [...symbols, ...state.customSymbols]
      .filter((symbol) => !deletedSymbols.has(symbol.id) && !deletedCategories.has(symbol.categoryId))
      .map((symbol) => ({
        ...symbol,
        label: state.symbolLabelOverrides[symbol.id] ?? symbol.label,
      }));
  }, [state.customSymbols, state.symbolLabelOverrides, state.deletedSymbolIds, state.deletedCategoryIds]);
  const allCategories = useMemo(
    () => getAllCategories(state).filter((category) => !(state.deletedCategoryIds ?? []).includes(category.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.customCategories, state.deletedCategoryIds],
  );
  const allSymbolById = useMemo(
    () => Object.fromEntries(allSymbols.map((symbol) => [symbol.id, symbol])),
    [allSymbols],
  ) as Record<string, AacSymbol>;
  const updateState = (updater: (current: DemoState) => DemoState): void => {
    setState((current) => updater(current));
  };

  const speakText = (text: string, onEnd?: () => void): void => {
    speakHebrew(text, state.speechRate, onEnd);
  };

  const childGender = state.childGender ?? "boy";
  // Emoji of words tapped outside the board (event / daily words), shown in
  // the sentence until (or instead of) a pictogram.
  const [typedEmoji, setTypedEmoji] = useState<Record<string, string>>({});
  const smartGrammarOn = state.smartGrammar !== false;

  // "מה עשיתי היום" is loaded in the background, so it opens at once.
  useEffect(() => {
    if (state.isRegisteredInSupabase && state.supabaseChildId) prefetchDailyStory(state.supabaseChildId);
  }, [state.isRegisteredInSupabase, state.supabaseChildId]);

  const sentenceWords = (tokens: string[]): string[] =>
    tokens.map((token) => sentenceItemLabel(token, allSymbolById)).filter(Boolean);

  const requestFixedSentence = async (words: string[]): Promise<string | null> => {
    try {
      const response = await fetch("/api/fix-sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words, gender: childGender }),
        signal: AbortSignal.timeout(12000),
      });
      const payload = (await readJsonResponse(response)) as { sentence?: string };
      return response.ok && payload.sentence ? payload.sentence : null;
    } catch {
      return null;
    }
  };

  // Correct the sentence in the background while the child is still building
  // it, so pressing "הקרא" speaks the fixed version without waiting.
  useEffect(() => {
    const words = sentenceWords(sentence);
    if (!smartGrammarOn || words.length < 2) {
      setFixedSentence(null);
      return;
    }
    const key = words.join(" ");
    if (fixedSentence?.key === key) return;

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setIsFixingSentence(true);
      void requestFixedSentence(words).then((fixed) => {
        if (cancelled) return;
        setIsFixingSentence(false);
        if (fixed) setFixedSentence({ key, text: fixed });
      });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence, smartGrammarOn, childGender]);


  const addSymbol = (symbolId: string): void => {
    const symbol = allSymbolById[symbolId];
    if (!symbol) return;

    setSentence((current) => [...current, symbolId]);
    updateState((current) => {
      // Counts toward the weekly topic only when the symbol belongs to it.
      const topic = findWeeklyTopic(current.customTopics, current.weeklyTopicId);
      const inTopic = Boolean(topic?.symbolIds.includes(symbolId));
      return {
        ...current,
        usageBySymbolId: {
          ...current.usageBySymbolId,
          [symbolId]: (current.usageBySymbolId[symbolId] ?? 0) + 1,
        },
        topicUsageById: inTopic
          ? {
              ...current.topicUsageById,
              [current.weeklyTopicId]: (current.topicUsageById[current.weeklyTopicId] ?? 0) + 1,
            }
          : current.topicUsageById,
      };
    });
    speakText(genderWord(symbol.label, childGender));
  };

  // A typed word that is on the board becomes that symbol (with its picture);
  // any other word gets a picture looked up on ARASAAC.
  // `picture`: what the tapped word already shows (an ARASAAC pictogram or an
  // emoji), so the sentence at the top shows it at once.
  const addTypedText = (text: string, picture?: { pictogramId?: number; emoji?: string }): boolean => {
    const trimmed = sanitizeTypedText(text);
    if (!trimmed) return false;
    const pictureKey = trimmed.replace(/[?!.,]+$/, "");
    if (picture?.emoji) setTypedEmoji((current) => ({ ...current, [pictureKey]: picture.emoji as string }));
    if (picture?.pictogramId) {
      updateState((current) => ({
        ...current,
        typedPictograms: { ...(current.typedPictograms ?? {}), [pictureKey]: picture.pictogramId as number },
      }));
    }

    const byLabel = new Map(allSymbols.map((symbol) => [symbol.label, symbol.id]));
    const tokens = trimmed.split(" ").filter(Boolean).map((word) => {
      const bare = word.replace(/[?!.,]+$/, "");
      const withoutPrefix = bare.length > 2 && "ובהלמשכ".includes(bare.charAt(0)) ? bare.slice(1) : "";
      return byLabel.get(bare) ?? (withoutPrefix ? byLabel.get(withoutPrefix) : undefined) ?? encodeTypedToken(word);
    });
    setSentence((current) => [...current, ...tokens]);
    speakText(trimmed);

    tokens.filter(isTypedToken).forEach((token) => {
      const word = typedTokenLabel(token).replace(/[?!.,]+$/, "");
      if (state.typedPictograms?.[word] !== undefined || (word === pictureKey && picture?.pictogramId)) return;
      void fetch(`https://api.arasaac.org/v1/pictograms/he/search/${encodeURIComponent(word)}`, {
        signal: AbortSignal.timeout(8000),
      })
        .then((response) => (response.ok ? response.json() : []))
        .then((results: Array<{ _id?: number }>) => {
          const id = Array.isArray(results) && typeof results[0]?._id === "number" ? results[0]._id : 0;
          updateState((current) => ({
            ...current,
            typedPictograms: { ...(current.typedPictograms ?? {}), [word]: id },
          }));
        })
        .catch(() => undefined);
    });
    return true;
  };

  const speakSentence = async (symbolIds = sentence): Promise<void> => {
    if (symbolIds.length === 0) return;

    const words = sentenceWords(symbolIds);
    const key = words.join(" ");
    // Never make the child wait for the AI: speak the corrected sentence if
    // it's already here, otherwise the locally gendered words right away.
    const text =
      smartGrammarOn && words.length > 1 && fixedSentence?.key === key
        ? fixedSentence.text
        : localFixSentence(words, childGender);

    speakText(text);
    updateState((current) => ({
      ...current,
      sentenceCount: current.sentenceCount + 1,
      sentenceLengths: [...current.sentenceLengths, Math.max(1, symbolIds.length)].slice(-100),
      categoryUsageById: symbolIds.reduce(
        (usage, symbolId) => {
          const categoryId = allSymbolById[symbolId]?.categoryId;
          if (!categoryId || categoryId === "core") return usage;

          return {
            ...usage,
            [categoryId]: (usage[categoryId] ?? 0) + 1,
          };
        },
        { ...current.categoryUsageById },
      ),
    }));
  };

  const useQuickPhrase = (symbolIds: string[], text: string): void => {
    setSentence(symbolIds);
    speakText(text);
  };

  const openDashboardTrigger = (): void => {
    const nextCount = tapCount + 1;
    setTapCount(nextCount);

    if (nextCount >= 3) {
      setTapCount(0);
      if (isChildDevice) {
        setIsParentPinOpen(true);
      } else {
        setIsLoginOpen(true);
      }
    }
  };

  const requireSupabase = (): boolean => {
    if (!supabase || !isSupabaseConfigured) {
      setAuthMessage(
        "כדי שהכניסה תהיה אמיתית צריך להגדיר NEXT_PUBLIC_SUPABASE_URL ו-NEXT_PUBLIC_SUPABASE_ANON_KEY בקובץ .env.local.",
      );
      return false;
    }

    return true;
  };

  const openTemporaryParentDashboard = (name: string, email: string): void => {
    const nextCode = childAccessCode.trim() || state.teacherInviteCode || createTeacherInviteCode();

    updateState((current) => ({
      ...current,
      parentEmail: email || "parent@local.app",
      parentName: name || "הורה זמני",
      dashboardRole: "parent",
      isProfileCreator: true,
      teacherInviteCode: nextCode,
      activeChildName: childName.trim() || current.activeChildName || "דניאל",
      isRegisteredInSupabase: false,
      supabaseUserId: undefined,
      supabaseChildId: undefined,
    }));
    setAuthMessage("");
    setPassword("");
    setIsLoginOpen(false);
    setIsEntryOpen(false);
    setIsDashboardOpen(true);
  };

  const finishAuthSuccess = (input: {
    email: string;
    name: string;
    teacherInviteCode?: string;
    teacherEmail?: string;
    isFirstLogin?: boolean;
    userId?: string;
    childId?: string;
    childName?: string;
    linkedChildren?: Array<{ id: string; name: string }>;
    role: "parent" | "teacher";
    accountType: AccountType;
  }): void => {
    if (input.accountType === "join") {
      updateState((current) => ({
        ...current,
        dashboardRole: input.role,
        isProfileCreator: false,
        // the child's shared code: the one typed, or the stored one
        teacherInviteCode: input.teacherInviteCode ?? "",
        connectedTeacherEmail: input.email,
        parentEmail: current.parentEmail || input.email,
        activeChildName: input.childName ?? current.activeChildName,
        linkedChildren: input.linkedChildren ?? current.linkedChildren,
        isRegisteredInSupabase: true,
        supabaseUserId: input.userId,
        supabaseChildId: input.childId,
      }));
      if (input.childName) {
        setChildName(input.childName);
      }
      saveRememberedAuth(input.email, input.name);
    } else {
      updateState((current) => ({
        ...current,
        dashboardRole: input.role,
        isProfileCreator: true,
        parentEmail: input.email,
        parentName: input.name,
        activeChildName: input.childName ?? (childName.trim() || current.activeChildName),
        teacherInviteCode: input.teacherInviteCode ?? current.teacherInviteCode,
        connectedTeacherEmail:
          (input.teacherEmail ?? teacherEmail.trim()) || current.connectedTeacherEmail,
        pendingTeacherInvite: input.isFirstLogin ? true : current.pendingTeacherInvite,
        isRegisteredInSupabase: true,
        supabaseUserId: input.userId,
        supabaseChildId: input.childId,
      }));
      if (input.childName) {
        setChildName(input.childName);
      }

      saveRememberedAuth(input.email, input.name);

      if (input.isFirstLogin) {
        setInviteMessage("כניסה ראשונה! הזינ/י את אימייל מי שתרצ/י להזמין ולחצ/י על 'שלח'.");
      }
    }

    setSavedSession({
      name: input.name,
      email: input.email,
      role: input.role,
    });

    setPassword("");
    setAuthMessage("");
    setIsLoginOpen(false);
    setIsEntryOpen(false);
    setIsDashboardOpen(true);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") !== "success") return;

    void (async () => {
      const recovered = await recoverOAuthAuthResult();
      window.history.replaceState({}, "", "/");

      if (recovered && "needCode" in recovered) {
        setGoogleCodeStep(recovered);
        return;
      }
      if (!recovered) {
        setAuthMessage(
          "ההתחברות עם Google הצליחה, אבל לא הצלחנו לשמור ב-Supabase. ודא/י ש-SUPABASE_SERVICE_ROLE_KEY מוגדר ב-.env.local.",
        );
        setIsLoginOpen(true);
        return;
      }

      finishAuthSuccess({
        email: recovered.email,
        name: recovered.name,
        teacherInviteCode: recovered.teacherInviteCode,
        teacherEmail: recovered.teacherEmail,
        isFirstLogin: recovered.isFirstLogin,
        userId: recovered.userId,
        childId: recovered.childId,
        childName: recovered.childName,
        linkedChildren: recovered.linkedChildren,
        role: recovered.mode,
        accountType: recovered.accountType,
      });
    })();
  }, []);

  const submitPassword = async (): Promise<void> => {
    if (!isSupabaseConfigured) {
      if (authAccountType === "join") {
        setAuthMessage("הצטרפות עם קוד צריכה חיבור ל-Supabase. בינתיים אפשר ליצור פרופיל חדש.");
        return;
      }

      openTemporaryParentDashboard(parentName.trim(), parentEmail.trim());
      return;
    }

    if (!parentEmail.trim() || password.length < 6) {
      setAuthMessage("להרשמה ב-Supabase צריך אימייל וסיסמה של לפחות 6 תווים.");
      return;
    }
    if (authAccountType === "join" && !childAccessCode.trim()) {
      setAuthMessage("כתבו את קוד הילד/ה — לפיו המערכת יודעת לאיזה ילד/ה להיכנס.");
      return;
    }


    const resolved = resolveAuthFields(parentName.trim(), parentEmail.trim());
    if (resolved.swapped) {
      setParentName(resolved.name);
      setParentEmail(resolved.email);
    }

    const email = resolved.email;
    if (!isValidEmail(email)) {
      setAuthMessage(
        `שדה האימייל לא תקין${email ? `: "${email}"` : ""}. הזינ/י בשדה "אימייל" כתובת תקינה, באותיות לועזיות ובלי רווחים.`,
      );
      return;
    }

    setIsAuthLoading(true);
    setAuthMessage("");

    try {
      const name = resolved.name || (authMode === "parent" ? "הורה" : "מורה");

      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: authMode,
          accountType: authAccountType,
          email,
          password,
          name,
          childName: childName.trim() || "דניאל",
          childAccessCode: childAccessCode.trim(),
          knownInviteCode: state.teacherInviteCode,
          knownChildId: state.supabaseChildId,
          functionalityLevel: state.level,
        }),
      });

      const payload = (await readJsonResponse(response)) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
        teacherInviteCode?: string;
        teacherEmail?: string;
        isFirstLogin?: boolean;
        teacherInviteDelivered?: boolean;
        teacherInviteMailtoUrl?: string;
        userId?: string;
        childId?: string;
        childName?: string;
        linkedChildren?: Array<{ id: string; name: string }>;
        savedInSupabase?: boolean;
        accountType?: AccountType;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "לא הצלחנו להתחבר.");
      }

      if (!payload.savedInSupabase) {
        throw new Error("ההרשמה לא נשמרה ב-Supabase.");
      }

      if (supabase && payload.session) {
        await supabase.auth
          .setSession({
            access_token: payload.session.access_token,
            refresh_token: payload.session.refresh_token,
          })
          .catch(() => undefined);
      }

      finishAuthSuccess({
        email,
        name,
        teacherInviteCode: payload.teacherInviteCode,
        isFirstLogin: payload.isFirstLogin,
        userId: payload.userId,
        childId: payload.childId,
        childName: payload.childName,
        linkedChildren: payload.linkedChildren,
        role: authMode,
        accountType: payload.accountType ?? authAccountType,
      });
    } catch (error) {
      setAuthMessage(translateAuthError(getErrorMessage(error)));
    } finally {
      setIsAuthLoading(false);
    }
  };

  // The child's code after Google: sent with the Google session already made.
  const submitGoogleCode = async (): Promise<void> => {
    if (!googleCodeStep || !supabase) return;
    const code = childAccessCode.trim();
    if (!code) {
      setAuthMessage("כתבו את קוד הילד/ה.");
      return;
    }
    setIsAuthLoading(true);
    setAuthMessage("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("ההתחברות עם Google פגה. נסו שוב.");
      const response = await fetch("/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          mode: googleCodeStep.mode,
          accountType: "join",
          mustBeMember: googleCodeStep.mustBeMember,
          name: googleCodeStep.name,
          email: googleCodeStep.email,
          childAccessCode: code,
        }),
      });
      const payload = (await readJsonResponse(response)) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
        email?: string;
        name?: string;
        teacherInviteCode?: string;
        userId?: string;
        childId?: string;
        childName?: string;
        linkedChildren?: Array<{ id: string; name: string }>;
        mode?: AuthMode;
      };
      if (!response.ok || !payload.userId) throw new Error(payload.error ?? "לא הצלחנו להתחבר.");
      if (payload.session) {
        await supabase.auth.setSession(payload.session).catch(() => undefined);
      }
      setGoogleCodeStep(null);
      finishAuthSuccess({
        email: payload.email ?? googleCodeStep.email,
        name: payload.name ?? googleCodeStep.name,
        teacherInviteCode: payload.teacherInviteCode ?? code,
        userId: payload.userId,
        childId: payload.childId,
        childName: payload.childName,
        linkedChildren: payload.linkedChildren,
        role: payload.mode ?? googleCodeStep.mode,
        accountType: "join",
      });
    } catch (error) {
      setAuthMessage(translateAuthError(getErrorMessage(error)));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const submitCodeLogin = async (): Promise<void> => {
    const code = childAccessCode.trim();
    if (!code || !password) {
      setAuthMessage("כתבו את קוד הילד/ה ואת הסיסמה שלך.");
      return;
    }
    setIsAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "codeLogin", childAccessCode: code, password }),
      });
      const payload = (await readJsonResponse(response)) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
        teacherInviteCode?: string;
        userId?: string;
        childId?: string;
        childName?: string;
        linkedChildren?: Array<{ id: string; name: string }>;
        email?: string;
        name?: string;
        mode?: AuthMode;
      };
      if (!response.ok || !payload.email) throw new Error(payload.error ?? "לא הצלחנו להתחבר.");
      if (supabase && payload.session) {
        await supabase.auth
          .setSession({ access_token: payload.session.access_token, refresh_token: payload.session.refresh_token })
          .catch(() => undefined);
      }
      setParentEmail(payload.email);
      setParentName(payload.name ?? "");
      finishAuthSuccess({
        email: payload.email,
        name: payload.name ?? "",
        teacherInviteCode: payload.teacherInviteCode ?? code,
        userId: payload.userId,
        childId: payload.childId,
        childName: payload.childName,
        linkedChildren: payload.linkedChildren,
        role: payload.mode ?? "parent",
        accountType: "join",
      });
    } catch (error) {
      setAuthMessage(translateAuthError(getErrorMessage(error)));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const loginWithGoogle = async (): Promise<void> => {
    if (!supabase) {
      setAuthMessage("Google דורש חיבור Supabase.");
      return;
    }
    const googleAccountType: AccountType = authScreen === "login" ? "join" : authAccountType;

    setIsAuthLoading(true);
    setAuthMessage("");

    try {
      const draft: AuthDraft = {
        mode: authMode,
        accountType: googleAccountType,
        mustBeMember: authScreen === "login",
        name: parentName.trim() || (authMode === "parent" ? "הורה" : "מורה"),
        email: parentEmail.trim(),
        childName: childName.trim() || "דניאל",
        childAccessCode: childAccessCode.trim(),
        functionalityLevel: state.level,
      };

      window.sessionStorage.setItem(authDraftKey, JSON.stringify(draft));

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: "online",
            prompt: "select_account",
          },
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data.url) {
        throw new Error(
          "Google לא מופעל ב-Supabase. הפעילי אותו ב-Authentication → Providers.",
        );
      }

      window.location.href = data.url;
    } catch (error) {
      setAuthMessage(translateAuthError(getErrorMessage(error)));
      setIsAuthLoading(false);
    }
  };

  // "שכחתי סיסמה": Supabase emails a link to /reset-password.
  const sendPasswordReset = async (): Promise<void> => {
    const email = parentEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setAuthMessage("כתבו קודם את האימייל בשדה האימייל, ואז לחצו שוב על \"שכחתי סיסמה\".");
      return;
    }
    if (!supabase) return;
    setAuthMessage("שולחים מייל…");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      console.error("resetPasswordForEmail failed:", error);
      const isRateLimited = /rate limit|too many/i.test(error.message);
      setAuthMessage(
        isRateLimited
          ? "יותר מדי בקשות מייל בזמן קצר. המתינו כמה דקות ונסו שוב."
          : `לא הצלחנו לשלוח את המייל: ${error.message}`,
      );
      return;
    }
    setAuthMessage(`שלחנו ל-${email} מייל עם קישור לבחירת סיסמה חדשה. בדקו גם בספאם.`);
  };

  const quickParentEntry = (): void => {
    openTemporaryParentDashboard(parentName.trim(), parentEmail.trim());
  };

  const visibleCategorySymbols = (categoryId: string): AacSymbol[] =>
    allSymbols.filter(
      (symbol) =>
        symbol.categoryId === categoryId && !state.hiddenSymbolIds.includes(symbol.id),
    );

  // Button size stays constant across functionality levels — only which
  // symbols appear (and how many) changes with level, not their size.
  const symbolTileSize = "min-h-32";

  const rotateTeacherCode = async (): Promise<string | null> => {
    if (!supabase || !state.isRegisteredInSupabase) {
      const nextCode = createTeacherInviteCode();
      updateState((current) => ({ ...current, teacherInviteCode: nextCode }));
      return nextCode;
    }

    const sessionResult = await supabase.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      throw new Error("ההתחברות פגה. התחבר/י שוב כהורה.");
    }

    const response = await fetch("/api/teacher-code", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ childId: state.supabaseChildId }),
    });

    const payload = (await readJsonResponse(response)) as { code?: string; error?: string };
    if (!response.ok || !payload.code) {
      throw new Error(payload.error ?? "לא הצלחנו ליצור קוד חדש.");
    }

    const nextCode = payload.code;
    updateState((current) => ({ ...current, teacherInviteCode: nextCode }));
    return nextCode;
  };

  const saveActiveChildName = async (name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("הזינ/י שם לילד/ה.");
    }

    setChildName(trimmed);
    updateState((current) => ({
      ...current,
      activeChildName: trimmed,
      linkedChildren: current.linkedChildren.map((child) =>
        child.id === current.supabaseChildId ? { ...child, name: trimmed } : child,
      ),
    }));

    if (!supabase || !state.isRegisteredInSupabase) {
      return;
    }

    const sessionResult = await supabase.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      throw new Error("ההתחברות פגה. התחבר/י שוב.");
    }

    const response = await fetch("/api/child-name", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        childId: state.supabaseChildId,
        name: trimmed,
      }),
    });

    const payload = (await readJsonResponse(response)) as { name?: string; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "לא הצלחנו לשמור את השם ב-Supabase.");
    }

    if (payload.name) {
      setChildName(payload.name);
      updateState((current) => ({
        ...current,
        activeChildName: payload.name ?? trimmed,
        linkedChildren: current.linkedChildren.map((child) =>
          child.id === current.supabaseChildId ? { ...child, name: payload.name ?? trimmed } : child,
        ),
      }));
    }
  };

  const sendTeacherInvite = async (
    emailOverride: string,
    inviteeRole: "parent" | "teacher",
  ): Promise<string> => {
    const email = emailOverride.trim();
    if (!email || !isValidEmail(email)) {
      throw new Error("הזינ/י אימייל תקין.");
    }

    if (!state.teacherInviteCode) {
      throw new Error("חסר קוד גישה.");
    }

    if (supabase && state.isRegisteredInSupabase) {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (token) {
        const response = await fetch("/api/teacher-invite", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            teacherEmail: email,
            teacherInviteCode: state.teacherInviteCode,
            childId: state.supabaseChildId,
            appOrigin: window.location.origin,
            inviteeRole,
            inviterRole: state.dashboardRole ?? "parent",
          }),
        });

        const payload = (await readJsonResponse(response)) as {
          delivered?: boolean;
          error?: string;
        };

        if (response.ok && payload.delivered) {
          setTeacherEmail(email);
          updateState((current) => ({
            ...current,
            connectedTeacherEmail: inviteeRole === "teacher" ? email : current.connectedTeacherEmail,
            pendingTeacherInvite: false,
          }));
          return `המייל נשלח בהצלחה ל-${email}`;
        }

        console.warn("smartaac: automatic invite email failed", payload.error);
      }
    }

    // Automatic sending failed or isn't configured (e.g. Brevo blocking this
    // server's IP) — fall back to the user's own mail app with the invite
    // already written, so inviting never dead-ends.
    openTeacherInviteMail({
      teacherEmail: email,
      teacherInviteCode: state.teacherInviteCode,
      childName: state.activeChildName,
      parentName: state.parentName || (state.dashboardRole === "teacher" ? "מורה" : "הורה"),
      inviteeRole,
    });
    return "השליחה האוטומטית לא זמינה כרגע — נפתח חלון מייל עם ההזמנה מוכנה. רק ללחוץ 'שלח'.";
  };

  if (isDashboardOpen) {
    return (
      <Dashboard
        view={dashboardView}
        state={state}
        activeTopic={activeTopic}
        allSymbols={allSymbols}
        allCategories={allCategories}
        allSymbolById={allSymbolById}
        onViewChange={setDashboardView}
        onStateChange={setState}
        onRotateTeacherCode={rotateTeacherCode}
        onSendTeacherInvite={sendTeacherInvite}
        teacherEmail={teacherEmail}
        onTeacherEmailChange={setTeacherEmail}
        inviteMessage={inviteMessage}
        onActiveChildNameChange={saveActiveChildName}
        isChildDevice={isChildDevice}
        onChildDeviceChange={setIsChildDevice}
        onAddEvent={addEvent}
        onDeleteEvent={deleteEvent}
        holidayEvents={holidayEvents}
        onClose={() => {
          setIsDashboardOpen(false);
          // A child device goes straight back to the board, not the entry screen.
          setIsEntryOpen(!isChildDevice);
          setChildView({ type: "home" });
        }}
      />
    );
  }

  if (isEntryOpen) {
    return (
      <main className="min-h-screen overflow-auto bg-[radial-gradient(circle_at_top_right,_#e0e7ff_0,_transparent_40%),radial-gradient(circle_at_bottom_left,_#d1fae5_0,_transparent_40%),linear-gradient(135deg,_#f5f8ff,_#fbfcff)] p-5 font-rubik">
        <section className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-5xl flex-col justify-center">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-[1.75rem] bg-gradient-to-br from-blue-500 to-violet-500 text-4xl shadow-soft">
              💬
            </div>
            <div className="mb-4 inline-flex rounded-full bg-white/80 px-4 py-1.5 text-sm font-bold text-blue-700 shadow-sm ring-1 ring-blue-100">
              SmartAAC · תקשורת תומכת וחליפית (תת״ח)
            </div>
            <h1 className="mx-auto max-w-3xl bg-gradient-to-l from-blue-700 via-indigo-600 to-violet-600 bg-clip-text text-3xl font-bold leading-snug tracking-tight text-transparent md:text-5xl md:leading-snug">
              מערכת להעשרת השפה והתקשורת לילדים עם צרכים מיוחדים
            </h1>
          </div>

          <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
            <button
              type="button"
              className="group flex h-full flex-col items-center rounded-[2rem] bg-white/90 p-8 text-center shadow-soft ring-1 ring-emerald-100 transition hover:-translate-y-1"
              onClick={() => {
                setIsEntryOpen(false);
                setChildView({ type: "home" });
              }}
            >
              <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-teal-200 text-6xl transition group-hover:scale-105">
                🧒
              </span>
              <span className="mt-5 block text-2xl font-bold">כניסת ילד/ה</span>
              <span className="mt-2 block leading-7 text-muted">לוח התקשורת בסמלים, שמקריא בקול כל משפט שבונים.</span>
              <span className="mt-6 inline-flex rounded-full bg-gradient-to-l from-emerald-500 to-teal-500 px-6 py-3 font-bold text-white shadow-sm">
                פתיחת לוח התקשורת
              </span>
            </button>

            <button
              type="button"
              className="group flex h-full flex-col items-center rounded-[2rem] bg-white/90 p-8 text-center shadow-soft ring-1 ring-blue-100 transition hover:-translate-y-1"
              onClick={() => {
                setAuthScreen("login");
                setIsLoginOpen(true);
              }}
            >
              <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-200 text-6xl transition group-hover:scale-105">
                👩‍👧
              </span>
              <span className="mt-5 block text-2xl font-bold">כניסת הורה / מורה</span>
              <span className="mt-2 block leading-7 text-muted">
                אירועים, נושא שבועי, תמונות מהיום, סמלים, הדפסה ומעקב התקדמות.
              </span>
              <span className="mt-6 inline-flex rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-6 py-3 font-bold text-white shadow-sm">
                כניסה / הרשמה
              </span>
            </button>
          </div>
        </section>

        {googleCodeStep && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/45 p-5">
            <div className="flex min-h-full justify-center">
              <div className="my-auto w-full max-w-md rounded-soft bg-white p-6 shadow-soft">
                <div className="mb-4 rounded-2xl bg-blue-50 p-4">
                  <h2 className="mb-1 text-2xl font-black">
                    שלום{googleCodeStep.name ? ` ${googleCodeStep.name}` : ""}! 👋
                  </h2>
                  <p className="text-muted">
                    נכנסת עם Google{googleCodeStep.email ? ` (${googleCodeStep.email})` : ""}. עכשיו הקישו את קוד הילד/ה —
                    והמערכת תיכנס אליו/ה.
                  </p>
                </div>
                <label className="grid gap-1">
                  <span className="text-sm font-black text-slate-600">קוד הילד/ה</span>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-center text-lg font-bold tracking-widest"
                    dir="ltr"
                    autoFocus
                    value={childAccessCode}
                    onChange={(event) => setChildAccessCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submitGoogleCode();
                    }}
                    placeholder="AAC-1234"
                  />
                </label>
                {authMessage && (
                  <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{authMessage}</p>
                )}
                {authMessage.includes("להירשם") && (
                  <button
                    type="button"
                    className="mt-2 w-full rounded-2xl bg-emerald-600 px-5 py-3 font-bold text-white"
                    onClick={() => {
                      setGoogleCodeStep(null);
                      setAuthMessage("");
                      setAuthScreen("register");
                      setAuthAccountType("join");
                      setIsLoginOpen(true);
                    }}
                  >
                    להרשמה למערכת
                  </button>
                )}
                <button
                  type="button"
                  className="mt-5 w-full rounded-2xl bg-blue-500 px-5 py-3 text-lg font-bold text-white disabled:opacity-60"
                  disabled={isAuthLoading}
                  onClick={() => void submitGoogleCode()}
                >
                  {isAuthLoading ? "מתחבר..." : "כניסה"}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-3 font-bold"
                  onClick={() => {
                    setGoogleCodeStep(null);
                    setAuthMessage("");
                    void supabase?.auth.signOut();
                  }}
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoginOpen && (
          <LoginModal
            password={password}
            parentName={parentName}
            parentEmail={parentEmail}
            authMode={authMode}
            accountType={authAccountType}
            childName={childName}
            childAccessCode={childAccessCode}
            rememberMe={rememberMe}
            authMessage={authMessage}
            isLoading={isAuthLoading}
            supabaseReady={isSupabaseConfigured}
            onGoogle={loginWithGoogle}
            onAuthModeChange={setAuthMode}
            onAccountTypeChange={setAuthAccountType}
            onChildNameChange={setChildName}
            onChildAccessCodeChange={setChildAccessCode}
            onRememberMeChange={setRememberMe}
            onParentNameChange={setParentName}
            onParentEmailChange={setParentEmail}
            onPasswordChange={setPassword}
            onCancel={() => setIsLoginOpen(false)}
            onSubmit={submitPassword}
            onQuickEntry={quickParentEntry}
          onForgotPassword={() => void sendPasswordReset()}
          authScreen={authScreen}
          onAuthScreenChange={(screen) => {
            setAuthScreen(screen);
            setAuthMessage("");
            if (screen === "login") setAuthAccountType("join");
          }}
          onCodeLogin={() => void submitCodeLogin()}
          />
        )}
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_right,_#dff7ff_0,_transparent_35%),linear-gradient(135deg,_#eaf5ff,_#f7fbff_48%,_#eafaf4)] p-3">
      <button
        type="button"
        aria-label="כניסת מטפל"
        className="fixed left-0 top-0 z-30 h-14 w-14"
        onClick={openDashboardTrigger}
      />

      <header className="mx-auto flex w-full max-w-7xl gap-3 overflow-x-auto rounded-t-[2rem] border border-white bg-white/90 p-3 shadow-soft backdrop-blur">
        <button
          type="button"
          className="min-w-20 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm"
          onClick={() => (isChildDevice ? setChildView({ type: "home" }) : setIsEntryOpen(true))}
        >
          בית
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-red-200 bg-red-50 text-center font-black text-red-800 shadow-sm"
          onClick={() => setSentence((current) => current.slice(0, -1))}
          aria-label="מחק סמל אחרון"
          title="מחיקת מילה"
        >
          <span className="block text-2xl">⌫</span>
          <span className="block text-xs">מילה</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-red-300 bg-red-100 text-center font-black text-red-900 shadow-sm"
          onClick={() => setSentence([])}
          aria-label="מחק משפט"
          title="מחיקת משפט"
        >
          <span className="block text-2xl">🗑️</span>
          <span className="block text-xs">משפט</span>
        </button>

        <div
          className={cx(
            "flex min-h-20 flex-1 items-center gap-2 overflow-x-auto rounded-[1.5rem] border-4 border-blue-200 bg-gradient-to-l from-white to-blue-50 p-3 shadow-inner",
            sentence.length === 0 && "text-muted",
          )}
        >
          {sentence.length === 0 ? (
            <span className="px-3 text-2xl font-black text-slate-400">
              בנה משפט בעזרת הסמלים...
            </span>
          ) : (
            sentence.map((symbolId, index) => {
              const symbol = allSymbolById[symbolId];
              const label = sentenceItemLabel(symbolId, allSymbolById);
              if (!label) return null;
              const typedPictogram = isTypedToken(symbolId)
                ? state.typedPictograms?.[label.replace(/[?!.,]+$/, "")]
                : undefined;
              const imageUrl = symbol
                ? resolveSymbolImage(symbol, state.symbolImages)
                : typedPictogram
                  ? arasaacImageUrl(typedPictogram)
                  : undefined;
              return (
                <span
                  key={`${symbolId}-${index}`}
                  className="min-w-20 rounded-2xl border-2 border-blue-100 bg-white px-3 py-2 text-center shadow-sm"
                >
                  {imageUrl || symbol?.pictogramId ? (
                    <img
                      src={imageUrl || arasaacImageUrl(symbol?.pictogramId as number)}
                      alt={label}
                      className={cx(
                        "mx-auto h-10 w-10 object-cover",
                        symbol && imageUrl ? "rounded-full" : "rounded-md",
                      )}
                    />
                  ) : (
                    <span className="block text-2xl">
                      {symbol?.emoji ?? typedEmoji[label.replace(/[?!.,]+$/, "")] ?? "⌨️"}
                    </span>
                  )}
                  <span className="block text-xs text-muted">{label}</span>
                </span>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-blue-600 text-center font-black text-white shadow-soft"
          onClick={() => void speakSentence()}
          aria-label="הקרא משפט"
          title="הקראה"
        >
          <span className="block text-2xl">🔊</span>
          <span className="block text-xs">הקרא</span>
        </button>

        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-sky-300 text-center font-black text-sky-950 shadow-sm"
          onClick={() => setChildView({ type: "keyboard" })}
          aria-label="מקלדת להקלדה"
          title="מקלדת"
        >
          <span className="block text-2xl">⌨️</span>
          <span className="block text-xs">מקלדת</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-violet-300 text-center font-black text-violet-950 shadow-sm"
          onClick={() => setChildView({ type: "events" })}
          aria-label="לוח אירועים"
          title="לוח אירועים"
        >
          <span className="block text-2xl">🗓️</span>
          <span className="block text-xs">אירועים</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-emerald-300 text-center font-black text-emerald-950 shadow-sm"
          onClick={() => setChildView({ type: "assistant" })}
          aria-label="שיחה חכמה"
          title="שיחה חכמה"
        >
          <span className="block text-2xl">🗣️</span>
          <span className="block text-xs">שיחה</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-rose-300 text-center font-black text-rose-950 shadow-sm"
          onClick={() => setChildView({ type: "story" })}
          aria-label="בואו נספר סיפור"
          title="סיפור"
        >
          <span className="block text-2xl">📖</span>
          <span className="block text-xs">סיפור</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-20 shrink-0 place-items-center rounded-2xl bg-amber-300 text-center font-black text-amber-950 shadow-sm"
          onClick={() => setChildView({ type: "daily" })}
          aria-label="מה עשיתי היום"
          title="מה עשיתי היום — בבית ובבית הספר"
        >
          <span className="block text-2xl">📸</span>
          <span className="block text-xs leading-tight">מה עשיתי היום</span>
        </button>
        <button
          type="button"
          className="grid min-h-20 w-24 shrink-0 place-items-center rounded-2xl border-2 border-slate-300 bg-white px-1 text-center font-black text-slate-700 shadow-sm"
          onClick={() => {
            // On the child's own device the parent PIN guards the dashboard;
            // elsewhere this is the regular parent/teacher sign-in.
            if (isChildDevice) {
              setIsParentPinOpen(true);
            } else {
              setAuthScreen("login");
              setIsLoginOpen(true);
            }
          }}
          aria-label="חזרה למסך הורה / מורה"
          title="חזרה למסך הורה / מורה"
        >
          <span className="block text-2xl">🔒</span>
          <span className="block text-[11px] leading-tight">מסך הורה / מורה</span>
        </button>
      </header>

      <section className="mx-auto flex w-full max-w-7xl flex-1 min-h-0 flex-col overflow-hidden rounded-b-[2rem] border-x border-b border-white bg-white/55 p-3 shadow-soft backdrop-blur sm:p-4">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {childView.type === "home" && (
          <KeshetHomeView
            childName={state.activeChildName || childName}
            level={state.level}
            coreSymbolIds={state.coreSymbolIds}
            enabledCategoryIds={state.enabledCategoryIds}
            allCategories={allCategories}
            allSymbols={allSymbols.filter((symbol) => !state.hiddenSymbolIds.includes(symbol.id))}
            favoriteSymbolIds={state.favoriteSymbolIds}
            symbolImages={state.symbolImages}
            onSymbolClick={addSymbol}
            onCategoryClick={(categoryId) => setChildView({ type: "category", categoryId })}
          />
        )}

        {childView.type === "category" && (
          <CategoryView
            categoryId={childView.categoryId}
            allCategories={allCategories}
            symbols={visibleCategorySymbols(childView.categoryId)}
            symbolImages={state.symbolImages}
            tileSize={symbolTileSize}
            onBack={() => setChildView({ type: "home" })}
            onSymbolClick={addSymbol}
          />
        )}

        {childView.type === "keyboard" && (
          <KeyboardView
            onBack={() => setChildView({ type: "home" })}
            onSpeak={speakText}
            onAddToSentence={addTypedText}
          />
        )}

        {childView.type === "events" && (
          <ChildEventsView
            eventsThisWeek={eventsThisWeek}
            activeTopic={activeTopic}
            topicSymbols={(activeTopic?.symbolIds ?? [])
              .filter((symbolId) => !state.hiddenSymbolIds.includes(symbolId))
              .map((symbolId) => allSymbolById[symbolId])
              .filter(Boolean)}
            allSymbols={allSymbols.filter((symbol) => !state.hiddenSymbolIds.includes(symbol.id))}
            symbolImages={state.symbolImages}
            onSymbolClick={addSymbol}
            onWordClick={(word, picture) => void addTypedText(word, picture)}
            childGender={childGender}
            onBack={() => setChildView({ type: "home" })}
            onPhraseClick={(phrase) => speakText(phrase)}
          />
        )}

        {childView.type === "assistant" && (
          <VoiceAssistantView
            onBack={() => setChildView({ type: "home" })}
            onSpeak={speakText}
            speechRate={state.speechRate}
            childGender={childGender}
          />
        )}

        {childView.type === "daily" && (
          <ChildDailyStoryView
            childId={state.isRegisteredInSupabase ? state.supabaseChildId : undefined}
            symbolById={allSymbolById}
            symbolImages={state.symbolImages}
            onBack={() => setChildView({ type: "home" })}
            onSpeak={(text) => speakText(text)}
            onSymbolClick={addSymbol}
            onWordClick={(word, picture) => void addTypedText(word, picture)}
          />
        )}

        {childView.type === "story" && (
          <StoryGameView
            onBack={() => setChildView({ type: "home" })}
            onSpeak={speakText}
            onStoryFinished={(result) =>
              updateState((current) => ({
                ...current,
                storyResults: [...(current.storyResults ?? []), result].slice(-50),
              }))
            }
          />
        )}
        </div>
      </section>

      {isLoginOpen && (
        <LoginModal
          password={password}
          parentName={parentName}
          parentEmail={parentEmail}
          authMode={authMode}
          accountType={authAccountType}
          childName={childName}
          childAccessCode={childAccessCode}
          rememberMe={rememberMe}
          authMessage={authMessage}
          isLoading={isAuthLoading}
          supabaseReady={isSupabaseConfigured}
          onGoogle={loginWithGoogle}
          onAuthModeChange={setAuthMode}
          onAccountTypeChange={setAuthAccountType}
          onChildNameChange={setChildName}
          onChildAccessCodeChange={setChildAccessCode}
          onRememberMeChange={setRememberMe}
          onParentNameChange={setParentName}
          onParentEmailChange={setParentEmail}
          onPasswordChange={setPassword}
          onCancel={() => setIsLoginOpen(false)}
          onSubmit={submitPassword}
          onQuickEntry={quickParentEntry}
          onForgotPassword={() => void sendPasswordReset()}
          authScreen={authScreen}
          onAuthScreenChange={(screen) => {
            setAuthScreen(screen);
            setAuthMessage("");
            if (screen === "login") setAuthAccountType("join");
          }}
          onCodeLogin={() => void submitCodeLogin()}
        />
      )}

      {isParentPinOpen && (
        <ParentPinModal
          onSuccess={() => {
            setIsParentPinOpen(false);
            setIsDashboardOpen(true);
          }}
          onForgot={() => {
            // Forgot the PIN: sign in with email + password instead, then set
            // a new PIN in the dashboard.
            setIsParentPinOpen(false);
            setIsLoginOpen(true);
          }}
          onCancel={() => setIsParentPinOpen(false)}
        />
      )}
    </main>
  );
}

function LoginModal({
  password,
  parentName,
  parentEmail,
  authMode,
  accountType,
  childName,
  childAccessCode,
  rememberMe,
  authMessage,
  isLoading,
  supabaseReady,
  onGoogle,
  onAuthModeChange,
  onAccountTypeChange,
  onChildNameChange,
  onChildAccessCodeChange,
  onRememberMeChange,
  onParentNameChange,
  onParentEmailChange,
  onPasswordChange,
  onCancel,
  onSubmit,
  onQuickEntry,
  onForgotPassword,
  authScreen,
  onAuthScreenChange,
  onCodeLogin,
}: {
  password: string;
  parentName: string;
  parentEmail: string;
  authMode: AuthMode;
  accountType: AccountType;
  childName: string;
  childAccessCode: string;
  rememberMe: boolean;
  authMessage: string;
  isLoading: boolean;
  supabaseReady: boolean;
  onGoogle: () => void;
  onAuthModeChange: (mode: AuthMode) => void;
  onAccountTypeChange: (accountType: AccountType) => void;
  onChildNameChange: (value: string) => void;
  onChildAccessCodeChange: (value: string) => void;
  onRememberMeChange: (value: boolean) => void;
  onParentNameChange: (value: string) => void;
  onParentEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onQuickEntry: () => void;
  onForgotPassword: () => void;
  authScreen: "login" | "register";
  onAuthScreenChange: (screen: "login" | "register") => void;
  onCodeLogin: () => void;
}) {
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [pressedGoogle, setPressedGoogle] = useState(false);
  useEffect(() => {
    if (!isLoading) setPressedGoogle(false);
  }, [isLoading]);
  const pressGoogle = (): void => {
    setPressedGoogle(true);
    onGoogle();
  };
  const googleBusy = isLoading && pressedGoogle;
  const formBusy = isLoading && !pressedGoogle;
  const screenTabs = supabaseReady && (
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
      {(
        [
          ["login", "כניסה"],
          ["register", "הרשמה"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={cx(
            "rounded-xl px-4 py-3 text-lg font-black text-slate-600",
            authScreen === id && "bg-white text-blue-700 shadow-sm",
          )}
          onClick={() => onAuthScreenChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (supabaseReady && authScreen === "login") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/45 p-5">
        <div className="flex min-h-full justify-center">
          <div className="my-auto w-full max-w-md rounded-soft bg-white p-6 shadow-soft">
            {screenTabs}
            <div className="mb-4 rounded-2xl bg-blue-50 p-4">
              <h2 className="mb-1 text-2xl font-black">כניסה</h2>
              <p className="text-muted">קוד הילד/ה והסיסמה שלך — והמערכת מזהה אותך ונכנסת ישר לילד/ה.</p>
            </div>
            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-sm font-black text-slate-600">קוד הילד/ה</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-center text-lg font-bold tracking-widest"
                  dir="ltr"
                  value={childAccessCode}
                  onChange={(event) => onChildAccessCodeChange(event.target.value)}
                  placeholder="הקלידו כאן את הקוד שקיבלתם"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-black text-slate-600">הסיסמה שלך</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onCodeLogin();
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              className="mt-2 text-sm font-black text-blue-700 underline"
              onClick={() => setIsForgotOpen((open) => !open)}
            >
              שכחתי סיסמה
            </button>
            {isForgotOpen && (
              <div className="mt-2 grid gap-2 rounded-2xl bg-slate-50 p-3">
                <span className="text-sm font-bold text-slate-600">האימייל שאיתו נרשמת — נשלח אליו קישור לסיסמה חדשה:</span>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                  type="email"
                  dir="ltr"
                  value={parentEmail}
                  onChange={(event) => onParentEmailChange(event.target.value)}
                  placeholder="name@email.com"
                />
                <button
                  type="button"
                  className="rounded-xl bg-white px-4 py-2 font-black text-blue-700 ring-1 ring-blue-200"
                  onClick={onForgotPassword}
                >
                  שליחת קישור
                </button>
              </div>
            )}
            {authMessage && (
              <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{authMessage}</p>
            )}
            {authMessage.includes("להירשם") && (
              <button
                type="button"
                className="mt-2 w-full rounded-2xl bg-emerald-600 px-5 py-3 font-bold text-white"
                onClick={() => onAuthScreenChange("register")}
              >
                להרשמה למערכת
              </button>
            )}
            <button
              type="button"
              className="mt-5 w-full rounded-2xl bg-blue-500 px-5 py-3 text-lg font-bold text-white disabled:opacity-60"
              onClick={onCodeLogin}
              disabled={isLoading}
            >
              {formBusy ? "מתחבר..." : "כניסה"}
            </button>
            {/* whoever signed up with Google has no password: the child's code + Google */}
            <button
              type="button"
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-black shadow-sm"
              onClick={pressGoogle}
              disabled={isLoading}
            >
              <svg className="h-5 w-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              {googleBusy ? "פותח את Google..." : "כניסה עם Google"}
            </button>
            <p className="mt-3 text-center text-sm text-muted">
              עוד אין לך חשבון?{" "}
              <button type="button" className="font-black text-blue-700 underline" onClick={() => onAuthScreenChange("register")}>
                הרשמה
              </button>
            </p>
            <button
              type="button"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-3 font-bold"
              onClick={onCancel}
            >
              ביטול
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/45 p-5">
      <div className="flex min-h-full justify-center">
        <div className="my-auto w-full max-w-md rounded-soft bg-white p-6 shadow-soft">
        {screenTabs}
        <div className="mb-4 rounded-2xl bg-blue-50 p-4">
          <h2 className="mb-1 text-2xl font-black">
            {supabaseReady
              ? accountType === "create"
                ? "הרשמה — פרופיל חדש לילד/ה"
                : "הרשמה — הצטרפות לילד/ה עם קוד"
              : "כניסה למערכת"}
          </h2>
          <p className="text-muted">
            {supabaseReady
              ? accountType === "create"
                ? "מלא/י אימייל וסיסמה. המערכת תיצור חשבון ופרופיל ילד חדש — ותקבל/י קוד לשתף עם מי שתרצ/י להזמין."
                : "בפעם הראשונה: אימייל, שם, הקוד שקיבלת וסיסמה. מהפעם הבאה נכנסים בלשונית \"כניסה\" רק עם הקוד והסיסמה."
              : "אין חיבור Supabase. אפשר לנסות את לוח הבקרה בלבד, בלי שמירה בשרת."}
          </p>
        </div>
        <div className="mb-3">
          <span className="mb-1 block text-xs font-black text-slate-500">התפקיד שלך (לתצוגה בלבד)</span>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              className={cx(
                "rounded-xl px-4 py-3 font-black",
                authMode === "parent" && "bg-white text-blue-700 shadow-sm",
              )}
              onClick={() => onAuthModeChange("parent")}
            >
              הורה
            </button>
            <button
              type="button"
              className={cx(
                "rounded-xl px-4 py-3 font-black",
                authMode === "teacher" && "bg-white text-blue-700 shadow-sm",
              )}
              onClick={() => onAuthModeChange("teacher")}
            >
              מורה
            </button>
          </div>
        </div>
        {supabaseReady && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-black text-slate-500">
              פרופיל חדש או הצטרפות לילד/ה קיים/ת?
            </span>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                className={cx(
                  "rounded-xl px-4 py-3 text-sm font-black",
                  accountType === "create" && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => onAccountTypeChange("create")}
              >
                יצירת פרופיל חדש
              </button>
              <button
                type="button"
                className={cx(
                  "rounded-xl px-4 py-3 text-sm font-black",
                  accountType === "join" && "bg-white text-blue-700 shadow-sm",
                )}
                onClick={() => onAccountTypeChange("join")}
              >
                הצטרפות עם קוד
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          className="mb-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-black shadow-sm"
          onClick={pressGoogle}
          disabled={isLoading}
        >
          {/* The standard multicolor Google "G", as Google's sign-in branding asks. */}
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          {googleBusy ? "פותח את Google..." : "התחברות עם Google"}
        </button>
        <div className="mb-3 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-black text-slate-600">אימייל</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={parentEmail}
              onChange={(event) => onParentEmailChange(event.target.value)}
              placeholder="האימייל שלך"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-black text-slate-600">
              {authMode === "parent" ? "שם ההורה" : "שם המורה"}
            </span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              autoComplete="name"
              value={parentName}
              onChange={(event) => onParentNameChange(event.target.value)}
              placeholder="השם שלך"
            />
          </label>
          {accountType === "create" ? (
            <label className="grid gap-1">
              <span className="text-sm font-black text-slate-600">שם הילד</span>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={childName}
                onChange={(event) => onChildNameChange(event.target.value)}
                placeholder="שם הילד"
              />
            </label>
          ) : (
            <label className="grid gap-1">
              <span className="text-sm font-black text-slate-600">קוד הילד/ה</span>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                dir="ltr"
                value={childAccessCode}
                onChange={(event) => onChildAccessCodeChange(event.target.value)}
                placeholder="הקלידו כאן את הקוד שקיבלתם"
              />
            </label>
          )}
        </div>
        <label className="grid gap-1">
          <span className="text-sm font-black text-slate-600">סיסמת החשבון</span>
          <input
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
            }}
            placeholder="לפחות 6 תווים"
          />
        </label>
        {supabaseReady && (
          <button
            type="button"
            className="mt-1 text-sm font-black text-blue-700 underline"
            onClick={onForgotPassword}
          >
            שכחתי סיסמה
          </button>
        )}
        {authMessage && (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
            {authMessage}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            className="w-full rounded-2xl bg-blue-500 px-5 py-3 font-bold text-white"
            onClick={onSubmit}
            disabled={isLoading}
          >
            {formBusy
              ? "מתחבר..."
              : supabaseReady
                ? accountType === "create"
                  ? "הרשמה"
                  : "הרשמה והצטרפות"
                : "כניסה מקומית"}
          </button>
          <div className="flex flex-wrap justify-end gap-3">
            {!supabaseReady && accountType === "create" && (
              <button
                type="button"
                className="mr-auto rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-800"
                onClick={onQuickEntry}
              >
                כניסה מקומית בלי שדות
              </button>
            )}
            <button
              type="button"
              className="rounded-2xl border border-slate-200 px-5 py-3 font-bold"
              onClick={onCancel}
            >
              ביטול
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

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
      <div className="flex min-w-0 flex-1 gap-1.5">
        {showNameCell && childName ? (
          <div className="flex min-w-[5rem] shrink-0 flex-col items-center justify-center rounded-xl border-[3px] border-slate-900 bg-violet-200 px-2 py-1 text-center font-black shadow-sm sm:min-w-[6rem]">
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
            className="min-w-0 flex-1 border-[3px] border-transparent p-1 sm:p-1.5"
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

function KeshetHomeView({
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

function CategoryView({
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

function KeyboardView({
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

function ChildEventsView({
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

// How long a child who tapped "start" waits for an AI story still on its way.
const STORY_MAX_WAIT_MS = 15000;

async function loadAiStory(avoidTitles: string[]): Promise<Story | null> {
  try {
    const response = await fetch("/api/story-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avoidTitles }),
      // A bit over the server's worst case (Gemini racing OpenAI, then Groq),
      // so a slow-but-working AI still delivers. Stories are fetched ahead of
      // time, so the child rarely waits for this.
      signal: AbortSignal.timeout(35000),
    });
    const data = (await readJsonResponse(response)) as { story?: unknown };
    return data.story ? parseStory(data.story) : null;
  } catch {
    return null;
  }
}

function StoryGameView({
  onBack,
  onSpeak,
  onStoryFinished,
}: {
  onBack: () => void;
  onSpeak: (text: string, onEnd?: () => void) => void;
  onStoryFinished: (result: StoryResult) => void;
}) {
  // Per-story tally for the progress page: right word on the first tap, and
  // how many wrong words were tapped along the way.
  const tallyRef = useRef({ title: "", firstTry: 0, wrongTaps: 0, answered: 0, reported: false });
  const onStoryFinishedRef = useRef(onStoryFinished);
  onStoryFinishedRef.current = onStoryFinished;

  // A story the child left in the middle still counts for the day, with the
  // words they got to.
  const reportPartial = (): void => {
    const tally = tallyRef.current;
    if (tally.reported || tally.answered === 0) return;
    tally.reported = true;
    onStoryFinishedRef.current({
      date: today(),
      title: tally.title,
      steps: tally.answered,
      firstTry: tally.firstTry,
      wrongTaps: tally.wrongTaps,
      partial: true,
    });
  };
  useEffect(() => () => reportPartial(), []);
  const [story, setStory] = useState<Story>(() => pickLocalStory());
  const [stepIndex, setStepIndex] = useState(0);
  // True once the current step's word was picked, while its full sentence is read.
  const [stepAnswered, setStepAnswered] = useState(false);
  // Whether the child picked a wrong word on this step before the right one.
  const [stepHadMistake, setStepHadMistake] = useState(false);
  const [choices, setChoices] = useState<StoryChoice[]>([]);
  const [narrating, setNarrating] = useState(false);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [playedTitles, setPlayedTitles] = useState<string[]>([]);
  // The story starts only when the child taps "start".
  const [started, setStarted] = useState(false);
  // The next AI story, asked for ahead of time: when the screen opens, and
  // again as each story starts, so "start" and "new story" rarely wait.
  const upcomingStoryRef = useRef<Promise<Story | null> | null>(null);
  useEffect(() => {
    upcomingStoryRef.current = loadAiStory([]);
  }, []);
  // Waits at most `maxWaitMs` for the story fetched ahead of time. One that is
  // still on its way stays for the next "new story" instead of being lost.
  const takeUpcomingStory = async (maxWaitMs: number): Promise<Story | null> => {
    const upcoming = upcomingStoryRef.current;
    upcomingStoryRef.current = null;
    if (!upcoming) return null;
    const timedOut = Symbol("timed out");
    const result = await Promise.race([
      upcoming,
      new Promise<typeof timedOut>((resolve) => window.setTimeout(() => resolve(timedOut), maxWaitMs)),
    ]);
    if (result !== timedOut) return result;
    upcomingStoryRef.current ??= upcoming;
    return null;
  };

  const playStep = (index: number, current: Story): void => {
    const step = current.steps[index];
    setStepAnswered(false);
    setStepHadMistake(false);
    if (!step) {
      setStepIndex(current.steps.length);
      setNarrating(false);
      setFinished(true);
      if (!tallyRef.current.reported) {
        tallyRef.current.reported = true;
        onStoryFinished({
          date: today(),
          title: current.title,
          steps: current.steps.length,
          firstTry: tallyRef.current.firstTry,
          wrongTaps: tallyRef.current.wrongTaps,
        });
      }
      window.setTimeout(() => onSpeak(STORY_ENDING_LINE), 300);
      return;
    }
    setStepIndex(index);
    setChoices(storyStepChoices(step));
    setFeedback("");
    setNarrating(true);
    onSpeak(step.before, () => setNarrating(false));
  };

  const startStory = (next: Story): void => {
    reportPartial();
    setStory(next);
    tallyRef.current = { title: next.title, firstTry: 0, wrongTaps: 0, answered: 0, reported: false };
    setStepIndex(0);
    setStepAnswered(false);
    setFinished(false);
    setFeedback("");
    setPlayedTitles((current) => [...current, next.title].slice(-10));
    upcomingStoryRef.current = loadAiStory([...playedTitles, next.title].slice(-10));
    // Title first, then the first sentence.
    setNarrating(true);
    onSpeak(next.title, () => playStep(0, next));
  };


  const handlePick = (choice: StoryChoice): void => {
    if (narrating || finished || stepAnswered) return;
    const step = story.steps[stepIndex];
    if (!step) return;

    if (choice.kind !== "correct") {
      tallyRef.current.wrongTaps += 1;
      setStepHadMistake(true);
      setFeedback(STORY_FEEDBACK.wrong);
      onSpeak(STORY_FEEDBACK.wrong);
      return;
    }

    if (!stepHadMistake) tallyRef.current.firstTry += 1;
    tallyRef.current.answered += 1;
    setFeedback(STORY_FEEDBACK.correct);
    setStepAnswered(true);
    setNarrating(true);
    // Right on the first try: just continue the sentence the child already
    // heard. After a mistake (and the "try again" message in between), read
    // the whole corrected sentence so it's heard together.
    const toRead = stepHadMistake ? storyStepSentence(step) : storyStepContinuation(step);
    onSpeak(toRead, () => playStep(stepIndex + 1, story));
  };

  // One "new story" button: a fresh AI-written story when the AI answers,
  // otherwise (offline, blocked, slow) one of the ready-made stories.
  // The story fetched ahead of time (usually ready by now); if that one
  // failed, one fresh try. Nothing in time → a ready-made story.
  const startNextStory = async (): Promise<void> => {
    setIsLoadingNext(true);
    let next = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    // Only when the early one failed (not when it's merely slow).
    if (!next && !upcomingStoryRef.current) {
      upcomingStoryRef.current = loadAiStory(playedTitles);
      next = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    }
    setIsLoadingNext(false);
    startStory(next ?? pickLocalStory(story.id));
  };

  // The first story: the AI one asked for when the screen opened (waiting a
  // little if it's still on its way), else a ready-made one.
  const startFirstStory = async (): Promise<void> => {
    setIsLoadingNext(true);
    const first = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    setIsLoadingNext(false);
    setStarted(true);
    startStory(first ?? story);
  };

  // Completed steps show their full sentence; the current one shows the
  // blank; later steps stay hidden so the story unfolds as it's told.
  const completedSteps = finished ? story.steps.length : stepIndex + (stepAnswered ? 1 : 0);
  const currentStep = !finished && !stepAnswered ? story.steps[stepIndex] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <div>
          <h2 className="text-3xl font-black">📖 בואו נספר סיפור</h2>
          <p className="text-muted">הקשיבו לסיפור, ובכל פעם שחסרה מילה בחרו את המילה שממשיכה אותו.</p>
        </div>
      </div>

      {!started ? (
        <div className="grid flex-1 place-items-center">
          <button
            type="button"
            className="flex flex-col items-center gap-3 rounded-[2rem] bg-gradient-to-br from-rose-400 to-orange-400 px-16 py-10 text-white shadow-soft transition active:scale-95 disabled:opacity-80"
            disabled={isLoadingNext}
            onClick={() => void startFirstStory()}
          >
            <span className="text-7xl">{isLoadingNext ? "📖" : "▶️"}</span>
            <span className="text-3xl font-black">{isLoadingNext ? "מכינים סיפור..." : "מתחילים סיפור"}</span>
          </button>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-2xl font-black">
            {story.emoji} {story.title}
          </h3>
          <div className="space-y-2 text-xl font-black leading-relaxed">
            {story.steps.slice(0, completedSteps).map((step, index) => (
              <p key={`${story.id}-${index}`}>
                <span className="ml-2">{step.answer.emoji}</span>
                {storyStepSentence(step)}
              </p>
            ))}
            {currentStep && (
              <p className="text-slate-700">
                {currentStep.before} <span className="text-blue-500 underline">____</span>{" "}
                {currentStep.after}
              </p>
            )}
            {finished && <p className="pt-2 text-blue-700">{STORY_ENDING_LINE}</p>}
          </div>
          {!finished && (
            <p className="mt-3 text-sm font-bold text-muted">
              שלב {Math.min(stepIndex + 1, story.steps.length)} מתוך {story.steps.length}
            </p>
          )}
        </div>

        {finished ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoadingNext}
              className="rounded-2xl bg-blue-600 px-6 py-4 text-xl font-black text-white disabled:opacity-60"
              onClick={() => void startNextStory()}
            >
              {isLoadingNext ? "📖 מכינים סיפור חדש..." : "🔄 סיפור חדש"}
            </button>
          </div>
        ) : narrating || !currentStep ? (
          <p className="text-lg font-black text-muted">🔊 מקריא/ה את הסיפור...</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {choices.map((choice) => (
                <button
                  key={`${stepIndex}-${choice.word.label}`}
                  type="button"
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-soft border border-slate-200 bg-white p-5 shadow-sm transition active:scale-95"
                  onClick={() => handlePick(choice)}
                >
                  <span className="text-5xl">{choice.word.emoji}</span>
                  <span className="text-xl font-black">{choice.word.label}</span>
                </button>
              ))}
            </div>
            {feedback ? (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-lg font-black text-amber-950">
                {feedback}
              </p>
            ) : null}
          </>
        )}
      </div>
      )}
    </div>
  );
}

function VoiceAssistantView({
  onBack,
  onSpeak,
  speechRate,
  childGender,
}: {
  onBack: () => void;
  onSpeak: (text: string) => void;
  speechRate: number;
  childGender: "boy" | "girl";
}) {
  const welcome = `שלום, אני כאן כדי לדבר איתך. מה ${childGender === "girl" ? "תרצי" : "תרצה"} לספר לי?`;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: welcome,
    },
  ]);
  const [answer, setAnswer] = useState(welcome);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  // The recording is on its way to text: shown on screen, so the wait doesn't
  // look like nothing happened.
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Status notes ("מצב בסיסי…", mic problems) are not shown to the child —
  // they only go to the developer console.
  const setSpeechHint = (note: string): void => {
    if (note) console.info("smartaac:", note);
  };
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Live microphone level (0–1) while recording, so the user sees whether the
  // mic actually hears them — a silent mic is why recordings came back "תודה".
  const [micLevel, setMicLevel] = useState(0);
  const [micSilent, setMicSilent] = useState(false);
  const meterStopRef = useRef<(() => void) | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const openAiSpeechBlockedRef = useRef(false);

  const speakReply = async (rawText: string): Promise<void> => {
    const text = stripEmoji(rawText);
    if (!text) return;

    if (!openAiSpeechBlockedRef.current) {
      try {
        const response = await fetch("/api/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          // the child shouldn't wait in silence: past this, the browser voice speaks
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          window.speechSynthesis.cancel();
          replyAudioRef.current?.pause();
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          replyAudioRef.current = audio;
          audio.onended = () => URL.revokeObjectURL(url);
          try {
            await audio.play();
            return;
          } catch {
            URL.revokeObjectURL(url);
          }
        }

        // Out of credit or unreachable: the next replies go straight to the
        // browser voice instead of waiting for the same failure.
        openAiSpeechBlockedRef.current = true;
      } catch {
        openAiSpeechBlockedRef.current = true;
      }
    }

    speakHebrew(text, speechRate);
  };

  const appendAssistantMessage = (content: string): void => {
    setAnswer(content);
    setMessages((current) => [
      ...current,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content,
      },
    ]);
    void speakReply(content);
  };

  const answerChild = async (text: string): Promise<void> => {
    const cleanText = text.trim();
    if (!cleanText) {
      const emptyAnswer = "אפשר לכתוב לי משפט קצר, ואני אמשיך איתך את השיחה.";
      setAnswer(emptyAnswer);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-empty-${Date.now()}`,
          role: "assistant",
          content: emptyAnswer,
        },
      ]);
      void speakReply(emptyAnswer);
      return;
    }

    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: cleanText,
    };
    const historyForRequest = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    setMessages((current) => [...current, userMessage]);
    setMessage("");
    setIsThinking(true);

    try {
      const response = await fetch("/api/child-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: cleanText,
          history: historyForRequest,
          gender: childGender,
        }),
      });
      const data = response.ok ? ((await response.json()) as ChildAiResponse) : {};
      if (data.provider === "local") {
        const hint = data.error ? aiApiErrorMessage(data.error) : "";
        setSpeechHint(
          hint ||
            "מצב בסיסי: AI בענן לא זמין. התשובות מוגבלות — נס/י Ollama מקומי או מפתח Groq/Gemini.",
        );
      } else if (data.error) {
        const hint = aiApiErrorMessage(data.error);
        if (hint) setSpeechHint(hint);
      } else {
        setSpeechHint("");
      }
      const nextAnswer =
        data.answer?.trim() || buildLocalChildAiAnswer(cleanText, [...messages, userMessage], childGender);
      const assistantMessage: AiChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: nextAnswer,
      };

      setMessages((current) => [...current, assistantMessage]);
      setAnswer(nextAnswer);
      void speakReply(nextAnswer);
    } catch {
      const fallback = buildLocalChildAiAnswer(cleanText, [...messages, userMessage], childGender);
      const assistantMessage: AiChatMessage = {
        id: `assistant-fallback-${Date.now()}`,
        role: "assistant",
        content: fallback,
      };
      setMessages((current) => [...current, assistantMessage]);
      setAnswer(fallback);
      void speakReply(fallback);
    } finally {
      setIsThinking(false);
    }
  };

  const stopRecording = (): void => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const startBrowserSpeechRecognition = (): boolean => {
    const recognition = getSpeechRecognition();
    if (!recognition) return false;

    recognition.onresult = (event) => {
      const transcript = pickBestTranscript(event.results);
      if (!transcript) return;

      setMessage(transcript);
      setSpeechHint("בדק/י את הטקסט, תקנ/י אם צריך, ולחצ/י שלח.");
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      if (event.error === "no-speech") {
        setSpeechHint("לא שמעתי דיבור. דבר/י קרוב יותר למיקרופון ונס/י שוב.");
        return;
      }
      setSpeechHint("זיהוי דיבור בדפדפן נכשל. נס/י שוב או כתב/י את המשפט.");
    };

    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setIsRecording(false);
    };

    try {
      speechRecognitionRef.current = recognition;
      recordingStartedAtRef.current = Date.now();
      recognition.start();
      return true;
    } catch {
      speechRecognitionRef.current = null;
      return false;
    }
  };

  const startRecording = async (): Promise<void> => {
    if (isRecording || isThinking || isTranscribing) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSpeechHint("הדפדפן לא תומך בהקלטת דיבור");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 44100 },
        },
      });
      micStreamRef.current = stream;
      audioChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();

      try {
        const meterContext = new AudioContext();
        const analyser = meterContext.createAnalyser();
        analyser.fftSize = 1024;
        meterContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let loudest = 0;
        let frame = 0;
        const startedAt = Date.now();
        const tick = (): void => {
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
          loudest = Math.max(loudest, peak);
          setMicLevel(Math.min(1, peak * 4));
          // after 2.5 s with nothing above a whisper, warn while still recording
          setMicSilent(Date.now() - startedAt > 2500 && loudest < SILENCE_PEAK);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        meterStopRef.current = () => {
          cancelAnimationFrame(frame);
          void meterContext.close();
          setMicLevel(0);
        };
      } catch {
        // no meter — recording still works
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        meterStopRef.current?.();
        meterStopRef.current = null;
        setMicSilent(false);
        micStreamRef.current?.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);

        const recordingMs = Date.now() - recordingStartedAtRef.current;
        if (recordingMs < MIN_RECORDING_MS) {
          setSpeechHint("ההקלטה קצרה מדי. לחצ/י שוב ודבר/י לפחות שנייה.");
          return;
        }

        setSpeechHint("מעבד את הדיבור...");

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (blob.size === 0) {
          setSpeechHint("לא נקלט דיבור. לחצ/י שוב על התחלת דיבור ודבר/י.");
          return;
        }

        setIsTranscribing(true);
        void (async () => {
          try {
            let uploadBlob: Blob = blob;
            let fileName = `speech.${audioExtensionForMime(mimeType)}`;
            let recordingPeak: number | null = null;

            try {
              const converted = await recordingToWavBlob(blob);
              if (converted.peak < SILENCE_PEAK) {
                // Don't send silence: the speech model would invent words for it.
                setSpeechHint(
                  "לא שמעתי קול בהקלטה. דבר/י קרוב יותר, ובדק/י שבחרת את המיקרופון הנכון (סמל המנעול ליד כתובת האתר).",
                );
                return;
              }
              uploadBlob = converted.wav;
              fileName = "speech.wav";
              recordingPeak = converted.peak;
            } catch {
              // keep original recording for cloud fallbacks
            }

            const formData = new FormData();
            formData.append("audio", uploadBlob, fileName);
            if (recordingPeak !== null) formData.append("peak", String(recordingPeak));

            const response = await fetch("/api/speech-to-text", {
              method: "POST",
              body: formData,
            });
            const data = (await response.json()) as {
              text?: string;
              error?: string;
              detail?: string;
            };

            if (!response.ok || !data.text?.trim()) {
              const combined = `${data.error ?? ""} ${data.detail ?? ""}`;
              if (isOpenAiQuotaError(combined)) {
                setSpeechHint(`${openAiQuotaMessage}, ורעננ/י את הדף. אפשר גם לכתוב את המשפט.`);
                return;
              }
              setSpeechHint(speechApiErrorMessage(data.error, data.detail));
              return;
            }

            setMessage(data.text);
            setSpeechHint("בדק/י את הטקסט, תקנ/י אם צריך, ולחצ/י שלח.");
          } catch {
            setSpeechHint("שגיאה בשליחת הדיבור. נס/י לכתוב וללחוץ שלח.");
          } finally {
            setIsTranscribing(false);
          }
        })();
      };

      recorder.start(250);
      setIsRecording(true);
      setSpeechHint("מקליט... דבר/י, ואז לחצ/י סיום דיבור");
    } catch {
      setSpeechHint("מיקרופון לא מאושר");
    }
  };

  const toggleSpeech = (): void => {
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  };


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
          <h2 className="text-3xl font-black">🗣️ שיחה חכמה</h2>
          <p className="text-muted">
            הילד מדבר או כותב, והמערכת עונה בקול בשפה פשוטה.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-3 rounded-[1.5rem] bg-slate-50 p-4">
            {messages.map((item) => (
              <div
                key={item.id}
                className={cx(
                  "max-w-[88%] rounded-2xl px-4 py-3 text-lg font-bold leading-8 shadow-sm",
                  item.role === "user"
                    ? "mr-auto bg-blue-600 text-white"
                    : "ml-auto bg-white text-slate-900",
                )}
              >
                <span className="mb-1 block text-xs font-black opacity-70">
                  {item.role === "user" ? "אני" : "החבר החכם"}
                </span>
                {item.content}
              </div>
            ))}
            {isThinking && (
              <div className="ml-auto flex max-w-[88%] items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm">
                <span className="text-xl">🤔</span>
                <span className="flex gap-1">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            )}
          </div>

          <label className="mb-2 block text-sm font-black text-muted">
            המשך שיחה
          </label>
          <div className="relative">
            <textarea
              className="min-h-36 w-full rounded-2xl border border-slate-200 p-4 text-xl"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={isTranscribing ? "" : "אפשר לכתוב כאן או להקליט במיקרופון"}
              disabled={isTranscribing}
            />
            {isTranscribing && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-xl font-black text-slate-500">
                <span>✍️ כותב את מה שאמרת</span>
                <span className="flex gap-1">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={cx("rounded-2xl px-6 py-4 text-lg font-black text-white shadow-soft disabled:opacity-60", isRecording ? "bg-red-500" : "bg-emerald-500")}
              onClick={toggleSpeech}
              disabled={isThinking || isTranscribing}
            >
              {isRecording ? "⏹ סיום דיבור" : "🎤 התחלת דיבור"}
            </button>
            {isRecording && (
              <div className="flex min-w-40 flex-col justify-center gap-1" aria-label="עוצמת המיקרופון">
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cx("h-full rounded-full transition-[width]", micSilent ? "bg-red-400" : "bg-emerald-500")}
                    style={{ width: `${Math.max(4, Math.round(micLevel * 100))}%` }}
                  />
                </div>
                <span className={cx("text-xs font-bold", micSilent ? "text-red-700" : "text-muted")}>
                  {micSilent ? "המיקרופון לא קולט קול" : "המיקרופון שומע אותך"}
                </span>
              </div>
            )}
            <button
              type="button"
              className="rounded-2xl bg-blue-500 px-6 py-4 text-lg font-black text-white shadow-soft disabled:opacity-60"
              onClick={() => {
                void answerChild(message);
              }}
              disabled={isThinking || isTranscribing}
            >
              {isThinking ? "🤔 חושב..." : "📤 שלח"}
            </button>
          </div>
          <div className="mt-4 flex gap-1.5">
            {[
              { text: "אני רוצה מים", symbolIds: ["i", "want", "water"] },
              { text: `אני ${genderWord("עייף", childGender)}`, symbolIds: ["i", "tired"] },
              { text: "קשה לי", symbolIds: ["i", "help"] },
              { text: "אני רוצה לשחק", symbolIds: ["i", "want", "play"] },
            ].map((starter) => (
              // Pictures first, so a child who can't read can pick one.
              <button
                key={starter.text}
                type="button"
                className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl border-2 border-slate-200 bg-white px-1 py-1.5 shadow-sm transition active:scale-95"
                onClick={() => {
                  setMessage(starter.text);
                  void answerChild(starter.text);
                }}
                aria-label={starter.text}
              >
                <span className="flex items-end gap-0.5" aria-hidden>
                  {starter.symbolIds.map((symbolId) => {
                    const symbol = symbols.find((item) => item.id === symbolId);
                    return symbol?.pictogramId ? (
                      <img
                        key={symbolId}
                        src={arasaacImageUrl(symbol.pictogramId)}
                        alt=""
                        className="h-7 w-7 rounded object-contain sm:h-8 sm:w-8"
                      />
                    ) : (
                      <span key={symbolId} className="text-2xl leading-8">
                        {symbol?.emoji}
                      </span>
                    );
                  })}
                </span>
                <span className="truncate text-[11px] font-bold text-slate-500">{starter.text}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
          <h3 className="mb-3 text-xl font-black">התשובה האחרונה</h3>
          <p className="rounded-2xl bg-white p-5 text-2xl font-black leading-10 shadow-sm">
            {answer}
          </p>
          <button
            type="button"
            className="mt-4 rounded-2xl bg-slate-950 px-6 py-4 font-black text-white"
            onClick={() => { void speakReply(answer); }}
          >
            🔊 הקרא שוב
          </button>
          <button
            type="button"
            className="mt-3 block rounded-2xl bg-white px-6 py-4 font-black text-slate-900 shadow-sm"
            onClick={() => {
              setMessages([
                {
                  id: `welcome-${Date.now()}`,
                  role: "assistant",
                  content: "פתחתי שיחה חדשה. על מה תרצי לדבר?",
                },
              ]);
              setAnswer("פתחתי שיחה חדשה. על מה תרצי לדבר?");
              setMessage("");
            }}
          >
            שיחה חדשה
          </button>
        </section>
      </div>
    </div>
  );
}

function SymbolTile({
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
function CategoryIcon({
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

const customCategoryColors = (categoryId: string) => {
  const hash = [...categoryId].reduce((total, char) => total + char.charCodeAt(0), 0);
  return customCategoryPalette[hash % customCategoryPalette.length];
};

const customCategoryLabelColor = (categoryId: string): string =>
  customCategoryColors(categoryId).label;

function symbolBackground(symbol: AacSymbol): string {
  if (symbol.categoryId === "core") {
    return symbol.wordType ? wordTypeColors[symbol.wordType] : "border-amber-400 bg-amber-100";
  }
  return categoryTileColors[symbol.categoryId] ?? customCategoryColors(symbol.categoryId).tile;
}

const openTeacherInviteMail = (input: {
  teacherEmail: string;
  teacherInviteCode: string;
  childName: string;
  parentName: string;
  inviteeRole?: "parent" | "teacher";
}): void => {
  const { mailtoUrl } = buildTeacherInviteContent({
    ...input,
    appOrigin: window.location.origin,
  });
  window.location.href = mailtoUrl;
};


function Dashboard({
  view,
  state,
  activeTopic,
  allSymbols,
  allCategories,
  allSymbolById,
  onViewChange,
  onStateChange,
  onRotateTeacherCode,
  onSendTeacherInvite,
  teacherEmail,
  onTeacherEmailChange,
  inviteMessage,
  onActiveChildNameChange,
  isChildDevice,
  onChildDeviceChange,
  onAddEvent,
  onDeleteEvent,
  holidayEvents,
  onClose,
}: {
  view: DashboardView;
  state: DemoState;
  activeTopic: { id: string; label: string; emoji: string } | undefined;
  allSymbols: AacSymbol[];
  allCategories: Array<{ id: string; label: string; emoji: string; pictogramId?: number }>;
  allSymbolById: Record<string, AacSymbol>;
  onViewChange: (view: DashboardView) => void;
  onStateChange: (state: DemoState) => void;
  onRotateTeacherCode: () => Promise<string | null>;
  onSendTeacherInvite: (email: string, inviteeRole: "parent" | "teacher") => Promise<string>;
  teacherEmail: string;
  onTeacherEmailChange: (value: string) => void;
  inviteMessage: string;
  onActiveChildNameChange: (name: string) => Promise<void>;
  isChildDevice: boolean;
  onChildDeviceChange: (enabled: boolean) => void;
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (eventId: string) => void;
  holidayEvents: CalendarEvent[];
  onClose: () => void;
}) {
  const [codeMessage, setCodeMessage] = useState("");
  const [childPhotoError, setChildPhotoError] = useState("");
  const [isRotatingCode, setIsRotatingCode] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteeRole, setInviteeRole] = useState<"parent" | "teacher">(
    state.dashboardRole === "teacher" ? "parent" : "teacher",
  );
  const inviteeLabel = inviteeRole === "teacher" ? "מורה" : "הורה";
  // progress from all of the child's devices together
  const combined = withCombinedUsage(state);
  const averageLength =
    combined.sentenceLengths.length === 0
      ? "0.0"
      : (
          combined.sentenceLengths.reduce((total, value) => total + value, 0) /
          combined.sentenceLengths.length
        ).toFixed(1);
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const eventsTomorrow = state.events.filter((event) => event.date === localIsoDate(tomorrowDate));

  const update = (updater: (current: DemoState) => DemoState): void => {
    onStateChange(updater(state));
  };

  return (
    <main className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l border-slate-200 bg-white p-4">
        <div className="mb-4 px-2 text-2xl font-black">🧩 SmartAAC</div>
        {[
          ["overview", "📊", "סקירה"],
          ["events", "📅", "אירועים ולוח שנה"],
          ["topic", "📚", "נושא שבועי והגדרות"],
          ["symbols", "🔣", "סמלים"],
          ["daily", "📸", "מה עשינו היום"],
          ["print", "🖨️", "הדפסת סמלים"],
          ["library", "🌍", "ספרייה משותפת"],
          ["progress", "📈", "התקדמות"],
        ].map(([id, emoji, label]) => (
          <button
            key={id}
            type="button"
            className={cx(
              "flex items-center gap-3 rounded-2xl px-4 py-3 text-right font-black text-muted",
              view === id && "bg-blue-50 text-blue-600",
            )}
            onClick={() => onViewChange(id as DashboardView)}
          >
            <span>{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button type="button" className="rounded-2xl bg-blue-500 px-4 py-3 font-black text-white" onClick={onClose}>
          🏠 חזרה לדף הבית
        </button>
        <p className="px-2 text-[10px] leading-4 text-muted">
          סמלי התקשורת: ARASAAC (arasaac.org), מאת Sergio Palao, בבעלות ממשלת
          אראגון, ברישיון CC BY-NC-SA.
        </p>
      </aside>

      <section className="flex-1 overflow-auto p-8">
        {view === "overview" && (
          <section className="font-rubik">
            {/* hero: who the dashboard is about */}
            <div className="relative mb-5 overflow-hidden rounded-[2rem] bg-gradient-to-l from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-soft">
              <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden />
              <div className="absolute -bottom-12 left-24 h-32 w-32 rounded-full bg-white/10" aria-hidden />
              <div className="relative flex flex-wrap items-center gap-5">
                <div className="flex flex-col items-center gap-1">
                  <label
                    className="relative grid h-20 w-20 cursor-pointer place-items-center rounded-full bg-white/20 text-5xl shadow-inner"
                    title="העלאת תמונה של הילד/ה"
                  >
                    {state.symbolImages[CHILD_PHOTO_KEY] ? (
                      <img
                        src={state.symbolImages[CHILD_PHOTO_KEY]}
                        alt={state.activeChildName || "הילד/ה"}
                        className="h-20 w-20 rounded-full border-2 border-white object-cover"
                      />
                    ) : (
                      <span>{state.childGender === "girl" ? "👧" : "👦"}</span>
                    )}
                    <span className="absolute -bottom-1 -left-1 grid h-8 w-8 place-items-center rounded-full bg-white text-base shadow">
                      📷
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (!file.type.startsWith("image/")) {
                          setChildPhotoError("בחר/י קובץ תמונה בלבד.");
                          return;
                        }
                        if (file.size > MAX_FAMILY_PHOTO_BYTES) {
                          setChildPhotoError("התמונה גדולה מדי. עד 8MB.");
                          return;
                        }
                        void prepareFamilyPhoto(file)
                          .then((dataUrl) => {
                            update((current) => ({
                              ...current,
                              symbolImages: { ...current.symbolImages, [CHILD_PHOTO_KEY]: dataUrl },
                            }));
                            setChildPhotoError("");
                          })
                          .catch(() => setChildPhotoError("לא הצלחנו לטעון את התמונה."));
                      }}
                    />
                  </label>
                  {state.symbolImages[CHILD_PHOTO_KEY] ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-blue-100 underline"
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          symbolImages: Object.fromEntries(
                            Object.entries(current.symbolImages).filter(([key]) => key !== CHILD_PHOTO_KEY),
                          ),
                        }))
                      }
                    >
                      הסרת תמונה
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-blue-100">הוספת תמונה</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-blue-100">
                    שלום {state.parentName || (state.dashboardRole === "teacher" ? "מורה" : "הורה")} ·{" "}
                    {new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
                  </p>
                  <h1 className="mt-1 text-4xl font-extrabold tracking-tight">
                    <span className="text-2xl font-medium text-blue-100">
                      {state.dashboardRole === "teacher" ? "המורה של " : "ההורה של "}
                    </span>
                    {state.activeChildName || "הילד/ה"}
                  </h1>
                  {childPhotoError && (
                    <p className="mt-2 inline-block rounded-xl bg-white/90 px-3 py-1 text-sm font-bold text-red-700">
                      {childPhotoError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {eventsTomorrow.map((event) => (
              <div
                key={`reminder-${event.id}`}
                className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 to-orange-50 p-4 font-medium text-amber-950 shadow-sm"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-200 text-2xl">🔔</span>
                <strong className="font-bold">
                  יש מחר {eventInfo(event).emoji} {event.title} ל{state.activeChildName || "הילד/ה"}
                </strong>
              </div>
            ))}

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[1.75rem] border border-blue-100 bg-white p-6 shadow-sm">
                <h2 className="flex items-center gap-2 text-xl font-bold">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-lg">👥</span>
                  צוות הילד/ה — הורים ומורים
                </h2>
                {(
                  <>
                    <p className="mt-2 text-muted">
                      {state.parentName || (state.dashboardRole === "teacher" ? "מורה" : "הורה")} ·{" "}
                      {state.parentEmail || "לא הוגדר אימייל"}
                    </p>
                    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
                      <span className="block text-sm font-black text-muted">
                        {state.dashboardRole === "teacher" ? "המורה של" : "ההורה של"}
                      </span>
                      <span className="mt-1 block text-3xl font-black">{state.activeChildName || "—"}</span>
                    </div>
                    <div
                      className={cx(
                        "mt-4 rounded-2xl p-4 shadow-sm",
                        state.pendingTeacherInvite ? "bg-amber-50 ring-2 ring-amber-200" : "bg-white",
                      )}
                    >
                      <span className="block text-sm font-black text-muted">
                        {state.pendingTeacherInvite
                          ? "כניסה ראשונה — הזמינ/י הורה או מורה"
                          : "הזמנת הורה או מורה"}
                      </span>
                      {state.pendingTeacherInvite && (
                        <p className="mt-2 text-sm leading-7 text-amber-900">
                          בחר/י את מי להזמין, הזינ/י אימייל ולחצ/י על הכפתור. המייל יכלול סיסמת גישה (קוד) וקישור לכניסה.
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                        {(["teacher", "parent"] as const).map((role) => (
                          <button
                            key={role}
                            type="button"
                            className={cx(
                              "rounded-xl px-3 py-2 text-sm font-black text-slate-600",
                              inviteeRole === role && "bg-white text-blue-700 shadow-sm",
                            )}
                            onClick={() => setInviteeRole(role)}
                          >
                            {role === "teacher" ? "להזמין מורה" : "להזמין הורה"}
                          </button>
                        ))}
                      </div>
                      <label className="mt-3 grid gap-1">
                        <span className="text-xs font-black text-slate-600">אימייל של ה{inviteeLabel}</span>
                        <input
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left"
                          type="email"
                          dir="ltr"
                          value={teacherEmail}
                          onChange={(event) => onTeacherEmailChange(event.target.value)}
                          placeholder={inviteeRole === "teacher" ? "teacher@school.com" : "parent@email.com"}
                        />
                      </label>
                    </div>
                    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
                      <span className="block text-sm font-black text-muted">
                        קוד הצטרפות לילד/ה
                      </span>
                      <span className="mt-1 block text-3xl font-black tracking-widest" dir="ltr">
                        {state.teacherInviteCode || "—"}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-muted">
                        שולחים את הקוד להורה או למורה שרוצים לצרף. צריך אותו רק בכניסה הראשונה — אחר כך נכנסים
                        עם מייל וסיסמה, וכולם רואים את אותן תמונות, הגדרות ואירועים.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mt-4 w-full rounded-2xl bg-emerald-600 px-5 py-3 font-black text-white disabled:opacity-60"
                      disabled={isSendingInvite || !teacherEmail.trim()}
                      onClick={() => {
                        setCodeMessage("");
                        setIsSendingInvite(true);
                        void onSendTeacherInvite(teacherEmail.trim(), inviteeRole)
                          .then((message) => setCodeMessage(message))
                          .catch((error: unknown) => {
                            setCodeMessage(
                              error instanceof Error ? error.message : "לא הצלחנו לשלוח את ההזמנה.",
                            );
                          })
                          .finally(() => {
                            setIsSendingInvite(false);
                          });
                      }}
                    >
                      {isSendingInvite ? "שולח..." : `שלח/י ל${inviteeLabel} מייל עם סיסמת הגישה`}
                    </button>
                    {state.isProfileCreator && (
                    <button
                      type="button"
                      className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60"
                      disabled={isRotatingCode}
                      onClick={() => {
                        if (!window.confirm("הקוד הנוכחי יפסיק לעבוד ויהיה קוד חדש במקומו. מי שכבר הצטרף ממשיך להיכנס כרגיל — רק מי שעוד לא הצטרף יצטרך את הקוד החדש. להמשיך?")) return;
                        setCodeMessage("");
                        setIsRotatingCode(true);
                        void onRotateTeacherCode()
                          .then((code) => {
                            if (code) {
                              setCodeMessage(`קוד חדש נשמר: ${code} — שלח/י אותו למי שתרצ/י להזמין.`);
                            }
                          })
                          .catch((error: unknown) => {
                            setCodeMessage(
                              error instanceof Error ? error.message : "לא הצלחנו ליצור קוד חדש.",
                            );
                          })
                          .finally(() => {
                            setIsRotatingCode(false);
                          });
                      }}
                    >
                      {isRotatingCode ? "יוצר קוד..." : "🔄 החלפת הקוד (אם הגיע למישהו בטעות)"}
                    </button>
                    )}
                    {codeMessage && (
                      <p className="mt-3 rounded-2xl bg-white p-3 text-sm font-bold text-blue-900 shadow-sm">
                        {codeMessage}
                      </p>
                    )}
                    {inviteMessage && (
                      <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900 shadow-sm">
                        {inviteMessage}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-4">
                <div className="rounded-[1.75rem] bg-gradient-to-l from-violet-50 to-indigo-50 p-6 shadow-sm ring-1 ring-violet-100">
                  <h2 className="flex items-center gap-2 text-xl font-bold">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg">💡</span>
                    איך זה עובד?
                  </h2>
                  <p className="mt-2 leading-7 text-slate-700">
                    ההורים והמורים מגדירים אירועים, נושא שבועי ותמונות. הילד/ה רואה מסך תקשורת יציב,
                    עם סמלים שמתאימים למה שקורה בחיים שלו/ה.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <ChildDevicePanel
                enabled={isChildDevice}
                childName={state.activeChildName}
                onChange={onChildDeviceChange}
              />
            </div>
          </section>
        )}

        {view === "events" && (
          <EventsDashboard
            state={state}
            update={update}
            holidayEvents={holidayEvents}
            onAddEvent={onAddEvent}
            onDeleteEvent={onDeleteEvent}
          />
        )}
        {view === "topic" && (
          <div className="space-y-10">
            <TopicDashboard state={state} allSymbols={allSymbols} update={update} />
            <ChildSettingsDashboard state={state} update={update} />
          </div>
        )}
        {view === "symbols" && (
          <SymbolsDashboard
            state={state}
            allSymbols={allSymbols}
            allCategories={allCategories}
            update={update}
          />
        )}

        {view === "daily" && (
          <DailyStoryDashboard state={state} allSymbols={allSymbols} preparePhoto={prepareFamilyPhoto} />
        )}
        {view === "print" && (
          <PrintSymbolsDashboard
            allSymbols={allSymbols}
            allCategories={allCategories}
            symbolImages={state.symbolImages}
            hiddenSymbolIds={state.hiddenSymbolIds}
          />
        )}
        {view === "library" && (
          <SharedLibraryDashboard state={state} allSymbols={allSymbols} update={update} />
        )}
        {view === "progress" && (
          <ProgressDashboard
            state={combined}
            activeSymbolCount={allSymbols.length - state.hiddenSymbolIds.length}
            activeTopic={activeTopic}
            averageLength={averageLength}
            allSymbolById={allSymbolById}
            allCategories={allCategories}
          />
        )}
      </section>
    </main>
  );
}

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

function EventsCalendar({
  events,
  selectedDate,
  onPickDate,
  onDeleteEvent,
}: {
  events: CalendarEvent[];
  selectedDate: string;
  onPickDate: (date: string) => void;
  onDeleteEvent: (eventId: string) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() + monthOffset);
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmptyDays = firstDay.getDay();
  const monthLabel = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
  }).format(now);

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((grouped, event) => {
    grouped[event.date] = [...(grouped[event.date] ?? []), event];
    return grouped;
  }, {});

  const cells: Array<{ day: number | null; dateKey: string | null }> = [
    ...Array.from({ length: leadingEmptyDays }, () => ({ day: null, dateKey: null })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const dayNumber = index + 1;
      // Built from the numbers, not toISOString(): in Israel (UTC+2/3) local
      // midnight is the previous day in UTC, which shifted every event a day.
      return {
        day: dayNumber,
        dateKey: `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`,
      };
    }),
  ];

  return (
      <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <button
            type="button"
            className="rounded-full bg-slate-100 px-3 py-1 text-lg font-black"
            onClick={() => setMonthOffset((current) => current - 1)}
            aria-label="החודש הקודם"
          >
            →
          </button>
          <h2 className="text-2xl font-black">{monthLabel}</h2>
          <button
            type="button"
            className="rounded-full bg-slate-100 px-3 py-1 text-lg font-black"
            onClick={() => setMonthOffset((current) => current + 1)}
            aria-label="החודש הבא"
          >
            ←
          </button>
          <span className="mr-auto rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
            {events.length} אירועים
          </span>
        </div>
        <div className="mb-2 grid grid-cols-7 gap-2 text-center text-sm font-black text-muted">
          {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {cells.map((cell, index) => {
            const dayEvents = cell.dateKey ? eventsByDate[cell.dateKey] ?? [] : [];
            return (
              <div
                key={`${cell.dateKey ?? "empty"}-${index}`}
                className={cx(
                  "min-h-28 rounded-2xl border border-slate-100 bg-slate-50 p-2",
                  dayEvents.length > 0 && "bg-blue-50 ring-2 ring-blue-100",
                  cell.dateKey !== null && cell.dateKey === selectedDate && "border-blue-500 ring-2 ring-blue-300",
                  cell.dateKey !== null && "cursor-pointer",
                )}
                onClick={() => cell.dateKey && onPickDate(cell.dateKey)}
                title={cell.dateKey ? "בחירת התאריך לאירוע חדש" : undefined}
              >
                {cell.day && <div className="mb-2 font-black">{cell.day}</div>}
                <div className="space-y-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-bold"
                    >
                      <span className="truncate">
                        {eventInfo(event).emoji} {event.title}
                      </span>
                      {!event.id.startsWith("holiday-") && (
                      <button
                        type="button"
                        className="mr-auto rounded-full bg-red-50 px-1 text-red-700"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onDeleteEvent(event.id);
                        }}
                        aria-label={`מחק ${event.title}`}
                      >
                        ×
                      </button>
                      )}
                    </div>
                  ))}
                  {dayEvents.length > 2 && (
                    <div className="text-xs font-bold text-muted">+{dayEvents.length - 2}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
  );
}

function EventsDashboard({
  state,
  onAddEvent,
  onDeleteEvent: deleteEvent,
  update,
  holidayEvents,
}: {
  state: DemoState;
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (eventId: string) => void;
  update: (updater: (current: DemoState) => DemoState) => void;
  holidayEvents: CalendarEvent[];
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CalendarEvent["type"]>("trip");
  const [customLabel, setCustomLabel] = useState("");
  const [customEmoji, setCustomEmoji] = useState(EVENT_EMOJI_CHOICES[0] ?? "📌");
  const [date, setDate] = useState(today());
  const [formError, setFormError] = useState("");

  const addEvent = (): void => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("הזינ/י שם לאירוע.");
      return;
    }
    if (!date) {
      setFormError("בחר/י תאריך.");
      return;
    }

    if (type === "custom" && !customLabel.trim()) {
      setFormError("הזינ/י שם לסוג האירוע, למשל: רופא שיניים.");
      return;
    }

    onAddEvent(
      type === "custom"
        ? { title: trimmedTitle, type, date, customLabel: customLabel.trim(), customEmoji }
        : { title: trimmedTitle, type, date },
    );
    setTitle("");
    setFormError("");
  };

  return (
    <section>
      <h1 className="text-3xl font-black">אירועים ולוח שנה</h1>
      <p className="mb-6 text-muted">
        האירועים של {state.activeChildName || "הילד/ה"} בלבד. הם נשמרים לכל ילד בנפרד, ומשפיעים על
        המשפטים שמוצעים לו. לחיצה על יום בלוח בוחרת אותו לאירוע חדש.
      </p>

      <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-black">הוספת אירוע חדש</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {Object.entries(eventLabels).map(([id, item]) => (
            <button
              key={id}
              type="button"
            className={cx(
              "rounded-2xl border p-4 text-center font-black",
              type === id
                ? "border-blue-500 bg-blue-500 text-white ring-4 ring-blue-100"
                : "border-slate-200 bg-slate-50 text-slate-950",
            )}
              onClick={() => setType(id as CalendarEvent["type"])}
            >
              <span className="block text-3xl">{id === "custom" ? "➕" : item.emoji}</span>
              <span className="mt-2 block text-sm">{item.label}</span>
            </button>
          ))}
        </div>
        {type === "custom" && (
          <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <label className="grid gap-1">
              <span className="text-sm font-black">איזה סוג אירוע?</span>
              <input
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                value={customLabel}
                maxLength={30}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="למשל: רופא שיניים, חוג שחייה, הופעה"
              />
            </label>
            <span className="mt-3 block text-sm font-black">סמל לאירוע</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {EVENT_EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={cx(
                    "grid h-11 w-11 place-items-center rounded-xl border text-2xl",
                    customEmoji === emoji ? "border-blue-500 bg-white ring-2 ring-blue-300" : "border-slate-200 bg-white",
                  )}
                  onClick={() => setCustomEmoji(emoji)}
                  aria-label={`סמל ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <input
            className="rounded-2xl border border-slate-200 px-4 py-3"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="שם האירוע, למשל: טיול לגן החיות"
          />
          <input
            className="rounded-2xl border border-slate-200 px-4 py-3"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <button
            type="button"
            className="rounded-2xl bg-blue-500 px-5 py-3 font-black text-white"
            onClick={addEvent}
          >
            הוספה
          </button>
        </div>
        {formError && (
          <p className="mt-3 rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-800">
            {formError}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["היום", 0],
            ["מחר", 1],
            ["בעוד שבוע", 7],
          ].map(([label, offset]) => (
            <button
              key={label}
              type="button"
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-muted"
              onClick={() => {
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + Number(offset));
                setDate(localIsoDate(nextDate));
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="mb-3 flex items-center gap-2 font-bold">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={state.showHolidays !== false}
          onChange={(event) => update((current) => ({ ...current, showHolidays: event.target.checked }))}
        />
        להציג בלוח חגים ומועדים (מתעדכן אוטומטית פעם ביום)
      </label>
      <EventsCalendar
        events={[...state.events, ...holidayEvents]}
        selectedDate={date}
        onPickDate={setDate}
        onDeleteEvent={deleteEvent}
      />

      <h2 className="mb-3 text-xl font-black">כל האירועים</h2>
      {state.events.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-center font-bold text-muted">
          עוד אין אירועים. הוסיפו אירוע למעלה.
        </p>
      )}
      <div className="space-y-3">
        {[...state.events]
          .sort((left, right) => left.date.localeCompare(right.date))
          .map((event) => (
          <div key={event.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="text-3xl">{eventInfo(event).emoji}</span>
            <div className="flex-1">
              <div className="font-black">{event.title}</div>
              <div className="text-sm text-muted">
                {eventInfo(event).label} · {event.date}
              </div>
            </div>
            <button
              type="button"
              className="rounded-2xl bg-red-50 px-4 py-2 font-black text-red-700"
              onClick={() => deleteEvent(event.id)}
            >
              מחק
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

const TOPIC_EMOJI_CHOICES = ["⭐", "🌳", "🐶", "🚗", "🏖️", "❄️", "🕎", "🍎", "🎵", "⚽", "🧸", "🌈", "🦁", "🚌", "🩺", "🎉"];

function TopicDashboard({
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

  const customTopics = state.customTopics ?? [];
  const symbolById = Object.fromEntries(allSymbols.map((symbol) => [symbol.id, symbol])) as Record<
    string,
    AacSymbol
  >;
  const query = search.trim();
  const searchResults = allSymbols
    .filter((symbol) => !query || symbol.label.includes(query))
    .slice(0, 48);

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
    update((current) => ({
      ...current,
      customTopics: [...(current.customTopics ?? []), topic],
      weeklyTopicId: topic.id,
    }));
    setIsCreating(false);
    setLabel("");
    setPickedIds([]);
    setSearch("");
    setFormError("");
  };

  const deleteTopic = (topicId: string): void => {
    if (!window.confirm("למחוק את הנושא הזה?")) return;
    update((current) => ({
      ...current,
      customTopics: (current.customTopics ?? []).filter((topic) => topic.id !== topicId),
      weeklyTopicId: current.weeklyTopicId === topicId ? "feelings" : current.weeklyTopicId,
    }));
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
          />
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

// The child's own settings, shown under the weekly topic on the same page.
function ChildSettingsDashboard({
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

function SymbolsDashboard({
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

function ProgressDashboard({
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
