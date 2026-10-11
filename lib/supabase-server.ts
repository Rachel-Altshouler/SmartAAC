import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type SupabaseAuthSession = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
};

type SupabaseAuthError = {
  error?: string;
  error_description?: string;
  message?: string;
  msg?: string;
};

export const isServerSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl && supabaseAnonKey);

export const hasAdminAccess = (): boolean =>
  Boolean(supabaseUrl && supabaseServiceRoleKey);

const authHeaders = (): HeadersInit => ({
  apikey: supabaseAnonKey as string,
  "Content-Type": "application/json",
});

const readAuthError = (body: SupabaseAuthError): string =>
  body.error_description ?? body.message ?? body.msg ?? body.error ?? "שגיאת התחברות";

const isInvalidCredentialsError = (message: string): boolean => {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid login credentials") || lower.includes("invalid credentials")
  );
};

const isEmailConfirmationError = (message: string): boolean => {
  const lower = message.toLowerCase();
  return (
    lower.includes("email not confirmed") ||
    lower.includes("not confirmed") ||
    lower.includes("email_not_confirmed")
  );
};

export const getRegistrationSetupHint = (): string | null => {
  if (!isServerSupabaseConfigured()) {
    return "חסרים NEXT_PUBLIC_SUPABASE_URL ו-NEXT_PUBLIC_SUPABASE_ANON_KEY בקובץ .env.local.";
  }

  if (!hasAdminAccess()) {
    return "חסר SUPABASE_SERVICE_ROLE_KEY ב-.env.local. הוסיפ/י אותו מ-Supabase → Settings → API → service_role (Secret).";
  }

  return null;
};

const emailConfirmationBlockedMessage = (): string => {
  const setupHint = getRegistrationSetupHint();
  if (setupHint) {
    return `${setupHint} לחלופין, כבו Confirm email ב-Supabase → Authentication → Providers → Email.`;
  }

  return "האימייל לא אושר. נסו שוב בעוד רגע.";
};

// A slow or filtered network (e.g. a content filter) sometimes drops the
// connection to Supabase ("fetch failed"). Try again a couple of times before
// giving up — only on network errors, never on a real answer from Supabase.
const resilientFetch: typeof fetch = async (input, init) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (init?.signal?.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
};

export function createServerSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl as string, supabaseAnonKey as string, {
    global: { fetch: resilientFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createAdminSupabaseClient(): SupabaseClient | null {
  if (!hasAdminAccess()) return null;

  return createClient(supabaseUrl as string, supabaseServiceRoleKey as string, {
    global: { fetch: resilientFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function ensureUserProfileWithAdmin(input: {
  userId: string;
  fullName: string;
  role: "parent" | "teacher" | "caregiver";
}): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  if (!admin) return false;

  const profile = {
    id: input.userId,
    full_name: input.fullName,
    role: input.role,
  };

  const upserted = await admin.from("users").upsert(profile, { onConflict: "id" });
  return !upserted.error;
}

export async function confirmUserEmail(email: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) return;

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) return;

  const matched = listed.data.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!matched) return;

  await admin.auth.admin.updateUserById(matched.id, { email_confirm: true });
}

export async function createConfirmedUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: string;
}): Promise<boolean> {
  const admin = createAdminSupabaseClient();
  if (!admin) return false;

  const created = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName,
      role: input.role,
    },
  });

  return !created.error;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ session: SupabaseAuthSession | null; error?: string }> {
  if (!isServerSupabaseConfigured()) {
    return { session: null, error: "Supabase is not configured" };
  }

  const response = await resilientFetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as SupabaseAuthSession & SupabaseAuthError;
  if (!response.ok) {
    return { session: null, error: readAuthError(body) };
  }

  return { session: body };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  metadata: { full_name: string; role: string },
): Promise<{ session: SupabaseAuthSession | null; error?: string }> {
  if (!isServerSupabaseConfigured()) {
    return { session: null, error: "Supabase is not configured" };
  }

  const response = await resilientFetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      password,
      data: metadata,
    }),
  });

  const body = (await response.json()) as SupabaseAuthSession & SupabaseAuthError;
  if (!response.ok) {
    return { session: null, error: readAuthError(body) };
  }

  if (!body.access_token || !body.refresh_token) {
    return { session: null, error: emailConfirmationBlockedMessage() };
  }

  return { session: body };
}

export async function getGoogleOAuthUrl(redirectTo: string): Promise<string | null> {
  const client = createServerSupabaseClient();
  const result = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (result.error || !result.data.url) {
    return null;
  }

  return result.data.url;
}

export async function exchangeOAuthCode(
  code: string,
): Promise<{ session: SupabaseAuthSession | null; error?: string }> {
  const client = createServerSupabaseClient();
  const result = await client.auth.exchangeCodeForSession(code);

  if (result.error || !result.data.session) {
    return { session: null, error: result.error?.message ?? "OAuth failed" };
  }

  return {
    session: {
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
      user: {
        id: result.data.session.user.id,
        email: result.data.session.user.email ?? undefined,
        user_metadata: result.data.session.user.user_metadata,
      },
    },
  };
}

export async function sessionFromTokens(
  accessToken: string,
  refreshToken: string,
): Promise<{ session: SupabaseAuthSession | null; error?: string }> {
  const client = createAuthedSupabaseClient(accessToken);
  const userResult = await client.auth.getUser();

  if (userResult.error || !userResult.data.user) {
    return { session: null, error: userResult.error?.message ?? "Session invalid" };
  }

  return {
    session: {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: userResult.data.user.id,
        email: userResult.data.user.email ?? undefined,
        user_metadata: userResult.data.user.user_metadata,
      },
    },
  };
}

export function createAuthedSupabaseClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl as string, supabaseAnonKey as string, {
    global: {
      fetch: resilientFetch,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function authenticateUser(
  email: string,
  password: string,
  name: string,
  mode: "parent" | "teacher",
): Promise<{ session: SupabaseAuthSession | null; error?: string }> {
  let signIn = await signInWithPassword(email, password);
  if (signIn.session) {
    return signIn;
  }

  let signInError = signIn.error ?? "";

  if (isEmailConfirmationError(signInError)) {
    await confirmUserEmail(email);
    signIn = await signInWithPassword(email, password);
    if (signIn.session) {
      return signIn;
    }
    signInError = signIn.error ?? signInError;
  }

  const shouldTrySignUp = isInvalidCredentialsError(signInError);

  if (!shouldTrySignUp) {
    if (isEmailConfirmationError(signInError)) {
      return { session: null, error: emailConfirmationBlockedMessage() };
    }

    return { session: null, error: signInError || "לא הצלחנו להתחבר." };
  }

  const created = await createConfirmedUser({
    email,
    password,
    fullName: name,
    role: mode,
  });

  if (created) {
    signIn = await signInWithPassword(email, password);
    if (signIn.session) {
      return signIn;
    }
  }

  const signUp = await signUpWithPassword(email, password, {
    full_name: name,
    role: mode,
  });

  if (signUp.session) {
    return signUp;
  }

  if (signUp.error?.toLowerCase().includes("already")) {
    await confirmUserEmail(email);
    signIn = await signInWithPassword(email, password);
    if (signIn.session) {
      return signIn;
    }
  }

  if (signUp.error && !isEmailConfirmationError(signUp.error)) {
    return { session: null, error: signUp.error };
  }

  await confirmUserEmail(email);

  const retrySignIn = await signInWithPassword(email, password);
  if (retrySignIn.session) {
    return retrySignIn;
  }

  const retryError = retrySignIn.error ?? "email not confirmed";
  if (isEmailConfirmationError(retryError)) {
    return { session: null, error: emailConfirmationBlockedMessage() };
  }

  return { session: null, error: retryError };
}
