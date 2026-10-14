"use client";

import { useEffect, useState } from "react";

// "מכשיר של ילד": a parent/teacher turns this tablet into the child's device.
// It then opens straight to the communication board, and the dashboard is
// reached only through the hidden corner (3 taps) + a 4-digit parent PIN.
//
// This is a per-device setting (the child's tablet, not the parent's phone),
// so it lives in this browser's localStorage and is never synced. The PIN is
// stored only as a salted hash.

const CHILD_DEVICE_KEY = "smartaac-child-device";
const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

type ChildDeviceSettings = { enabled: boolean; pinHash: string; salt: string };

export const readChildDevice = (): ChildDeviceSettings | null => {
  try {
    const raw = window.localStorage.getItem(CHILD_DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChildDeviceSettings>;
    return parsed.enabled && parsed.pinHash && parsed.salt
      ? { enabled: true, pinHash: parsed.pinHash, salt: parsed.salt }
      : null;
  } catch {
    return null;
  }
};

export const isChildDeviceEnabled = (): boolean => Boolean(readChildDevice());

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const hashPin = async (pin: string, salt: string): Promise<string> => {
  const input = `${salt}:${pin}`;
  // crypto.subtle only exists on https/localhost; a tablet opening the dev
  // server by LAN IP over plain http falls back to a simple FNV-1a hash.
  if (window.crypto?.subtle) {
    return toHex(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  }
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv-${hash.toString(16)}`;
};

const newSalt = (): string =>
  window.crypto?.getRandomValues
    ? toHex(window.crypto.getRandomValues(new Uint8Array(16)).buffer)
    : `${Date.now()}-${Math.random()}`;

export const saveChildDevicePin = async (pin: string): Promise<void> => {
  const salt = newSalt();
  const settings: ChildDeviceSettings = { enabled: true, pinHash: await hashPin(pin, salt), salt };
  window.localStorage.setItem(CHILD_DEVICE_KEY, JSON.stringify(settings));
};

export const disableChildDevice = (): void => {
  try {
    window.localStorage.removeItem(CHILD_DEVICE_KEY);
  } catch {
    // nothing stored — already off
  }
};

const verifyPin = async (pin: string): Promise<boolean> => {
  const settings = readChildDevice();
  return Boolean(settings) && (await hashPin(pin, settings!.salt)) === settings!.pinHash;
};

const isValidPin = (pin: string): boolean => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

export function ParentPinModal({
  onSuccess,
  onForgot,
  onCancel,
}: {
  onSuccess: () => void;
  onForgot: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const isLocked = lockedUntil > now;

  // Escape closes the PIN window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    if (!isLocked) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isLocked]);

  const submit = async (value: string): Promise<void> => {
    if (await verifyPin(value)) {
      onSuccess();
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setPin("");
    if (nextAttempts >= MAX_ATTEMPTS) {
      setAttempts(0);
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setNow(Date.now());
      setError("יותר מדי ניסיונות. נסו שוב בעוד דקה.");
    } else {
      setError("הקוד לא נכון. נסו שוב.");
    }
  };

  const press = (digit: string): void => {
    if (isLocked || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    setError("");
    if (next.length === PIN_LENGTH) void submit(next);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" dir="rtl" role="dialog" aria-modal="true" aria-label="כניסת הורה / מטפל">
      <div className="w-full max-w-xs rounded-[2rem] bg-white p-6 text-center shadow-soft">
        <div className="text-4xl">🔒</div>
        <h2 className="mt-2 text-2xl font-black">כניסת הורה / מטפל</h2>
        <p className="mt-1 text-sm text-muted">הזינו את קוד ההורה (4 ספרות)</p>

        <div className="my-5 flex justify-center gap-3" dir="ltr">
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span
              key={index}
              className={`h-4 w-4 rounded-full border-2 border-slate-400 ${index < pin.length ? "bg-slate-900" : ""}`}
            />
          ))}
        </div>

        {error && <p className="mb-3 text-sm font-black text-red-700">{error}</p>}
        {isLocked && (
          <p className="mb-3 text-sm font-bold text-muted">
            אפשר לנסות שוב בעוד {Math.ceil((lockedUntil - now) / 1000)} שניות
          </p>
        )}

        <div className="grid grid-cols-3 gap-2" dir="ltr">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={isLocked}
              className="rounded-2xl bg-slate-100 py-4 text-2xl font-black active:bg-slate-200 disabled:opacity-40"
              onClick={() => press(digit)}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="rounded-2xl py-4 text-xl font-black text-slate-500"
            onClick={() => {
              setPin((current) => current.slice(0, -1));
              setError("");
            }}
            aria-label="מחיקה"
          >
            ⌫
          </button>
          <button
            type="button"
            disabled={isLocked}
            className="rounded-2xl bg-slate-100 py-4 text-2xl font-black active:bg-slate-200 disabled:opacity-40"
            onClick={() => press("0")}
          >
            0
          </button>
          <span />
        </div>

        <div className="mt-5 flex justify-between gap-2">
          <button type="button" className="text-sm font-black text-blue-700 underline" onClick={onForgot}>
            שכחתי את הקוד
          </button>
          <button type="button" className="text-sm font-black text-slate-600" onClick={onCancel}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function PinFields({
  pin,
  confirm,
  onPinChange,
  onConfirmChange,
}: {
  pin: string;
  confirm: string;
  onPinChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
}) {
  const clean = (value: string): string => value.replace(/\D/g, "").slice(0, PIN_LENGTH);
  return (
    <div className="grid max-w-md gap-2 sm:grid-cols-2">
      <label className="grid gap-1">
        <span className="text-xs font-black">קוד הורה (4 ספרות)</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          dir="ltr"
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-center text-base tracking-[0.5em]"
          value={pin}
          onChange={(event) => onPinChange(clean(event.target.value))}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-black">שוב, לאימות</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          dir="ltr"
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-center text-base tracking-[0.5em]"
          value={confirm}
          onChange={(event) => onConfirmChange(clean(event.target.value))}
        />
      </label>
    </div>
  );
}

export function ChildDevicePanel({
  enabled,
  childName,
  onChange,
}: {
  enabled: boolean;
  childName: string;
  onChange: (enabled: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [message, setMessage] = useState("");

  const savePin = async (): Promise<boolean> => {
    if (!isValidPin(pin)) {
      setMessage("הקוד צריך להיות בדיוק 4 ספרות.");
      return false;
    }
    if (pin !== confirm) {
      setMessage("שני הקודים לא זהים. נסו שוב.");
      return false;
    }
    try {
      await saveChildDevicePin(pin);
    } catch {
      setMessage("לא הצלחנו לשמור את הקוד במכשיר הזה.");
      return false;
    }
    setPin("");
    setConfirm("");
    return true;
  };

  return (
    <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm shadow-sm">
      <h2 className="text-lg font-black">📱 המסך של {childName || "הילד/ה"}</h2>
      {enabled ? (
        <>
          <p className="mt-2 font-bold text-sky-950">
            ✓ המכשיר הזה הוא המכשיר של {childName || "הילד/ה"}. הוא נפתח ישר ללוח התקשורת.
          </p>
          <p className="mt-1 text-sm text-muted">
            כדי להגיע להגדרות: לוחצים על &quot;🔒 מסך הורה / מורה&quot; בשורה העליונה של מסך הילד ומזינים את
            קוד ההורה.
          </p>
          {isChangingPin ? (
            <div className="mt-4 grid gap-3">
              <PinFields pin={pin} confirm={confirm} onPinChange={setPin} onConfirmChange={setConfirm} />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-black text-white"
                  onClick={() =>
                    void savePin().then((saved) => {
                      if (!saved) return;
                      setIsChangingPin(false);
                      setMessage("הקוד החדש נשמר ✓");
                    })
                  }
                >
                  שמירת קוד חדש
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black"
                  onClick={() => {
                    setIsChangingPin(false);
                    setMessage("");
                  }}
                >
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-2xl border border-sky-300 bg-white px-4 py-2 text-sm font-black text-sky-900"
                onClick={() => {
                  setIsChangingPin(true);
                  setMessage("");
                }}
              >
                שינוי קוד הורה
              </button>
              <button
                type="button"
                className="rounded-2xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-700"
                onClick={() => {
                  if (!window.confirm("להחזיר את המכשיר הזה למצב רגיל?")) return;
                  disableChildDevice();
                  onChange(false);
                  setMessage("המכשיר חזר למצב רגיל.");
                }}
              >
                ביטול מצב מכשיר של ילד
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-slate-700">
            זה המסך של {childName || "הילד/ה"}? הוא ייפתח ישר ללוח התקשורת, וההגדרות יהיו מוגנות בקוד הורה.
          </p>
          <div className="mt-3 grid gap-2">
            <PinFields pin={pin} confirm={confirm} onPinChange={setPin} onConfirmChange={setConfirm} />
            <button
              type="button"
              className="justify-self-start rounded-2xl bg-sky-600 px-4 py-2 text-sm font-black text-white"
              onClick={() =>
                void savePin().then((saved) => {
                  if (!saved) return;
                  onChange(true);
                  setMessage("המכשיר הוא עכשיו המכשיר של הילד ✓");
                })
              }
            >
              📱 הפוך למסך של {childName || "הילד/ה"}
            </button>
          </div>
        </>
      )}
      {message && <p className="mt-3 rounded-2xl bg-white p-3 text-sm font-bold text-sky-900">{message}</p>}
    </div>
  );
}
