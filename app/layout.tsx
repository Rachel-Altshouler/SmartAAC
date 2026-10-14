import type { Metadata, Viewport } from "next";
import "./globals.css";

const description =
  "SmartAAC – מערכת דיגיטלית המיועדת לילדים עם קשיי דיבור ומוגבלויות תקשורתיות, בשילוב ממשק מעקב להורים ולצוות החינוכי.";

export const metadata: Metadata = {
  metadataBase: new URL("https://smart-aac.vercel.app"),
  title: "SmartAAC",
  description,
  manifest: "/manifest.webmanifest",
  // How a shared link looks in WhatsApp, Facebook, etc.
  openGraph: {
    title: "SmartAAC",
    description,
    url: "/",
    siteName: "SmartAAC",
    locale: "he_IL",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#edf3f8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* Supabase sends a Google sign-in to its "Site URL" (the home page)
            when /auth/callback isn't on its redirect list — pass it on to the
            page that finishes the sign-in (and asks for the child's code),
            before anything else on the page reads the link. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(location.pathname==='/'&&/[#&](access_token|error)=/.test(location.hash)){location.replace((/type=recovery/.test(location.hash)?'/reset-password':'/auth/callback')+location.hash)}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
