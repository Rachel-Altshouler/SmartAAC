"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

// The page the "שכחתי סיסמה" email links to. Supabase signs the user in from
// the link itself (detectSessionInUrl), then they choose a new password here.
export default function ResetPasswordPage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setHasSession(false);
      return;
    }
    const client = supabase;
    const check = async (): Promise<void> => {
      // the link's tokens are read asynchronously — give them a moment
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const { data } = await client.auth.getSession();
        if (data.session) {
          setHasSession(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      setHasSession(false);
    };
    void check();
  }, []);

  const save = async (): Promise<void> => {
    if (password.length < 6) {
      setMessage("הסיסמה צריכה להיות לפחות 6 תווים.");
      return;
    }
    if (password !== confirm) {
      setMessage("שתי הסיסמאות לא זהות.");
      return;
    }
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage("לא הצלחנו לשמור את הסיסמה. נסו לבקש קישור חדש.");
      return;
    }
    await supabase.auth.signOut();
    setDone(true);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5" dir="rtl">
      <div className="w-full max-w-md rounded-soft bg-white p-6 shadow-soft">
        <h1 className="text-2xl font-black">בחירת סיסמה חדשה</h1>
        {done ? (
          <>
            <p className="mt-3 font-bold text-emerald-800">הסיסמה החדשה נשמרה ✓</p>
            <a href="/" className="mt-4 inline-block rounded-2xl bg-blue-600 px-5 py-3 font-black text-white">
              לכניסה למערכת
            </a>
          </>
        ) : hasSession === null ? (
          <p className="mt-3 text-muted">בודקים את הקישור…</p>
        ) : !hasSession ? (
          <>
            <p className="mt-3 text-slate-700">
              הקישור לא תקף או שפג תוקפו. חזרו למסך הכניסה ולחצו שוב על &quot;שכחתי סיסמה&quot;.
            </p>
            <a href="/" className="mt-4 inline-block rounded-2xl bg-blue-600 px-5 py-3 font-black text-white">
              חזרה לאתר
            </a>
          </>
        ) : (
          <div className="mt-4 grid gap-3">
            <input
              className="rounded-2xl border border-slate-200 px-4 py-3"
              type="password"
              autoComplete="new-password"
              placeholder="סיסמה חדשה (לפחות 6 תווים)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <input
              className="rounded-2xl border border-slate-200 px-4 py-3"
              type="password"
              autoComplete="new-password"
              placeholder="שוב, לאימות"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            {message && <p className="rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-800">{message}</p>}
            <button
              type="button"
              disabled={saving}
              className="rounded-2xl bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-60"
              onClick={() => void save()}
            >
              {saving ? "שומר…" : "שמירת הסיסמה"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
