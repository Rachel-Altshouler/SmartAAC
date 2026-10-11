import { NextResponse } from "next/server";
import { geminiTranscribeAudio, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqTranscribeAudio } from "@/lib/groq";
import { isOllamaWhisperAvailable, ollamaTranscribeAudio } from "@/lib/ollama";

type WhisperResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

async function transcribeWithOpenAi(audio: Blob): Promise<{ text?: string; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { error: "OPENAI_API_KEY is not configured" };
  }

  const extension = audio.type.includes("wav")
    ? "wav"
    : audio.type.includes("mp4")
      ? "mp4"
      : audio.type.includes("ogg")
        ? "ogg"
        : "webm";

  const openaiForm = new FormData();
  openaiForm.append("file", audio, `speech.${extension}`);
  openaiForm.append("model", "whisper-1");
  openaiForm.append("language", "he");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: openaiForm,
  });

  const data = (await response.json()) as WhisperResponse;

  if (!response.ok) {
    return { error: data.error?.message ?? "transcription failed" };
  }

  const text = data.text?.trim() ?? "";
  if (!text) {
    return { error: "empty transcript" };
  }

  return { text };
}

// Phrases Whisper "hears" in silence or faint noise. Dropped only when the
// recording was also quiet, so a child who clearly says "תודה" still gets it.
const STOCK_HALLUCINATIONS = new Set(["תודה", "תודה רבה", "תודה לכם", "תודה רבה לכם", "תודה שצפיתם", "תודה רבה שצפיתם"]);
const QUIET_PEAK = 0.08;

const isQuietHallucination = (text: string, peak: number): boolean =>
  peak < QUIET_PEAK && STOCK_HALLUCINATIONS.has(text.replace(/[.,!?״"'\s]+/g, " ").trim());

export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");
  // Loudest sample of the recording (0–1), measured in the browser; absent = unknown.
  const peakValue = Number(formData.get("peak"));
  const peak = Number.isFinite(peakValue) && formData.get("peak") !== null ? peakValue : 1;

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }

  if (await isOllamaWhisperAvailable()) {
    const ollamaResult = await ollamaTranscribeAudio(audio);
    if (ollamaResult.ok) {
      return NextResponse.json({ text: ollamaResult.text, provider: "ollama" });
    }
  }

  if (getGroqApiKey()) {
    const groqResult = await groqTranscribeAudio(audio);
    if (groqResult.ok && isQuietHallucination(groqResult.text, peak)) {
      return NextResponse.json({ error: "empty transcript" }, { status: 422 });
    }
    if (groqResult.ok) {
      return NextResponse.json({ text: groqResult.text, provider: "groq" });
    }
    if (groqResult.error === "empty transcript") {
      return NextResponse.json({ error: "empty transcript" }, { status: 422 });
    }
  }

  const openAiResult = await transcribeWithOpenAi(audio);
  if (openAiResult.text && isQuietHallucination(openAiResult.text, peak)) {
    return NextResponse.json({ error: "empty transcript" }, { status: 422 });
  }
  if (openAiResult.text) {
    return NextResponse.json({ text: openAiResult.text, provider: "openai" });
  }

  if (getGeminiApiKey()) {
    const geminiResult = await geminiTranscribeAudio(audio);
    if (geminiResult.ok) {
      return NextResponse.json({ text: geminiResult.text, provider: "gemini" });
    }
  }

  if (await isOllamaWhisperAvailable()) {
    return NextResponse.json(
      { error: "ollama transcription failed" },
      { status: 502 },
    );
  }

  if (!getGroqApiKey() && !getGeminiApiKey() && !process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error: "local speech unavailable",
        detail: "Install Ollama and run: ollama pull gemma4:e4b",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { error: openAiResult.error ?? "transcription failed" },
    { status: 502 },
  );
}
