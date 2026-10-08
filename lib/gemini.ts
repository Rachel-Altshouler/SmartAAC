const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

const GEMINI_MODEL_FALLBACKS = [
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
] as const;

export const CHILD_AI_SYSTEM_PROMPT = [
  "אתה חבר שיחה חם, סבלני וטבעי לילד/ה המשתמש/ת ב-AAC.",
  "דבר בעברית פשוטה וחמה, 2-4 משפטים קצרים.",
  "המשך שיחה אמיתית: התייחס למה שנאמר עכשיו וגם לשיחה הקודמת.",
  "אל תחזור על משפטים שכבר אמרת בשיחה. אל תחזור על אותה תבנית.",
  "אם המשפט קצר או לא ברור — נחש בזהירות, שאל שאלה פתוחה אחת, או הצע 2-3 אפשרויות.",
  "אל תיתן ייעוץ רפואי. היה מעודד, סבלני וזורם.",
].join(" ");

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiContent = {
  role?: "user" | "model";
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export function getGeminiApiKey(): string | undefined {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim();
  return key || undefined;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

function getGeminiModelCandidates(): string[] {
  const preferred = getGeminiModel();
  return [preferred, ...GEMINI_MODEL_FALLBACKS.filter((model) => model !== preferred)];
}

function isGeminiQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource exhausted") ||
    lower.includes("exceeded your current quota")
  );
}

async function geminiGenerateWithModel(
  model: string,
  contents: GeminiContent[],
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
  },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, error: "GEMINI_API_KEY is not configured" };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        ...(options?.systemPrompt
          ? { systemInstruction: { parts: [{ text: options.systemPrompt }] } }
          : {}),
        contents,
        generationConfig: {
          temperature: options?.temperature ?? 0.85,
          maxOutputTokens: options?.maxOutputTokens ?? 320,
          ...(options?.thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(20000),
    });

    const data = (await response.json()) as GeminiResponse;

    if (!response.ok) {
      return { ok: false, error: data.error?.message ?? "gemini request failed" };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "empty gemini response" };
    }

    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gemini request failed";
    return { ok: false, error: message };
  }
}

async function geminiGenerate(
  contents: GeminiContent[],
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
    models?: string[];
  },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!getGeminiApiKey()) {
    return { ok: false, error: "GEMINI_API_KEY is not configured" };
  }

  const models = options?.models ?? getGeminiModelCandidates();
  let lastError = "gemini request failed";

  for (const model of models) {
    const result = await geminiGenerateWithModel(model, contents, options);
    if (result.ok) {
      return result;
    }

    lastError = result.error;
    if (!isGeminiQuotaError(result.error)) {
      return result;
    }
  }

  return { ok: false, error: lastError };
}

export async function geminiChat(options: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  systemPrompt?: string;
  models?: string[];
  thinkingBudget?: number;
  maxOutputTokens?: number;
  temperature?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const contents: GeminiContent[] = [
    ...options.history.map((item) => ({
      role: (item.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: item.content }],
    })),
    { role: "user", parts: [{ text: options.message }] },
  ];

  return geminiGenerate(contents, {
    systemPrompt: options.systemPrompt ?? CHILD_AI_SYSTEM_PROMPT,
    temperature: options.temperature ?? 0.85,
    maxOutputTokens: options.maxOutputTokens ?? 320,
    thinkingBudget: options.thinkingBudget,
    models: options.models,
  });
}

export async function geminiTranscribeAudio(
  audio: Blob,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const buffer = await audio.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = audio.type.split(";")[0]?.trim() || "audio/webm";

  return geminiGenerate(
    [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64,
            },
          },
          {
            text: "תמלל/י את הדיבור בעברית מהקלטה הזו. החזר/י רק את התמלול בעברית, בלי הסברים.",
          },
        ],
      },
    ],
    { temperature: 0, maxOutputTokens: 256 },
  );
}
