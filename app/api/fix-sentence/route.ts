import { NextResponse } from "next/server";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";
import {
  buildGrammarSystemPrompt,
  localFixSentence,
  parseFixedSentence,
  type ChildGender,
} from "@/lib/hebrew-grammar";

type FixSentenceRequest = {
  words?: unknown;
  gender?: unknown;
};

const MAX_WORDS = 20;

export async function POST(request: Request): Promise<NextResponse> {
  let body: FixSentenceRequest;
  try {
    body = (await request.json()) as FixSentenceRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const words = (Array.isArray(body.words) ? body.words : [])
    .filter((word): word is string => typeof word === "string")
    .map((word) => word.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const gender: ChildGender = body.gender === "girl" ? "girl" : "boy";

  if (words.length === 0) {
    return NextResponse.json({ sentence: "", provider: "local" });
  }

  const fallback = localFixSentence(words, gender);
  if (words.length === 1) {
    return NextResponse.json({ sentence: fallback, provider: "local" });
  }

  const systemPrompt = buildGrammarSystemPrompt(gender);
  const message = `המילים שנבחרו, לפי הסדר: ${words.join(" | ")}`;

  // Fastest provider first — the child is waiting to hear their sentence.
  const providers: Array<{
    name: string;
    enabled: boolean;
    run: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  }> = [
    {
      name: "groq",
      enabled: Boolean(getGroqApiKey()),
      run: () => groqChat({ history: [], message, systemPrompt, temperature: 0.1 }),
    },
    {
      name: "gemini",
      enabled: Boolean(getGeminiApiKey()),
      run: () => geminiChat({ history: [], message, systemPrompt, temperature: 0.1 }),
    },
    {
      name: "openai",
      enabled: Boolean(getOpenAiApiKey()),
      run: () => openAiChat({ history: [], message, systemPrompt, temperature: 0.1 }),
    },
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;
    const result = await provider.run();
    if (!result.ok) continue;
    const sentence = parseFixedSentence(result.text);
    if (sentence) {
      return NextResponse.json({ sentence, provider: provider.name });
    }
  }

  return NextResponse.json({ sentence: fallback, provider: "local" });
}
