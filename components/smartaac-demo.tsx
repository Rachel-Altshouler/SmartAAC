"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AacSymbol,
  type CalendarEvent,
  type DemoState,
  type WeeklyTopic,
  arasaacImageUrl,
  getAllCategories,
  initialState,
  symbols,
  weeklyTopics,
} from "@/lib/demo-data";
import { getEventsThisWeek } from "@/lib/context-engine";
import { genderWord, localFixSentence } from "@/lib/hebrew-grammar";
import { emptyUsage, getDeviceId, pickUsage, splitServerUsage } from "@/lib/usage-stats";
import { ChildDailyStoryView, prefetchDailyStory } from "@/components/daily-story";
import { isChildDeviceEnabled, ParentPinModal } from "@/components/child-device";
import { buildTeacherInviteContent } from "@/lib/teacher-invite";
import { pathToScreen, screenToPath, type Screen } from "@/lib/screen-routes";
import { isSupabaseConfigured, supabase } from "@/lib/supabase-browser";
import {
  sanitizeTypedText,
  type DashboardView,
  readJsonResponse,
  type AccountType,
  today,
  cx,
  resolveSymbolImage,
  speakHebrew,
  type AuthMode,
} from "@/components/smartaac/shared";
import { VoiceAssistantView } from "@/components/smartaac/chat";
import { KeshetHomeView, CategoryView } from "@/components/smartaac/child-board";
import { ChildEventsView } from "@/components/smartaac/child-events";
import { Dashboard } from "@/components/smartaac/dashboard";
import { KeyboardView } from "@/components/smartaac/keyboard";
import { LoginModal } from "@/components/smartaac/login";
import { StoryGameView } from "@/components/smartaac/story-game";

type ChildView =
  | { type: "home" }
  | { type: "category"; categoryId: string }
  | { type: "keyboard" }
  | { type: "events" }
  | { type: "assistant" }
  | { type: "story" }
  | { type: "daily" };

const TYPED_TOKEN_PREFIX = "typed:";
const isTypedToken = (token: string): boolean => token.startsWith(TYPED_TOKEN_PREFIX);

const typedTokenLabel = (token: string): string => token.slice(TYPED_TOKEN_PREFIX.length);

const encodeTypedToken = (text: string): string => `${TYPED_TOKEN_PREFIX}${text}`;

const sentenceItemLabel = (
  token: string,
  byId: Record<string, AacSymbol>,
): string => (isTypedToken(token) ? typedTokenLabel(token) : (byId[token]?.label ?? ""));

const storageKey = "smartaac-next-demo";
const imagesStorageKey = "smartaac-next-demo-images";

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

const createLocalId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

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

  // ---- an address for every screen (lib/screen-routes.ts) ----
  // The screens themselves don't change: the address follows the open screen,
  // and an address (a link, refresh, back / forward) opens its screen. The
  // dashboard still needs sign-in (or the child device's PIN) — an address
  // never opens it by itself.
  const currentScreen: Screen = isDashboardOpen
    ? { kind: "dashboard", view: dashboardView }
    : isEntryOpen
      ? { kind: "entry" }
      : { kind: "child", view: childView };
  const currentPath = screenToPath(currentScreen);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const routeReadyRef = useRef(false);
  // Open during this visit (signed in / PIN) — closed again on leaving it.
  const dashboardUnlockedRef = useRef(false);
  useEffect(() => {
    if (isDashboardOpen) dashboardUnlockedRef.current = true;
    else if (routeReadyRef.current) dashboardUnlockedRef.current = false;
  }, [isDashboardOpen]);

  const openChildScreen = (view: Extract<Screen, { kind: "child" }>["view"]): void => {
    const known = view.type !== "category" || allCategories.some((category) => category.id === view.categoryId);
    setIsDashboardOpen(false);
    setIsEntryOpen(false);
    setChildView(known ? view : { type: "home" });
  };

  // Asked for the dashboard without being in it: the child device asks for
  // its PIN, anyone else signs in — and lands on the screen they asked for.
  const askForDashboard = (view: Extract<Screen, { kind: "dashboard" }>["view"]): void => {
    setDashboardView(view);
    if (isChildDeviceEnabled()) {
      setIsEntryOpen(false);
      setIsParentPinOpen(true);
    } else {
      setIsEntryOpen(true);
      setAuthScreen("login");
      setIsLoginOpen(true);
    }
  };

  // First load: open the screen of the address.
  useEffect(() => {
    if (!hasLoadedStoredState || routeReadyRef.current) return;
    const target = pathToScreen(window.location.pathname);
    const finish = (): void => {
      routeReadyRef.current = true;
      window.history.replaceState(window.history.state, "", currentPathRef.current + window.location.search);
    };
    if (!target || target.kind === "entry") {
      finish();
      return;
    }
    if (target.kind === "child") {
      openChildScreen(target.view);
      window.setTimeout(finish, 0);
      return;
    }
    // A refresh inside the dashboard keeps it (same visit, still signed in);
    // a new tab or a link to it asks to sign in first.
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const isRefresh = navigation?.type === "reload";
    void (async () => {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (isRefresh && session && latestStateRef.current.isRegisteredInSupabase && latestStateRef.current.supabaseChildId) {
        setDashboardView(target.view);
        setIsEntryOpen(false);
        setIsDashboardOpen(true);
      } else {
        askForDashboard(target.view);
      }
      window.setTimeout(finish, 0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedStoredState]);

  // The open screen → the address.
  useEffect(() => {
    if (!routeReadyRef.current) return;
    if (window.location.pathname !== currentPath) {
      window.history.pushState(null, "", currentPath);
    }
  }, [currentPath]);

  // Back / forward.
  useEffect(() => {
    const onPopState = (): void => {
      if (!routeReadyRef.current) return;
      const target = pathToScreen(window.location.pathname);
      if (!target) return;
      if (target.kind === "entry") {
        setIsDashboardOpen(false);
        if (isChildDeviceEnabled()) {
          // the child's device has no entry screen — it stays on the board
          setIsEntryOpen(false);
          window.history.replaceState(window.history.state, "", "/child");
        } else {
          setIsEntryOpen(true);
        }
      } else if (target.kind === "child") {
        openChildScreen(target.view);
      } else if (dashboardUnlockedRef.current) {
        setDashboardView(target.view);
        setIsEntryOpen(false);
        setIsDashboardOpen(true);
      } else {
        window.history.replaceState(window.history.state, "", currentPathRef.current);
        askForDashboard(target.view);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCategories]);

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
        // Signing in / joining with Google always asks for the child's code
        // after Google — even when one is already in the field or the account
        // already works with a child — so the code is not sent along.
        childAccessCode: googleAccountType === "join" ? "" : childAccessCode.trim(),
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
            <h1 className="mx-auto max-w-3xl bg-gradient-to-l from-blue-700 via-indigo-600 to-violet-600 bg-clip-text text-xl font-bold leading-snug tracking-tight text-transparent md:text-3xl md:leading-snug">
              מערכת דיגיטלית המיועדת לילדים עם קשיי דיבור ומוגבלויות תקשורתיות, בשילוב ממשק מעקב להורים ולצוות החינוכי.
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

