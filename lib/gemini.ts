const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

const GEMINI_MODEL_FALLBACKS = [
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
] as const;

export const CHILD_AI_SYSTEM_PROMPT = [
  "אתה חבר שיחה חם וסבלני של ילד צעיר שמתקשה לדבר ומשתמש בלוח תקשורת.",
  "ענה בעברית תקינה ופשוטה מאוד, כמו שמדברים עם ילד בגן: 2-3 משפטים קצרים, מילים של יום-יום, בלי ניבים ובלי מילים גבוהות.",
  "התייחס בדיוק למה שנאמר עכשיו. אל תמציא דברים, ואל תגיד שהילד סיפר לך משהו אם זה לא כתוב בשיחה.",
  "סיים בשאלה אחת קצרה, או הצע 2-3 אפשרויות לבחירה. אם המשפט לא ברור, נחש בעדינות ושאל אם הבנת נכון.",
  "אל תחזור על משפטים שכבר אמרת. בלי רשימות, בלי שורות ריקות ובלי צורות עם קו נטוי (כמו את/ה).",
  "אל תיתן ייעוץ רפואי.",
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
    timeoutMs?: number;
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
      signal: AbortSignal.timeout(options?.timeoutMs ?? 20000),
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
    timeoutMs?: number;
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
  timeoutMs?: number;
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
    timeoutMs: options.timeoutMs,
    models: options.models,
  });
}

// Looks at a photo (a data: URL) and answers the prompt about it.
export async function geminiDescribeImage(
  dataUrl: string,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) return { ok: false, error: "not an image" };
  return geminiGenerate(
    [{ role: "user", parts: [{ inline_data: { mime_type: match[1] as string, data: match[2] as string } }, { text: prompt }] }],
    { temperature: 0.4, maxOutputTokens: 700 },
  );
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
    // Thinking off: a transcript needs none, and it was most of the wait.
    { temperature: 0, maxOutputTokens: 256, thinkingBudget: 0 },
  );
}
