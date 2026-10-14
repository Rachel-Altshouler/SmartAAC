import type { ReactNode } from "react";

// Shared frame for the site's information pages (privacy, terms,
// accessibility): the same look as the app, with links between them.
export const LEGAL_LINKS = [
  { href: "/privacy", label: "מדיניות פרטיות" },
  { href: "/terms", label: "תנאי שימוש" },
  { href: "/accessibility", label: "הצהרת נגישות" },
] as const;

export const CONTACT_URL = "https://github.com/Rachel-Altshouler/SmartAAC/issues";

export const LEGAL_UPDATED = "14 באוקטובר 2026";

export function LegalFooterLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="מידע על האתר" className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 ${className}`}>
      {LEGAL_LINKS.map((link) => (
        <a key={link.href} href={link.href} className="underline-offset-4 hover:underline">
          {link.label}
        </a>
      ))}
      <a href={CONTACT_URL} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
        יצירת קשר
      </a>
    </nav>
  );
}

export function LegalPage({ title, emoji, children }: { title: string; emoji: string; children: ReactNode }) {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#e0e7ff_0,_transparent_40%),radial-gradient(circle_at_bottom_left,_#d1fae5_0,_transparent_40%),linear-gradient(135deg,_#f5f8ff,_#fbfcff)] px-4 py-8 font-rubik sm:px-6"
    >
      <div className="mx-auto max-w-3xl">
        <a href="/" className="mb-6 inline-flex items-center gap-2 font-bold text-blue-700 underline-offset-4 hover:underline">
          <span aria-hidden>→</span> חזרה ל-SmartAAC
        </a>
        <article className="rounded-[2rem] bg-white/95 p-6 shadow-soft ring-1 ring-blue-100 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-2xl"
            >
              {emoji}
            </span>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
              <p className="text-sm text-muted">עודכן לאחרונה: {LEGAL_UPDATED}</p>
            </div>
          </div>
          <div className="space-y-6 leading-7 text-slate-700 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-950 [&_li]:mr-5 [&_li]:list-disc [&_a]:font-bold [&_a]:text-blue-700 [&_a]:underline">
            {children}
          </div>
        </article>
        <LegalFooterLinks className="mt-6 text-sm text-slate-600" />
      </div>
    </main>
  );
}
