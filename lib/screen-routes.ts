// An address for every screen: "/" (entry), "/child/..." (the child's board)
// and "/dashboard/..." (parent / teacher). The app stays one page — these
// addresses only mirror which screen is open, so back / forward, refresh and
// a link to a screen work. Sign-in pages (/auth/callback, /reset-password)
// keep their own routes.

export const CHILD_SCREENS = {
  keyboard: "keyboard",
  events: "events",
  assistant: "chat",
  story: "story",
  daily: "today",
} as const;

export const DASHBOARD_SCREENS = {
  overview: "",
  events: "events",
  topic: "topic",
  symbols: "symbols",
  daily: "today",
  print: "print",
  library: "library",
  progress: "progress",
} as const;

export type ChildScreen =
  | { type: "home" }
  | { type: "category"; categoryId: string }
  | { type: keyof typeof CHILD_SCREENS };

export type DashboardScreen = keyof typeof DASHBOARD_SCREENS;

export type Screen =
  | { kind: "entry" }
  | { kind: "child"; view: ChildScreen }
  | { kind: "dashboard"; view: DashboardScreen };

export const screenToPath = (screen: Screen): string => {
  if (screen.kind === "entry") return "/";
  if (screen.kind === "dashboard") {
    const slug = DASHBOARD_SCREENS[screen.view] ?? "";
    return slug ? `/dashboard/${slug}` : "/dashboard";
  }
  const view = screen.view;
  if (view.type === "home") return "/child";
  if (view.type === "category") return `/child/category/${encodeURIComponent(view.categoryId)}`;
  return `/child/${CHILD_SCREENS[view.type]}`;
};

const findKey = <T extends Record<string, string>>(map: T, slug: string): keyof T | undefined =>
  (Object.keys(map) as Array<keyof T>).find((key) => map[key] === slug);

// null = not one of the app's screens.
export const pathToScreen = (pathname: string): Screen | null => {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 0) return { kind: "entry" };
  const [area, slug, extra, ...rest] = parts;
  if (rest.length > 0) return null;
  if (area === "child") {
    if (slug === undefined) return { kind: "child", view: { type: "home" } };
    if (slug === "category") return extra ? { kind: "child", view: { type: "category", categoryId: extra } } : null;
    if (extra !== undefined) return null;
    const type = findKey(CHILD_SCREENS, slug);
    return type ? { kind: "child", view: { type } } : null;
  }
  if (area === "dashboard") {
    if (extra !== undefined) return null;
    if (slug === undefined) return { kind: "dashboard", view: "overview" };
    const view = findKey(DASHBOARD_SCREENS, slug);
    return view && view !== "overview" ? { kind: "dashboard", view } : null;
  }
  return null;
};
