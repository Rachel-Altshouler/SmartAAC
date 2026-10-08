import { buildLocalChildAiAnswer } from "@/lib/local-ai";
import { NextResponse } from "next/server";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { isOllamaAvailable, ollamaChat } from "@/lib/ollama";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";

type ChildAiRequest = {
  message?: string;
  history?: ChildAiMessage[];
};

type ChildAiMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ChildAiRequest;
  const message = body.message?.trim() ?? "";
  const history = (body.history ?? [])
    .filter((item) => item.content.trim())
    .slice(-20);

  if (!message) {
    return NextResponse.json({ answer: "אפשר לכתוב משפט או לדבר ואז לשלוח." });
  }

  let lastError: string | undefined;

  if (await isOllamaAvailable()) {
    const ollamaResult = await ollamaChat({ history, message });
    if (ollamaResult.ok) {
      return NextResponse.json({ answer: ollamaResult.text, provider: "ollama" });
    }
  }

  if (getGroqApiKey()) {
    const groqResult = await groqChat({ history, message });
    if (groqResult.ok) {
      return NextResponse.json({ answer: groqResult.text, provider: "groq" });
    }
    lastError = groqResult.error;
  }

  if (getOpenAiApiKey()) {
    const openAiResult = await openAiChat({ history, message });
    if (openAiResult.ok) {
      return NextResponse.json({ answer: openAiResult.text, provider: "openai" });
    }
    lastError = openAiResult.error;
  }

  if (getGeminiApiKey()) {
    const geminiResult = await geminiChat({ history, message });
    if (geminiResult.ok) {
      return NextResponse.json({ answer: geminiResult.text, provider: "gemini" });
    }
    lastError = geminiResult.error;
  }

  return NextResponse.json({
    answer: buildLocalChildAiAnswer(message, history),
    provider: "local",
    error: lastError ?? "ai providers unavailable",
  });
}
