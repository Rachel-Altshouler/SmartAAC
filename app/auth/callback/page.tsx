"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import type { Session } from "@supabase/supabase-js";

const authDraftKey = "smartaac-auth-draft";

type AuthDraft = {
  mode: "parent" | "teacher";
  accountType: "create" | "join";
  name: string;
  email: string;
  childName: string;
  childAccessCode: string;
  functionalityLevel: string;
};

const readGoogleName = (metadata: Record<string, unknown> | undefined): string => {
  if (!metadata) return "";
  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }
  if (typeof metadata.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }
  return "";
};

const readAuthDraft = (): AuthDraft => {
  const rawDraft = window.sessionStorage.getItem(authDraftKey);
  if (rawDraft) {
    return JSON.parse(rawDraft) as AuthDraft;
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

async function resolveOAuthSession(): Promise<{
  session: Session | null;
  error?: string;
}> {
  if (!supabase) {
    return { session: null, error: "Supabase לא מוגדר." };
  }

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const errorDescription =
    query.get("error_description") ??
    query.get("error") ??
    hash.get("error_description") ??
    hash.get("error");

  if (errorDescription) {
    return { session: null, error: errorDescription };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const setResult = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (setResult.error || !setResult.data.session) {
      return { session: null, error: setResult.error?.message ?? "Session invalid" };
    }
    return { session: setResult.data.session };
  }

  const code = query.get("code") ?? hash.get("code");
  if (code) {
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error || !exchanged.data.session) {
      return {
        session: null,
        error: exchanged.error?.message ?? "ההתחברות עם Google נכשלה.",
      };
    }
    return { session: exchanged.data.session };
  }

  // detectSessionInUrl may have already exchanged the code on load
  await new Promise((resolve) => {
    window.setTimeout(resolve, 150);
  });
  const existing = await supabase.auth.getSession();
  if (existing.data.session) {
    return { session: existing.data.session };
  }

  return {
    session: null,
    error:
      "לא התקבל קוד מ-Google. ודא/י ב-Supabase → URL Configuration שהוספת: http://localhost:3000/auth/callback",
  };
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("מסיימים התחברות...");

  useEffect(() => {
    const finish = async (): Promise<void> => {
      const draft = readAuthDraft();
      const resolved = await resolveOAuthSession();

      if (!resolved.session) {
        setMessage(resolved.error ?? "ההתחברות עם Google נכשלה.");
        return;
      }

      const session = resolved.session;
      const googleEmail = session.user.email ?? draft.email;
      const googleName = readGoogleName(session.user.user_metadata) || draft.name;

      const response = await fetch("/api/auth/callback", {
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
          functionalityLevel: draft.functionalityLevel,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        session?: { access_token: string; refresh_token: string };
        email?: string;
        name?: string;
        teacherInviteCode?: string;
        isFirstLogin?: boolean;
        userId?: string;
        childId?: string;
        childName?: string;
        linkedChildren?: Array<{ id: string; name: string }>;
        savedInSupabase?: boolean;
      };

      if (!response.ok) {
        setMessage(payload.error ?? "ההתחברות עם Google נכשלה.");
        return;
      }

      if (supabase) {
        const setResult = await supabase.auth.setSession({
          access_token: payload.session?.access_token ?? session.access_token,
          refresh_token: payload.session?.refresh_token ?? session.refresh_token,
        });
        if (setResult.error) {
          setMessage(`הפרופיל נשמר, אבל הסשן לא נשמר במכשיר: ${setResult.error.message}`);
        }
      }

      window.sessionStorage.setItem(
        "smartaac-auth-result",
        JSON.stringify({
          email: payload.email ?? googleEmail,
          name: payload.name ?? googleName,
          teacherInviteCode: payload.teacherInviteCode,
          isFirstLogin: payload.isFirstLogin,
          userId: payload.userId,
          childId: payload.childId,
          childName: payload.childName,
          linkedChildren: payload.linkedChildren,
          mode: draft.mode,
          accountType: draft.accountType,
        }),
      );

      window.sessionStorage.removeItem(authDraftKey);
      window.history.replaceState({}, "", "/auth/callback");
      router.replace("/?auth=success");
    };

    void finish();
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div className="rounded-3xl bg-white p-8 shadow-lg">
        <p className="text-xl font-bold text-slate-800">{message}</p>
      </div>
    </main>
  );
}
