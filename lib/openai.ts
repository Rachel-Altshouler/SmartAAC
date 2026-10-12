import { CHILD_AI_SYSTEM_PROMPT } from "@/lib/gemini";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export function getOpenAiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export async function openAiChat(options: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
  // Longer answers (a whole story) need more than the chat's short reply.
  maxTokens?: number;
  // Ask for a JSON object only (the prompt must mention JSON).
  json?: boolean;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not configured" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        messages: [
          { role: "system", content: options.systemPrompt ?? CHILD_AI_SYSTEM_PROMPT },
          ...options.history.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          { role: "user", content: options.message },
        ],
        temperature: options.temperature ?? 0.85,
        max_tokens: options.maxTokens ?? 320,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    });

    const raw = await response.text();
    let data: OpenAiChatResponse;
    try {
      data = JSON.parse(raw) as OpenAiChatResponse;
    } catch {
      return { ok: false, error: "openai returned invalid response (network filter?)" };
    }

    if (!response.ok) {
      return { ok: false, error: data.error?.message ?? "openai request failed" };
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "empty openai response" };
    }

    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "openai unavailable";
    return { ok: false, error: message };
  }
}
