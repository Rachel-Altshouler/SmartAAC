"use client";

import { useEffect, useState } from "react";
import { type AccountType, cx, type AuthMode } from "@/components/smartaac/shared";

export function LoginModal({
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
