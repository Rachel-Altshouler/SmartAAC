import { NextResponse } from "next/server";
import { isProviderSkipped, noteProviderFailure } from "@/lib/provider-health";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 },
    );
  }

  // Out of credit a moment ago: answer at once, so the browser voice speaks
  // instead of the child waiting for the same failure again.
  if (isProviderSkipped("openai-voice")) {
    return NextResponse.json(
      { error: "speech synthesis failed", detail: "insufficient_quota" },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim() ?? "";

  if (!text) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: text,
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    noteProviderFailure("openai-voice", message);
    return NextResponse.json({ error: "speech synthesis failed", detail: message }, { status: 502 });
  }

  if (!response.ok) {
    const openaiError = await response.text();
    noteProviderFailure("openai-voice", openaiError);
    return NextResponse.json(
      { error: "speech synthesis failed", detail: openaiError.slice(0, 500) },
      { status: 502 },
    );
  }

  const audioBuffer = await response.arrayBuffer();

  return new NextResponse(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
