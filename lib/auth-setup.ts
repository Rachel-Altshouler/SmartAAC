import { createHash } from "crypto";
import { sendEmail } from "@/lib/email";
import {
  createAdminSupabaseClient,
  createAuthedSupabaseClient,
  ensureUserProfileWithAdmin,
  signInWithPassword,
  type SupabaseAuthSession,
} from "@/lib/supabase-server";

type AuthMode = "parent" | "teacher";
// "create" = this account sets up a brand-new child profile and gets an
// access code to share. "join" = this account links to an existing child
// using someone else's code. Independent of `mode`/role: a teacher can
// create and invite a parent, just as easily as a parent can create and
// invite a teacher.
type AccountType = "create" | "join";

type ChildRow = {
  id: string;
  display_name: string;
};

export type AuthSuccessPayload = {
  session: {
    access_token: string;
    refresh_token: string;
  };
  userId: string;
  email: string;
  name: string;
  mode: AuthMode;
  savedInSupabase: true;
  childId?: string;
  childName?: string;
  teacherInviteCode?: string;
  teacherEmail?: string;
  isFirstLogin?: boolean;
  linkedChildren?: Array<{ id: string; name: string }>;
  // What the login really was: someone already on a child's care team who
  // pressed "יצירת פרופיל חדש" is logged in to that child, not given a new one.
  accountType?: AccountType;
};

const createTeacherInviteCode = (): string =>
  `AAC-${Math.floor(1000 + Math.random() * 9000)}`;

// "aac-4535", " AAC 4535 " and "4535" all mean AAC-4535 (codes are made as
// AAC-#### in capitals, so existing ones keep matching).
const normalizeAccessCode = (rawCode: string): string => {
  const compact = rawCode.trim().toUpperCase().replace(/\s+/g, "");
  const digits = compact.match(/^(?:AAC-?)?(\d{4})$/);
  return digits ? `AAC-${digits[1]}` : compact;
};

const hashAccessCode = (rawCode: string): string =>
  createHash("md5").update(normalizeAccessCode(rawCode)).digest("hex");

export const NOT_REGISTERED_MESSAGE = 'עוד לא נרשמת למערכת עם הקוד הזה. נא להירשם קודם — בלשונית "הרשמה". אם כבר נרשמת, בדקו את הסיסמה.';

const WRONG_CODE_MESSAGE = 'קוד הילד/ה לא נכון. בדקו אותו — הקוד מופיע בלוח הבקרה, במסך "סקירה".';

const isMissingDbFunction = (message: string): boolean => {
  const lower = message.toLowerCase();
  if (lower.includes("crypt") || lower.includes("gen_salt")) {
    return false;
  }
  return (
    lower.includes("schema cache") ||
    lower.includes("could not find the function") ||
    (lower.includes("function") && lower.includes("does not exist"))
  );
};

const storeChildAccessCode = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
  rawCode: string,
  userId: string,
  revokeOthers = true,
): Promise<void> => {
  if (rawCode.trim().length < 6) {
    throw new Error("code must be at least 6 characters");
  }

  const admin = createAdminSupabaseClient();
  const writer = admin ?? client;

  if (revokeOthers) {
    const deactivated = await writer
      .from("child_access_codes")
      .update({ is_active: false })
      .eq("child_id", childId);

    if (deactivated.error) {
      throw new Error(deactivated.error.message);
    }
  }

  const row = { child_id: childId, code_hash: hashAccessCode(rawCode), created_by: userId };
  let inserted = await writer.from("child_access_codes").insert({ ...row, code_plain: rawCode.trim() });
  if (inserted.error && /code_plain|schema cache/i.test(inserted.error.message)) {
    // before migration 006: store the hash only
    inserted = await writer.from("child_access_codes").insert(row);
  }

  if (inserted.error) {
    throw new Error(inserted.error.message);
  }
};

// The child's current code, so everyone on the care team sees the same one
// and can pass it on. null before migration 006 or when none is stored.
export const readActiveChildCode = async (childId: string): Promise<string | null> => {
  const admin = createAdminSupabaseClient();
  if (!admin) return null;
  const result = await admin
    .from("child_access_codes")
    .select("code_plain")
    .eq("child_id", childId)
    .eq("is_active", true)
    .not("code_plain", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return result.error ? null : ((result.data?.code_plain as string | undefined) ?? null);
};

const getLinkedChildren = async (
  userId: string,
): Promise<Array<{ id: string; name: string }>> => {
  const admin = createAdminSupabaseClient();
  if (!admin) {
    return [];
  }

  const fromLinks = await admin
    .from("child_caregivers")
    .select("child_id")
    .eq("caregiver_id", userId);

  if (!fromLinks.error && fromLinks.data?.length) {
    const childIds = fromLinks.data.map((row) => row.child_id);
    const children = await admin
      .from("children")
      .select("id, display_name")
      .in("id", childIds)
      .order("created_at", { ascending: true });

    if (!children.error && children.data?.length) {
      return children.data.map((child) => ({ id: child.id, name: child.display_name }));
    }
  }

  const legacy = await admin
    .from("children")
    .select("id, display_name")
    .eq("caregiver_id", userId)
    .order("created_at", { ascending: true });

  if (legacy.error || !legacy.data?.length) {
    return [];
  }

  return legacy.data.map((child) => ({ id: child.id, name: child.display_name }));
};

// Every child this account works with: the ones it created and the ones it
// joined with a code (a teacher with two pupils sees both).
export const listAccountChildren = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
): Promise<Array<{ id: string; name: string }>> => {
  const own = await client
    .from("children")
    .select("id, display_name")
    .eq("parent_id", userId)
    .order("created_at", { ascending: true });
  const all = [
    ...(await getLinkedChildren(userId)),
    ...((own.data ?? []) as ChildRow[]).map((child) => ({ id: child.id, name: child.display_name })),
  ];
  return all.filter((child, index) => all.findIndex((item) => item.id === child.id) === index);
};

// A child this account already works with: the one this device last used if
// the account can still open it, else one it joined with a code, else its own.
const findExistingChild = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
  knownChildId: string | undefined,
): Promise<ChildRow | null> => {
  const own = await client
    .from("children")
    .select("id, display_name")
    .eq("parent_id", userId)
    .order("created_at", { ascending: true });
  const ownChildren = (own.data ?? []) as ChildRow[];
  const linked = (await getLinkedChildren(userId)).map((child) => ({ id: child.id, display_name: child.name }));
  const all = [...linked, ...ownChildren];
  return all.find((child) => child.id === knownChildId) ?? linked[0] ?? ownChildren[0] ?? null;
};

const SITE_URL = "https://smart-aac.vercel.app";

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

// The child's code is needed at every sign-in, so whoever joins a child (or
// creates one) gets it by email to keep. A failed email never blocks sign-in.
const emailChildCode = async (input: {
  to: string;
  name: string;
  childName: string;
  code: string;
  isCreator: boolean;
}): Promise<void> => {
  if (!input.to || !input.code) return;
  const greeting = input.name ? `שלום ${input.name},` : "שלום,";
  const intro = input.isCreator
    ? `יצרת פרופיל חדש ל${input.childName} ב-SmartAAC.`
    : `הצטרפת לצוות של ${input.childName} ב-SmartAAC.`;
  const text = [
    greeting,
    "",
    intro,
    `קוד הילד/ה: ${input.code}`,
    "",
    "את הקוד מקישים בכל כניסה (יחד עם האימייל והסיסמה), והמערכת נכנסת ישר לילד/ה.",
    "שמרו את המייל הזה.",
    "",
    `כניסה: ${SITE_URL}`,
  ].join("\n");
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#0f172a">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<p style="margin:20px 0">קוד הילד/ה:<br><strong style="display:inline-block;margin-top:6px;padding:10px 18px;border-radius:12px;background:#eef2ff;color:#3730a3;font-size:26px;letter-spacing:3px" dir="ltr">${escapeHtml(input.code)}</strong></p>
<p>את הקוד מקישים בכל כניסה (יחד עם האימייל והסיסמה), והמערכת נכנסת ישר לילד/ה. שמרו את המייל הזה.</p>
<p><a href="${SITE_URL}" style="display:inline-block;padding:10px 20px;border-radius:999px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:bold">כניסה ל-SmartAAC</a></p>
</div>`;
  try {
    await sendEmail({ to: input.to, subject: `קוד הילד/ה של ${input.childName} ב-SmartAAC`, text, html });
  } catch {
    // the code is also shown in the dashboard ("סקירה")
  }
};

const joinChildByCode = async (
  rawCode: string,
  userName: string,
  userId: string,
  role: AuthMode,
): Promise<ChildRow & { isNewMember: boolean }> => {
  const code = rawCode.trim();
  if (!code) {
    throw new Error("צריך להזין קוד ילד כדי שהמערכת תדע על איזה ילד לעבוד.");
  }

  const admin = createAdminSupabaseClient();
  if (!admin) {
    throw new Error(
      "לא הצלחנו לאמת את קוד הילד. ודא/י ש-SUPABASE_SERVICE_ROLE_KEY מוגדר ב-.env.local.",
    );
  }

  const activeCodes = await admin
    .from("child_access_codes")
    .select("child_id, code_hash")
    .eq("is_active", true);

  if (activeCodes.error) {
    throw new Error(activeCodes.error.message);
  }

  const codeHash = hashAccessCode(code);
  const matched = activeCodes.data?.find((row) => row.code_hash === codeHash);

  if (!matched) {
    throw new Error(WRONG_CODE_MESSAGE);
  }

  const child = await admin
    .from("children")
    .select("id, display_name")
    .eq("id", matched.child_id)
    .maybeSingle();

  if (child.error) {
    throw new Error(child.error.message);
  }

  if (!child.data) {
    throw new Error(WRONG_CODE_MESSAGE);
  }

  await ensureUserProfileWithAdmin({
    userId,
    fullName: userName || (role === "parent" ? "הורה" : "מורה"),
    role,
  });

  const existingLink = await admin
    .from("child_caregivers")
    .select("child_id")
    .eq("child_id", child.data.id)
    .eq("caregiver_id", userId)
    .maybeSingle();
  const isNewMember = !existingLink.data;

  const caregiverLink = await admin.from("child_caregivers").upsert(
    {
      child_id: child.data.id,
      caregiver_id: userId,
    },
    { onConflict: "child_id,caregiver_id" },
  );

  if (caregiverLink.error) {
    const legacyLink = await admin
      .from("children")
      .update({ caregiver_id: userId })
      .eq("id", child.data.id);

    if (legacyLink.error) {
      throw new Error(legacyLink.error.message);
    }
  }

  return { ...(child.data as ChildRow), isNewMember };
};

export const ensureUserProfile = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
  fullName: string,
  role: AuthMode,
): Promise<void> => {
  const profile = {
    full_name: fullName || (role === "parent" ? "הורה" : "מורה"),
    role,
  };

  const existing = await client.from("users").select("id").eq("id", userId).maybeSingle();
  if (existing.error) {
    throw new Error(existing.error.message);
  }

  if (existing.data) {
    const updated = await client.from("users").update(profile).eq("id", userId);
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return;
  }

  const inserted = await client.from("users").insert({
    id: userId,
    ...profile,
  });

  if (!inserted.error) {
    return;
  }

  if (inserted.error.code === "23505") {
    return;
  }

  const ensured = await ensureUserProfileWithAdmin({
    userId,
    fullName: profile.full_name,
    role,
  });
  if (ensured) {
    return;
  }

  throw new Error(
    inserted.error.message.includes("row-level security")
      ? "לא הצלחנו ליצור פרופיל משתמש. ודא/י ש-SUPABASE_SERVICE_ROLE_KEY מוגדר ב-.env.local."
      : inserted.error.message,
  );
};

const getOrCreateParentChild = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
  childName: string,
  functionalityLevel: string,
): Promise<ChildRow> => {
  const rpc = await client
    .rpc("get_or_create_parent_child", {
      display_name_value: childName,
      functionality_level_value: functionalityLevel,
    })
    .single();

  if (!rpc.error && rpc.data) {
    return rpc.data as ChildRow;
  }

  if (rpc.error && !isMissingDbFunction(rpc.error.message)) {
    throw new Error(rpc.error.message);
  }

  const existing = await client
    .from("children")
    .select("id, display_name")
    .eq("parent_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message);
  }

  if (existing.data) {
    return existing.data as ChildRow;
  }

  const created = await client
    .from("children")
    .insert({
      parent_id: userId,
      display_name: childName,
      functionality_level: functionalityLevel,
    })
    .select("id, display_name")
    .single();

  if (created.error) {
    throw new Error(created.error.message);
  }

  return created.data as ChildRow;
};

export const parentHasChild = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  userId: string,
): Promise<boolean> => {
  const existing = await client
    .from("children")
    .select("id")
    .eq("parent_id", userId)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message);
  }

  return Boolean(existing.data);
};

const isActiveChildAccessCode = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
  rawCode: string,
): Promise<boolean> => {
  const reader = createAdminSupabaseClient() ?? client;
  const existing = await reader
    .from("child_access_codes")
    .select("id")
    .eq("child_id", childId)
    .eq("code_hash", hashAccessCode(rawCode))
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return !existing.error && Boolean(existing.data);
};

// Logging in must never revoke codes that were already emailed to a
// parent/teacher — only an explicit "new code" (rotateTeacherAccessCode)
// does that. Reuse the code this browser already shows when it's still
// active; otherwise add a fresh one alongside the existing codes.
const resolveLoginAccessCode = async (
  client: ReturnType<typeof createAuthedSupabaseClient>,
  childId: string,
  userId: string,
  requestedCode: string | undefined,
  knownCode: string | undefined,
): Promise<string> => {
  for (const candidate of [requestedCode?.trim(), knownCode?.trim()]) {
    if (candidate && (await isActiveChildAccessCode(client, childId, candidate))) {
      return normalizeAccessCode(candidate);
    }
  }
  // The child already has a code: keep it (a new one only for a new child).
  const existing = await readActiveChildCode(childId);
  if (existing) return existing;

  const code = requestedCode?.trim() ? normalizeAccessCode(requestedCode) : createTeacherInviteCode();
  await storeChildAccessCode(client, childId, code, userId, false);
  return code;
};

export const rotateTeacherAccessCode = async (input: {
  accessToken: string;
  childId?: string;
}): Promise<string> => {
  const client = createAuthedSupabaseClient(input.accessToken);
  const userResult = await client.auth.getUser(input.accessToken);

  if (userResult.error || !userResult.data.user) {
    throw new Error("not authenticated");
  }

  const userId = userResult.data.user.id;
  let childId = input.childId;

  if (!childId) {
    const child = await client
      .from("children")
      .select("id")
      .eq("parent_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (child.error) {
      throw new Error(child.error.message);
    }

    if (!child.data) {
      throw new Error("לא נמצא פרופיל ילד להורה.");
    }

    childId = child.data.id;
  }

  if (!childId) {
    throw new Error("לא נמצא פרופיל ילד להורה.");
  }

  const access = await client.rpc("can_access_child", { child_uuid: childId });
  if (access.error || access.data !== true) {
    throw new Error("אין הרשאה ליצור קוד לילד הזה.");
  }

  const code = createTeacherInviteCode();
  await storeChildAccessCode(client, childId, code, userId);
  return code;
};

// "כניסה": only the child's code and a password. The code finds the child;
// the password finds which of the child's parents / teachers is signing in.
export const loginWithChildCode = async (input: {
  code: string;
  password: string;
}): Promise<AuthSuccessPayload> => {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error("חסר SUPABASE_SERVICE_ROLE_KEY בשרת.");

  const codes = await admin.from("child_access_codes").select("child_id, code_hash").eq("is_active", true);
  if (codes.error) throw new Error(codes.error.message);
  const codeHash = hashAccessCode(input.code.trim());
  const match = codes.data?.find((row) => row.code_hash === codeHash);
  if (!match) throw new Error(WRONG_CODE_MESSAGE);

  // The child's care team: whoever created it and everyone who joined.
  const [child, caregivers] = await Promise.all([
    admin.from("children").select("parent_id, caregiver_id").eq("id", match.child_id).maybeSingle(),
    admin.from("child_caregivers").select("caregiver_id").eq("child_id", match.child_id),
  ]);
  const memberIds = [
    child.data?.parent_id,
    ...(caregivers.data ?? []).map((row) => row.caregiver_id),
    child.data?.caregiver_id,
  ].filter((id, index, all): id is string => typeof id === "string" && all.indexOf(id) === index);

  for (const memberId of memberIds) {
    const member = await admin.auth.admin.getUserById(memberId);
    const email = member.data.user?.email;
    if (!email) continue;
    const signedIn = await signInWithPassword(email, input.password);
    if (!signedIn.session) continue;

    const profile = await admin.from("users").select("full_name, role").eq("id", memberId).maybeSingle();
    const mode: AuthMode = profile.data?.role === "teacher" ? "teacher" : "parent";
    const name = profile.data?.full_name || (mode === "teacher" ? "מורה" : "הורה");
    const payload = await completeAuthSetup({
      session: signedIn.session,
      mode,
      accountType: "join",
      email,
      name,
      childAccessCode: normalizeAccessCode(input.code),
    });
    return { ...payload, mode };
  }
  throw new Error(NOT_REGISTERED_MESSAGE);
};

export const completeAuthSetup = async (input: {
  session: SupabaseAuthSession;
  mode: AuthMode;
  accountType: AccountType;
  email: string;
  name: string;
  childName?: string;
  childAccessCode?: string;
  knownInviteCode?: string;
  // The child this device last worked on — preferred when no code is given.
  knownChildId?: string;
  teacherEmail?: string;
  functionalityLevel?: string;
  appOrigin?: string;
  // "כניסה" (not "הרשמה"): refuse someone who isn't on the child's team yet.
  mustBeMember?: boolean;
}): Promise<AuthSuccessPayload> => {
  const client = createAuthedSupabaseClient(input.session.access_token);
  const userId = input.session.user.id;

  if (input.mustBeMember) {
    const admin = createAdminSupabaseClient();
    const codes = admin
      ? await admin.from("child_access_codes").select("child_id, code_hash").eq("is_active", true)
      : null;
    const childId = codes?.data?.find((row) => row.code_hash === hashAccessCode(input.childAccessCode ?? ""))?.child_id;
    if (!admin || !childId) throw new Error(WRONG_CODE_MESSAGE);
    const [owner, link] = await Promise.all([
      admin.from("children").select("id").eq("id", childId).eq("parent_id", userId).maybeSingle(),
      admin.from("child_caregivers").select("child_id").eq("child_id", childId).eq("caregiver_id", userId).maybeSingle(),
    ]);
    if (!owner.data && !link.data) throw new Error(NOT_REGISTERED_MESSAGE);
  }

  // Signing in to a child (not creating one): an account that already exists
  // keeps the role and name it registered with — the "כניסה" screen (code +
  // Google) doesn't ask for them.
  if (input.accountType === "join") {
    const saved = await client.from("users").select("full_name, role").eq("id", userId).maybeSingle();
    if (saved.data?.role === "parent" || saved.data?.role === "teacher") {
      input = { ...input, mode: saved.data.role, name: saved.data.full_name || input.name };
    }
  }

  await ensureUserProfile(client, userId, input.name, input.mode);

  if (input.accountType === "join") {
    // Returning login: no code needed. Open a child this account already
    // works with — one it created, or one it joined with a code before.
    let activeChild: ChildRow;
    if (input.childAccessCode?.trim()) {
      const joined = await joinChildByCode(input.childAccessCode, input.name, userId, input.mode);
      activeChild = joined;
      if (joined.isNewMember) {
        await emailChildCode({
          to: input.email,
          name: input.name,
          childName: joined.display_name,
          code: input.childAccessCode.trim(),
          isCreator: false,
        });
      }
    } else {
      const known = await findExistingChild(client, userId, input.knownChildId);
      if (!known) {
        throw new Error("צריך להזין קוד ילד כדי שהמערכת תדע על איזה ילד לעבוד.");
      }
      activeChild = known;
    }
    const linkedChildren = await listAccountChildren(client, userId);
    const allLinkedChildren = linkedChildren.some((child) => child.id === activeChild.id)
      ? linkedChildren
      : [...linkedChildren, { id: activeChild.id, name: activeChild.display_name }];

    return {
      session: {
        access_token: input.session.access_token,
        refresh_token: input.session.refresh_token,
      },
      userId,
      email: input.email,
      name: input.name,
      mode: input.mode,
      savedInSupabase: true,
      childId: activeChild.id,
      childName: activeChild.display_name,
      linkedChildren: allLinkedChildren,
      accountType: "join",
      teacherInviteCode:
        input.childAccessCode?.trim() || (await readActiveChildCode(activeChild.id)) || undefined,
    };
  }

  const isFirstLogin = !(await parentHasChild(client, userId));

  // Already on another child's care team (joined with a code before) and no
  // child of their own: this is a returning login on the wrong tab — open
  // that child instead of quietly creating a new, empty "דניאל".
  if (isFirstLogin && !input.childAccessCode?.trim()) {
    const linked = await getLinkedChildren(userId);
    if (linked.length > 0) {
      const preferred = linked.find((child) => child.id === input.knownChildId) ?? linked[0];
      return {
        session: {
          access_token: input.session.access_token,
          refresh_token: input.session.refresh_token,
        },
        userId,
        email: input.email,
        name: input.name,
        mode: input.mode,
        savedInSupabase: true,
        childId: preferred?.id,
        childName: preferred?.name,
        linkedChildren: linked,
        accountType: "join",
        teacherInviteCode: preferred ? (await readActiveChildCode(preferred.id)) ?? undefined : undefined,
      };
    }
  }
  const childRow = await getOrCreateParentChild(
    client,
    userId,
    input.childName?.trim() || "דניאל",
    input.functionalityLevel || "medium",
  );
  const teacherInviteCode = await resolveLoginAccessCode(
    client,
    childRow.id,
    userId,
    input.childAccessCode,
    input.knownInviteCode,
  );

  // A brand-new child profile: its creator gets the code by email to keep.
  if (isFirstLogin && teacherInviteCode) {
    await emailChildCode({
      to: input.email,
      name: input.name,
      childName: childRow.display_name,
      code: teacherInviteCode,
      isCreator: true,
    });
  }

  const teacherEmail = input.teacherEmail?.trim().toLowerCase() ?? "";
  if (teacherEmail) {
    const admin = createAdminSupabaseClient();
    const writer = admin ?? client;
    try {
      await writer
        .from("children")
        .update({ teacher_email: teacherEmail })
        .eq("id", childRow.id);
    } catch {
      // columns may not exist until schema migration is applied
    }
  }

  return {
    session: {
      access_token: input.session.access_token,
      refresh_token: input.session.refresh_token,
    },
    userId,
    email: input.email,
    name: input.name,
    mode: input.mode,
    savedInSupabase: true,
    childId: childRow.id,
    childName: childRow.display_name,
    linkedChildren: await listAccountChildren(client, userId),
    teacherInviteCode,
    teacherEmail: teacherEmail || undefined,
    isFirstLogin,
  };
};
