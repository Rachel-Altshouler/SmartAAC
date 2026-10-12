"use client";

import { useRef, useState } from "react";
import { arasaacImageUrl, symbols } from "@/lib/demo-data";
import { genderWord } from "@/lib/hebrew-grammar";
import { buildLocalChildAiAnswer } from "@/lib/local-ai";
import { cx, stripEmoji, speakHebrew } from "@/components/smartaac/shared";

const isOpenAiQuotaError = (message?: string): boolean => {
  const text = (message ?? "").toLowerCase();
  return text.includes("insufficient_quota") || text.includes("exceeded your current quota");
};

const openAiQuotaMessage =
  "נגמרה המכסה של OpenAI. הוסיפ/י GEMINI_API_KEY (חינם) ל-.env.local מ-aistudio.google.com";

const aiApiErrorMessage = (error?: string, detail?: string): string => {
  const combined = `${error ?? ""} ${detail ?? ""}`.toLowerCase();
  if (isOpenAiQuotaError(combined)) return openAiQuotaMessage;
  if (combined.includes("network filter") || combined.includes("invalid response")) {
    return "Groq/Gemini חסומים ברשת. התקינ/י Ollama מקומי: ollama pull llama3.2";
  }
  if (error === "GROQ_API_KEY is not configured") {
    return "חסר GROQ_API_KEY. קבל/י מפתח חינם ב-console.groq.com/keys";
  }
  if (error === "GEMINI_API_KEY is not configured") {
    return "חסר GEMINI_API_KEY. קבל/י מפתח חינם ב-aistudio.google.com/apikey";
  }
  if (combined.includes("api key not valid") || combined.includes("invalid api key")) {
    return "מפתח GEMINI_API_KEY לא תקין. קבל/י מפתח חדש ב-aistudio.google.com/apikey ורעננ/י את השרת.";
  }
  if (combined.includes("quota") || combined.includes("rate limit") || combined.includes("resource exhausted")) {
    return "נגמרה מכסת Gemini (חינם). נס/י: מפתח חדש ב-aistudio.google.com/apikey, GEMINI_MODEL=gemini-2.0-flash-lite, או כתיבת המשפט במקום דיבור.";
  }
  if (error === "gemini transcription failed" || combined.includes("gemini")) {
    return `שגיאת Gemini: ${detail?.trim() || error?.trim() || "בדק/י GEMINI_API_KEY ו-GEMINI_MODEL ב-.env.local"}`;
  }
  return "";
};

const speechApiErrorMessage = (error?: string, detail?: string): string => {
  const aiMessage = aiApiErrorMessage(error, detail);
  if (aiMessage) return aiMessage;
  const combined = `${error ?? ""} ${detail ?? ""}`;
  if (error === "OPENAI_API_KEY is not configured") {
    return "חסר מפתח AI. הוסיפ/י GEMINI_API_KEY (חינם) ל-.env.local";
  }
  if (error === "local speech unavailable" || detail?.includes("gemma4")) {
    return "דיבור מקומי דורש Ollama + מודל gemma4:e4b. הריצ/י: ollama pull gemma4:e4b";
  }
  if (error === "ollama whisper model not available") {
    return "חסר מודל דיבור ב-Ollama. הריצ/י: ollama pull gemma4:e4b";
  }
  if (error === "empty transcript") {
    return "לא שמעתי מילים. דבר/י קרוב יותר למיקרופון ונס/י שוב.";
  }
  return "לא הצלחתי להבין את הדיבור. נס/י שוב, או כתב/י את המשפט.";
};

const audioExtensionForMime = (mimeType: string): string => {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
};

const SPEECH_SAMPLE_RATE = 44100;
const MIN_RECORDING_MS = 700;

const getSpeechRecognition = (): SpeechRecognitionInstance | null => {
  if (typeof window === "undefined") return null;
  const SpeechRecognitionCtor =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return null;

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "he-IL";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  return recognition;
};

const pickBestTranscript = (results: SpeechRecognitionResultList): string => {
  let best = "";
  let bestConfidence = -1;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (!result.isFinal && i < results.length - 1) continue;

    for (let j = 0; j < result.length; j++) {
      const alternative = result[j];
      if (alternative.confidence >= bestConfidence) {
        bestConfidence = alternative.confidence;
        best = alternative.transcript;
      }
    }
  }

  if (best.trim()) return best.trim();

  let fallback = "";
  for (let i = 0; i < results.length; i++) {
    fallback += results[i][0]?.transcript ?? "";
  }
  return fallback.trim();
};

const normalizeAudio = (samples: Float32Array): Float32Array => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak < 0.02) return samples;

  const gain = Math.min(0.95 / peak, 4);
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = Math.max(-1, Math.min(1, samples[i] * gain));
  }
  return normalized;
};

const resampleMono = (
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (sourceRate === targetRate) return samples;

  const ratio = sourceRate / targetRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const weight = position - index;
    result[i] = samples[index] * (1 - weight) + samples[next] * weight;
  }

  return result;
};

const encodeWavBlob = (samples: Float32Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

// Peak level (0–1) under which a recording is treated as silence.
const SILENCE_PEAK = 0.02;

const recordingToWavBlob = async (blob: Blob): Promise<{ wav: Blob; peak: number }> => {
  const audioContext = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = new Float32Array(audioBuffer.length);

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < audioBuffer.length; i++) {
        mono[i] += channelData[i] / audioBuffer.numberOfChannels;
      }
    }

    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));

    const resampled = resampleMono(mono, audioBuffer.sampleRate, SPEECH_SAMPLE_RATE);
    const normalized = normalizeAudio(resampled);
    return { wav: encodeWavBlob(normalized, SPEECH_SAMPLE_RATE), peak };
  } finally {
    await audioContext.close();
  }
};

type ChildAiResponse = {
  answer?: string;
  note?: string;
  error?: string;
  provider?: string;
};

type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function VoiceAssistantView({
  onBack,
  onSpeak,
  speechRate,
  childGender,
}: {
  onBack: () => void;
  onSpeak: (text: string) => void;
  speechRate: number;
  childGender: "boy" | "girl";
}) {
  const welcome = `שלום, אני כאן כדי לדבר איתך. מה ${childGender === "girl" ? "תרצי" : "תרצה"} לספר לי?`;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: welcome,
    },
  ]);
  const [answer, setAnswer] = useState(welcome);
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  // The recording is on its way to text: shown on screen, so the wait doesn't
  // look like nothing happened.
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Status notes ("מצב בסיסי…", mic problems) are not shown to the child —
  // they only go to the developer console.
  const setSpeechHint = (note: string): void => {
    if (note) console.info("smartaac:", note);
  };
  // What the child does see when a recording didn't turn into text — short
  // and friendly, never technical (the details go to the console above).
  const [speechProblem, setSpeechProblem] = useState("");
  const COULD_NOT_HEAR = "😕 לא הצלחתי לשמוע. אפשר לנסות שוב, או לכתוב.";
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Live microphone level (0–1) while recording, so the user sees whether the
  // mic actually hears them — a silent mic is why recordings came back "תודה".
  const [micLevel, setMicLevel] = useState(0);
  const [micSilent, setMicSilent] = useState(false);
  const meterStopRef = useRef<(() => void) | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const replyAudioRef = useRef<HTMLAudioElement | null>(null);
  const openAiSpeechBlockedRef = useRef(false);

  const speakReply = async (rawText: string): Promise<void> => {
    const text = stripEmoji(rawText);
    if (!text) return;

    if (!openAiSpeechBlockedRef.current) {
      try {
        const response = await fetch("/api/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          // the child shouldn't wait in silence: past this, the browser voice speaks
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          window.speechSynthesis.cancel();
          replyAudioRef.current?.pause();
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          replyAudioRef.current = audio;
          audio.onended = () => URL.revokeObjectURL(url);
          try {
            await audio.play();
            return;
          } catch {
            URL.revokeObjectURL(url);
          }
        }

        // Out of credit or unreachable: the next replies go straight to the
        // browser voice instead of waiting for the same failure.
        openAiSpeechBlockedRef.current = true;
      } catch {
        openAiSpeechBlockedRef.current = true;
      }
    }

    speakHebrew(text, speechRate);
  };

  const appendAssistantMessage = (content: string): void => {
    setAnswer(content);
    setMessages((current) => [
      ...current,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content,
      },
    ]);
    void speakReply(content);
  };

  const answerChild = async (text: string): Promise<void> => {
    const cleanText = text.trim();
    if (!cleanText) {
      const emptyAnswer = "אפשר לכתוב לי משפט קצר, ואני אמשיך איתך את השיחה.";
      setAnswer(emptyAnswer);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-empty-${Date.now()}`,
          role: "assistant",
          content: emptyAnswer,
        },
      ]);
      void speakReply(emptyAnswer);
      return;
    }

    const userMessage: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: cleanText,
    };
    const historyForRequest = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    setMessages((current) => [...current, userMessage]);
    setMessage("");
    setIsThinking(true);

    try {
      const response = await fetch("/api/child-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: cleanText,
          history: historyForRequest,
          gender: childGender,
        }),
      });
      const data = response.ok ? ((await response.json()) as ChildAiResponse) : {};
      if (data.provider === "local") {
        const hint = data.error ? aiApiErrorMessage(data.error) : "";
        setSpeechHint(
          hint ||
            "מצב בסיסי: AI בענן לא זמין. התשובות מוגבלות — נס/י Ollama מקומי או מפתח Groq/Gemini.",
        );
      } else if (data.error) {
        const hint = aiApiErrorMessage(data.error);
        if (hint) setSpeechHint(hint);
      } else {
        setSpeechHint("");
      }
      const nextAnswer =
        data.answer?.trim() || buildLocalChildAiAnswer(cleanText, [...messages, userMessage], childGender);
      const assistantMessage: AiChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: nextAnswer,
      };

      setMessages((current) => [...current, assistantMessage]);
      setAnswer(nextAnswer);
      void speakReply(nextAnswer);
    } catch {
      const fallback = buildLocalChildAiAnswer(cleanText, [...messages, userMessage], childGender);
      const assistantMessage: AiChatMessage = {
        id: `assistant-fallback-${Date.now()}`,
        role: "assistant",
        content: fallback,
      };
      setMessages((current) => [...current, assistantMessage]);
      setAnswer(fallback);
      void speakReply(fallback);
    } finally {
      setIsThinking(false);
    }
  };

  const stopRecording = (): void => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const startBrowserSpeechRecognition = (): boolean => {
    const recognition = getSpeechRecognition();
    if (!recognition) return false;

    recognition.onresult = (event) => {
      const transcript = pickBestTranscript(event.results);
      if (!transcript) return;

      setMessage(transcript);
      setSpeechHint("בדק/י את הטקסט, תקנ/י אם צריך, ולחצ/י שלח.");
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      if (event.error === "no-speech") {
        setSpeechHint("לא שמעתי דיבור. דבר/י קרוב יותר למיקרופון ונס/י שוב.");
        return;
      }
      setSpeechHint("זיהוי דיבור בדפדפן נכשל. נס/י שוב או כתב/י את המשפט.");
    };

    recognition.onend = () => {
      speechRecognitionRef.current = null;
      setIsRecording(false);
    };

    try {
      speechRecognitionRef.current = recognition;
      recordingStartedAtRef.current = Date.now();
      recognition.start();
      return true;
    } catch {
      speechRecognitionRef.current = null;
      return false;
    }
  };

  const startRecording = async (): Promise<void> => {
    if (isRecording || isThinking || isTranscribing) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSpeechHint("הדפדפן לא תומך בהקלטת דיבור");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 44100 },
        },
      });
      micStreamRef.current = stream;
      audioChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();

      try {
        const meterContext = new AudioContext();
        const analyser = meterContext.createAnalyser();
        analyser.fftSize = 1024;
        meterContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let loudest = 0;
        let frame = 0;
        const startedAt = Date.now();
        const tick = (): void => {
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
          loudest = Math.max(loudest, peak);
          setMicLevel(Math.min(1, peak * 4));
          // after 2.5 s with nothing above a whisper, warn while still recording
          setMicSilent(Date.now() - startedAt > 2500 && loudest < SILENCE_PEAK);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        meterStopRef.current = () => {
          cancelAnimationFrame(frame);
          void meterContext.close();
          setMicLevel(0);
        };
      } catch {
        // no meter — recording still works
      }

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        meterStopRef.current?.();
        meterStopRef.current = null;
        setMicSilent(false);
        micStreamRef.current?.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);

        const recordingMs = Date.now() - recordingStartedAtRef.current;
        if (recordingMs < MIN_RECORDING_MS) {
          setSpeechHint("ההקלטה קצרה מדי. לחצ/י שוב ודבר/י לפחות שנייה.");
          return;
        }

        setSpeechHint("מעבד את הדיבור...");

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];

        if (blob.size === 0) {
          setSpeechHint("לא נקלט דיבור. לחצ/י שוב על התחלת דיבור ודבר/י.");
          return;
        }

        setIsTranscribing(true);
        void (async () => {
          try {
            let uploadBlob: Blob = blob;
            let fileName = `speech.${audioExtensionForMime(mimeType)}`;
            let recordingPeak: number | null = null;

            try {
              const converted = await recordingToWavBlob(blob);
              if (converted.peak < SILENCE_PEAK) {
                // Don't send silence: the speech model would invent words for it.
                setSpeechHint(
                  "לא שמעתי קול בהקלטה. דבר/י קרוב יותר, ובדק/י שבחרת את המיקרופון הנכון (סמל המנעול ליד כתובת האתר).",
                );
                return;
              }
              uploadBlob = converted.wav;
              fileName = "speech.wav";
              recordingPeak = converted.peak;
            } catch {
              // keep original recording for cloud fallbacks
            }

            const formData = new FormData();
            formData.append("audio", uploadBlob, fileName);
            if (recordingPeak !== null) formData.append("peak", String(recordingPeak));

            const response = await fetch("/api/speech-to-text", {
              method: "POST",
              body: formData,
              // a slow or filtered network: don't keep the child waiting
              signal: AbortSignal.timeout(20000),
            });
            const data = (await response.json()) as {
              text?: string;
              error?: string;
              detail?: string;
            };

            if (!response.ok || !data.text?.trim()) {
              setSpeechProblem(COULD_NOT_HEAR);
              const combined = `${data.error ?? ""} ${data.detail ?? ""}`;
              if (isOpenAiQuotaError(combined)) {
                setSpeechHint(`${openAiQuotaMessage}, ורעננ/י את הדף. אפשר גם לכתוב את המשפט.`);
                return;
              }
              setSpeechHint(speechApiErrorMessage(data.error, data.detail));
              return;
            }

            setMessage(data.text);
            setSpeechProblem("");
            setSpeechHint("בדק/י את הטקסט, תקנ/י אם צריך, ולחצ/י שלח.");
          } catch {
            setSpeechProblem(COULD_NOT_HEAR);
            setSpeechHint("שגיאה בשליחת הדיבור. נס/י לכתוב וללחוץ שלח.");
          } finally {
            setIsTranscribing(false);
          }
        })();
      };

      recorder.start(250);
      setSpeechProblem("");
      setIsRecording(true);
      setSpeechHint("מקליט... דבר/י, ואז לחצ/י סיום דיבור");
    } catch {
      setSpeechProblem("🎤 צריך לאשר את המיקרופון בדפדפן, או לכתוב.");
      setSpeechHint("מיקרופון לא מאושר");
    }
  };

  const toggleSpeech = (): void => {
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  };


  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <div>
          <h2 className="text-3xl font-black">🗣️ שיחה חכמה</h2>
          <p className="text-muted">
            הילד מדבר או כותב, והמערכת עונה בקול בשפה פשוטה.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-3 rounded-[1.5rem] bg-slate-50 p-4">
            {messages.map((item) => (
              <div
                key={item.id}
                className={cx(
                  "max-w-[88%] rounded-2xl px-4 py-3 text-lg font-bold leading-8 shadow-sm",
                  item.role === "user"
                    ? "mr-auto bg-blue-600 text-white"
                    : "ml-auto bg-white text-slate-900",
                )}
              >
                <span className="mb-1 block text-xs font-black opacity-70">
                  {item.role === "user" ? "אני" : "החבר החכם"}
                </span>
                {item.content}
              </div>
            ))}
            {isThinking && (
              <div className="ml-auto flex max-w-[88%] items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm">
                <span className="text-xl">🤔</span>
                <span className="flex gap-1">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            )}
          </div>

          <label className="mb-2 block text-sm font-black text-muted">
            המשך שיחה
          </label>
          <div className="relative">
            <textarea
              className="min-h-36 w-full rounded-2xl border border-slate-200 p-4 text-xl"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setSpeechProblem("");
              }}
              placeholder={isTranscribing ? "" : "אפשר לכתוב כאן או להקליט במיקרופון"}
              disabled={isTranscribing}
            />
            {isTranscribing && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-xl font-black text-slate-500">
                <span>✍️ כותב את מה שאמרת</span>
                <span className="flex gap-1">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-400" />
                </span>
              </div>
            )}
          </div>
          {speechProblem && !isTranscribing && (
            <p className="mt-2 rounded-2xl bg-amber-50 px-4 py-2 text-lg font-bold text-amber-900">{speechProblem}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={cx("rounded-2xl px-6 py-4 text-lg font-black text-white shadow-soft disabled:opacity-60", isRecording ? "bg-red-500" : "bg-emerald-500")}
              onClick={toggleSpeech}
              disabled={isThinking || isTranscribing}
            >
              {isRecording ? "⏹ סיום דיבור" : "🎤 התחלת דיבור"}
            </button>
            {isRecording && (
              <div className="flex min-w-40 flex-col justify-center gap-1" aria-label="עוצמת המיקרופון">
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={cx("h-full rounded-full transition-[width]", micSilent ? "bg-red-400" : "bg-emerald-500")}
                    style={{ width: `${Math.max(4, Math.round(micLevel * 100))}%` }}
                  />
                </div>
                <span className={cx("text-xs font-bold", micSilent ? "text-red-700" : "text-muted")}>
                  {micSilent ? "המיקרופון לא קולט קול" : "המיקרופון שומע אותך"}
                </span>
              </div>
            )}
            <button
              type="button"
              className="rounded-2xl bg-blue-500 px-6 py-4 text-lg font-black text-white shadow-soft disabled:opacity-60"
              onClick={() => {
                void answerChild(message);
              }}
              disabled={isThinking || isTranscribing}
            >
              {isThinking ? "🤔 חושב..." : "📤 שלח"}
            </button>
          </div>
          <div className="mt-4 flex gap-1.5">
            {[
              { text: "אני רוצה מים", symbolIds: ["i", "want", "water"] },
              { text: `אני ${genderWord("עייף", childGender)}`, symbolIds: ["i", "tired"] },
              { text: "קשה לי", symbolIds: ["i", "help"] },
              { text: "אני רוצה לשחק", symbolIds: ["i", "want", "play"] },
            ].map((starter) => (
              // Pictures first, so a child who can't read can pick one.
              <button
                key={starter.text}
                type="button"
                className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl border-2 border-slate-200 bg-white px-1 py-1.5 shadow-sm transition active:scale-95"
                onClick={() => {
                  setMessage(starter.text);
                  void answerChild(starter.text);
                }}
                aria-label={starter.text}
              >
                <span className="flex items-end gap-0.5" aria-hidden>
                  {starter.symbolIds.map((symbolId) => {
                    const symbol = symbols.find((item) => item.id === symbolId);
                    return symbol?.pictogramId ? (
                      <img
                        key={symbolId}
                        src={arasaacImageUrl(symbol.pictogramId)}
                        alt=""
                        className="h-7 w-7 rounded object-contain sm:h-8 sm:w-8"
                      />
                    ) : (
                      <span key={symbolId} className="text-2xl leading-8">
                        {symbol?.emoji}
                      </span>
                    );
                  })}
                </span>
                <span className="truncate text-[11px] font-bold text-slate-500">{starter.text}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
          <h3 className="mb-3 text-xl font-black">התשובה האחרונה</h3>
          <p className="rounded-2xl bg-white p-5 text-2xl font-black leading-10 shadow-sm">
            {answer}
          </p>
          <button
            type="button"
            className="mt-4 rounded-2xl bg-slate-950 px-6 py-4 font-black text-white"
            onClick={() => { void speakReply(answer); }}
          >
            🔊 הקרא שוב
          </button>
          <button
            type="button"
            className="mt-3 block rounded-2xl bg-white px-6 py-4 font-black text-slate-900 shadow-sm"
            onClick={() => {
              setMessages([
                {
                  id: `welcome-${Date.now()}`,
                  role: "assistant",
                  content: "פתחתי שיחה חדשה. על מה תרצי לדבר?",
                },
              ]);
              setAnswer("פתחתי שיחה חדשה. על מה תרצי לדבר?");
              setMessage("");
            }}
          >
            שיחה חדשה
          </button>
        </section>
      </div>
    </div>
  );
}
