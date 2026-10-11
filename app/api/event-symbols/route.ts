import { NextResponse } from "next/server";
import { buildEventSymbolsPrompt, parseEventSymbols } from "@/lib/event-symbols";
import { geminiChat, getGeminiApiKey } from "@/lib/gemini";
import { getGroqApiKey, groqChat } from "@/lib/groq";
import { getOpenAiApiKey, openAiChat } from "@/lib/openai";

type EventSymbolsRequest = {
  event?: { title?: unknown; typeLabel?: unknown; when?: unknown };
  vocabulary?: unknown;
};

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export async function POST(request: Request): Promise<NextResponse> {
  let body: EventSymbolsRequest;
  try {
    body = (await request.json()) as EventSymbolsRequest;
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const title = text(body.event?.title, 80);
  const typeLabel = text(body.event?.typeLabel, 30);
  const when = text(body.event?.when, 30);
  const vocabulary = (Array.isArray(body.vocabulary) ? body.vocabulary : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { id: text(record.id, 60), label: text(record.label, 30) };
    })
    .filter((item) => item.id && item.label)
    .slice(0, 400);

  if (!title || vocabulary.length === 0) {
    return NextResponse.json({ result: null, provider: "local" });
  }

  const knownIds = new Set(vocabulary.map((item) => item.id));
  const message = [
    `האירוע: ${title}${typeLabel ? ` (${typeLabel})` : ""}`,
    `מתי: ${when || "בקרוב"}`,
    `הסמלים בלוח (מזהה=מילה): ${vocabulary.map((item) => `${item.id}=${item.label}`).join(", ")}`,
  ].join("\n");
  const systemPrompt = buildEventSymbolsPrompt();

  const providers = [
    {
      name: "gemini",
      enabled: Boolean(getGeminiApiKey()),
      run: () => geminiChat({ history: [], message, systemPrompt, temperature: 0.3, maxOutputTokens: 800 }),
    },
    {
      name: "groq",
      enabled: Boolean(getGroqApiKey()),
      run: () => groqChat({ history: [], message, systemPrompt, temperature: 0.3 }),
    },
    {
      name: "openai",
      enabled: Boolean(getOpenAiApiKey()),
      run: () => openAiChat({ history: [], message, systemPrompt, temperature: 0.3 }),
    },
  ];

  for (const provider of providers) {
    if (!provider.enabled) continue;
    const answer = await provider.run();
    const result = answer.ok ? parseEventSymbols(answer.text, knownIds) : null;
    if (result) return NextResponse.json({ result, provider: provider.name });
  }

  return NextResponse.json({ result: null, provider: "local" });
}
