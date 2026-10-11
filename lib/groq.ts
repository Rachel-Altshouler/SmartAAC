import { CHILD_AI_SYSTEM_PROMPT } from "@/lib/gemini";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const WHISPER_HEbrew_PROMPT =
  "תמלול בעברית של ילד או ילדה המדברים בקצרה. מילים נפוצות: רוצה, לא, עזרה, מים, אוכל, עייפה, לשחק, כיף, קשה.";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const DEFAULT_GROQ_WHISPER_MODEL = "whisper-large-v3";

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GroqWhisperResponse = {
  text?: string;
  segments?: Array<{ text?: string; no_speech_prob?: number; avg_logprob?: number }>;
  error?: {
    message?: string;
  };
};

export function getGroqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY?.trim() || undefined;
}

function getGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

function getGroqWhisperModel(): string {
  return process.env.GROQ_WHISPER_MODEL?.trim() || DEFAULT_GROQ_WHISPER_MODEL;
}

export async function groqChat(options: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  systemPrompt?: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    return { ok: false, error: "GROQ_API_KEY is not configured" };
  }

  try {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getGroqModel(),
        messages: [
          { role: "system", content: options.systemPrompt ?? CHILD_AI_SYSTEM_PROMPT },
          ...options.history.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          { role: "user", content: options.message },
        ],
        temperature: options.temperature ?? 0.85,
        max_tokens: 320,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    });

    const raw = await response.text();
    let data: GroqChatResponse;
    try {
      data = JSON.parse(raw) as GroqChatResponse;
    } catch {
      return { ok: false, error: "groq returned invalid response (network filter?)" };
    }

    if (!response.ok) {
      return { ok: false, error: data.error?.message ?? "groq request failed" };
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "empty groq response" };
    }

    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "groq unavailable";
    return { ok: false, error: message };
  }
}

export async function groqTranscribeAudio(
  audio: Blob,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    return { ok: false, error: "GROQ_API_KEY is not configured" };
  }

  const extension = audio.type.includes("wav")
    ? "wav"
    : audio.type.includes("mp4")
      ? "mp4"
      : audio.type.includes("ogg")
        ? "ogg"
        : "webm";

  const form = new FormData();
  form.append("file", audio, `speech.${extension}`);
  form.append("model", getGroqWhisperModel());
  form.append("language", "he");
  form.append("prompt", WHISPER_HEbrew_PROMPT);
  form.append("temperature", "0");
  // verbose_json carries a no-speech probability per segment: on a silent or
  // near-silent recording Whisper otherwise "hears" a stock phrase ("תודה.").
  form.append("response_format", "verbose_json");

  let response: Response;
  try {
    response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "groq transcription failed" };
  }

  const raw = await response.text();
  let data: GroqWhisperResponse;
  try {
    data = JSON.parse(raw) as GroqWhisperResponse;
  } catch {
    return { ok: false, error: "groq returned invalid response (network filter?)" };
  }

  if (!response.ok) {
    return { ok: false, error: data.error?.message ?? "groq transcription failed" };
  }

  const text = data.segments
    ? data.segments
        .filter((segment) => (segment.no_speech_prob ?? 0) < 0.6 && (segment.avg_logprob ?? 0) > -1)
        .map((segment) => segment.text?.trim() ?? "")
        .filter(Boolean)
        .join(" ")
        .trim()
    : (data.text?.trim() ?? "");
  if (!text) {
    return { ok: false, error: "empty transcript" };
  }

  return { ok: true, text };
}
