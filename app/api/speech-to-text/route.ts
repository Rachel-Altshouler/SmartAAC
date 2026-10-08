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

export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get("audio");

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
    if (groqResult.ok) {
      return NextResponse.json({ text: groqResult.text, provider: "groq" });
    }
  }

  const openAiResult = await transcribeWithOpenAi(audio);
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
