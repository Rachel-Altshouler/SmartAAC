"use client";

import { useState } from "react";
import { type AacSymbol, type CalendarEvent, type DemoState, symbols } from "@/lib/demo-data";
import { withCombinedUsage } from "@/lib/usage-stats";
import { SharedLibraryDashboard } from "@/components/shared-library";
import { DailyStoryDashboard } from "@/components/daily-story";
import { PrintSymbolsDashboard } from "@/components/print-symbols";
import { ChildDevicePanel } from "@/components/child-device";
import { LegalFooterLinks } from "@/components/legal-page";
import {
  type DashboardView,
  eventInfo,
  localIsoDate,
  cx,
  MAX_FAMILY_PHOTO_BYTES,
  CHILD_PHOTO_KEY,
  prepareFamilyPhoto,
} from "@/components/smartaac/shared";
import { EventsDashboard } from "@/components/smartaac/dashboard-events";
import { ChildSettingsDashboard } from "@/components/smartaac/child-settings";
import { ProgressDashboard } from "@/components/smartaac/dashboard-progress";
import { SymbolsDashboard } from "@/components/smartaac/dashboard-symbols";
import { TopicDashboard } from "@/components/smartaac/dashboard-topic";

const DASHBOARD_NAV = [
  ["overview", "📊", "סקירה"],
  ["events", "📅", "אירועים ולוח שנה"],
  ["topic", "📚", "נושא שבועי והגדרות"],
  ["symbols", "🔣", "סמלים"],
  ["daily", "📸", "מה עשינו היום"],
  ["print", "🖨️", "הדפסת סמלים"],
  ["library", "🌍", "ספרייה משותפת"],
  ["progress", "📈", "התקדמות"],
] as const;

export function Dashboard({
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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

  const currentNav = DASHBOARD_NAV.find(([id]) => id === view) ?? DASHBOARD_NAV[0];

  return (
    <main className="flex h-screen flex-col overflow-hidden md:flex-row">
      {/* Phones: a top bar with a menu button instead of the side menu. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-xl"
          aria-label={isMenuOpen ? "סגירת התפריט" : "פתיחת התפריט"}
          aria-expanded={isMenuOpen}
          aria-controls="dashboard-menu"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span aria-hidden>{isMenuOpen ? "✕" : "☰"}</span>
        </button>
        <span className="font-black">
          <span aria-hidden>{currentNav[1]} </span>
          {currentNav[2]}
        </span>
        <span className="mr-auto text-lg font-black">🧩 SmartAAC</span>
      </div>

      <aside
        id="dashboard-menu"
        aria-label="תפריט הדשבורד"
        className={cx(
          "flex-col gap-2 overflow-y-auto border-l border-slate-200 bg-white p-4 md:flex md:w-64 md:shrink-0",
          isMenuOpen ? "fixed inset-x-0 bottom-0 top-[4.25rem] z-40 flex" : "hidden",
        )}
      >
        <div className="mb-4 hidden px-2 text-2xl font-black md:block">🧩 SmartAAC</div>
        {DASHBOARD_NAV.map(([id, emoji, label]) => (
          <button
            key={id}
            type="button"
            className={cx(
              "flex items-center gap-3 rounded-2xl px-4 py-3 text-right font-black text-slate-600",
              view === id && "bg-blue-50 text-blue-700",
            )}
            aria-current={view === id ? "page" : undefined}
            onClick={() => {
              onViewChange(id as DashboardView);
              setIsMenuOpen(false);
            }}
          >
            <span aria-hidden>{emoji}</span>
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
        <LegalFooterLinks className="justify-start px-2 text-[11px] text-muted" />
      </aside>

      <section className="min-h-0 flex-1 overflow-auto p-4 sm:p-6 md:p-8">
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
