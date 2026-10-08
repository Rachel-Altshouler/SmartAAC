import { CHILD_AI_SYSTEM_PROMPT } from "@/lib/gemini";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_OLLAMA_WHISPER_MODEL = "gemma4:e4b";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

type OllamaTranscriptionResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

export function getOllamaBaseUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_URL;

  try {
    const url = new URL(raw);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      return DEFAULT_OLLAMA_URL;
    }
    return url.origin;
  } catch {
    return DEFAULT_OLLAMA_URL;
  }
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

export function getOllamaWhisperModel(): string {
  return process.env.OLLAMA_WHISPER_MODEL?.trim() || DEFAULT_OLLAMA_WHISPER_MODEL;
}

async function listOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? [])
      .map((model) => model.name?.trim() ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function isOllamaWhisperAvailable(): Promise<boolean> {
  if (!(await isOllamaAvailable())) return false;
  const whisperModel = getOllamaWhisperModel();
  const targetBase = whisperModel.split(":")[0] ?? whisperModel;
  const models = await listOllamaModels();
  return models.some(
    (name) =>
      name === whisperModel ||
      name.startsWith(`${whisperModel}:`) ||
      name.startsWith(`${targetBase}:`),
  );
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ollamaChat(options: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  systemPrompt?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();

  const messages = [
    { role: "system", content: options.systemPrompt ?? CHILD_AI_SYSTEM_PROMPT },
    ...options.history.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    { role: "user", content: options.message },
  ];

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.85,
          num_predict: 320,
        },
      }),
      signal: AbortSignal.timeout(90000),
    });

    const data = (await response.json()) as OllamaChatResponse;

    if (!response.ok) {
      return { ok: false, error: data.error ?? "ollama request failed" };
    }

    const text = data.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "empty ollama response" };
    }

    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ollama unavailable";
    return { ok: false, error: message };
  }
}

export async function ollamaTranscribeAudio(
  audio: Blob,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!(await isOllamaWhisperAvailable())) {
    return { ok: false, error: "ollama whisper model not available" };
  }

  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaWhisperModel();

  const form = new FormData();
  form.append("file", audio, "speech.wav");
  form.append("model", model);
  form.append("language", "he");

  try {
    const transcriptionResponse = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: "Bearer ollama" },
      body: form,
      signal: AbortSignal.timeout(120000),
    });

    if (transcriptionResponse.ok) {
      const data = (await transcriptionResponse.json()) as OllamaTranscriptionResponse;
      const text = data.text?.trim() ?? "";
      if (text) return { ok: true, text };
    }

    const buffer = await audio.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content:
              "תמלל/י את הדיבור בעברית מהקלטה. החזר/י רק את התמלול בעברית, בלי הסברים.",
            images: [base64],
          },
        ],
        stream: false,
        options: { num_ctx: 8192, temperature: 0 },
      }),
      signal: AbortSignal.timeout(120000),
    });

    const chatData = (await chatResponse.json()) as OllamaChatResponse;
    if (!chatResponse.ok) {
      return { ok: false, error: chatData.error ?? "ollama transcription failed" };
    }

    const text = chatData.message?.content?.trim() ?? "";
    if (!text) {
      return { ok: false, error: "empty ollama transcript" };
    }

    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ollama transcription unavailable";
    return { ok: false, error: message };
  }
}
