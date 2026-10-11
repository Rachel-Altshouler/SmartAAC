"use client";

import { useEffect, useState } from "react";

// When Supabase sends a sign-in link back to an address the site doesn't have
// (its "Site URL" / redirect list points elsewhere), the link still carries the
// tokens — pass them on to the right page instead of showing "not found".
export default function NotFound() {
  const [forwarding, setForwarding] = useState(true);

  useEffect(() => {
    const { search, hash } = window.location;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const query = new URLSearchParams(search);
    const isAuthLink =
      params.has("access_token") || params.has("error") || query.has("code") || query.has("error");
    if (!isAuthLink) {
      setForwarding(false);
      return;
    }
    const target = params.get("type") === "recovery" ? "/reset-password" : "/auth/callback";
    window.location.replace(`${target}${search}${hash}`);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5 font-rubik" dir="rtl">
      <div className="w-full max-w-md rounded-[2rem] bg-white p-8 text-center shadow-soft">
        {forwarding ? (
          <p className="text-lg font-bold text-slate-700">רגע, מעבירים אותך…</p>
        ) : (
          <>
            <div className="text-5xl">🧭</div>
            <h1 className="mt-4 text-2xl font-bold">העמוד לא נמצא</h1>
            <p className="mt-2 text-muted">אולי הקישור ישן. אפשר לחזור לדף הבית ולהמשיך משם.</p>
            <a
              href="/"
              className="mt-6 inline-flex rounded-full bg-gradient-to-l from-blue-600 to-indigo-600 px-6 py-3 font-bold text-white"
            >
              🏠 לדף הבית
            </a>
          </>
        )}
      </div>
    </main>
  );
}
