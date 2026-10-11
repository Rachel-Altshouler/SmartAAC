import { createHash } from "crypto";
import {
  createAdminSupabaseClient,
  createAuthedSupabaseClient,
  ensureUserProfileWithAdmin,
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

const hashAccessCode = (rawCode: string): string =>
  createHash("md5").update(rawCode.trim()).digest("hex");

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

const joinChildByCode = async (
  rawCode: string,
  userName: string,
  userId: string,
  role: AuthMode,
): Promise<ChildRow> => {
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
    throw new Error("invalid child access code");
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
    throw new Error("invalid child access code");
  }

  await ensureUserProfileWithAdmin({
    userId,
    fullName: userName || (role === "parent" ? "הורה" : "מורה"),
    role,
  });

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

  return child.data as ChildRow;
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
      return candidate;
    }
  }

  const code = requestedCode?.trim() || createTeacherInviteCode();
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
}): Promise<AuthSuccessPayload> => {
  const client = createAuthedSupabaseClient(input.session.access_token);
  const userId = input.session.user.id;

  await ensureUserProfile(client, userId, input.name, input.mode);

  if (input.accountType === "join") {
    // Returning login: no code needed. Open a child this account already
    // works with — one it created, or one it joined with a code before.
    let activeChild: ChildRow;
    if (input.childAccessCode?.trim()) {
      activeChild = await joinChildByCode(input.childAccessCode, input.name, userId, input.mode);
    } else {
      const known = await findExistingChild(client, userId, input.knownChildId);
      if (!known) {
        throw new Error("צריך להזין קוד ילד כדי שהמערכת תדע על איזה ילד לעבוד.");
      }
      activeChild = known;
    }
    const linkedChildren = await getLinkedChildren(userId);
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
    teacherInviteCode,
    teacherEmail: teacherEmail || undefined,
    isFirstLogin,
  };
};
