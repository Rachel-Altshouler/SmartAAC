"use client";

import { useEffect, useRef, useState } from "react";
import { type StoryResult } from "@/lib/demo-data";
import {
  parseStory,
  pickLocalStory,
  STORY_ENDING_LINE,
  STORY_FEEDBACK,
  storyStepChoices,
  storyStepContinuation,
  storyStepSentence,
  type Story,
  type StoryChoice,
} from "@/lib/story-game";
import { readJsonResponse, today } from "@/components/smartaac/shared";

// How long a child who tapped "start" waits for an AI story still on its way.
const STORY_MAX_WAIT_MS = 15000;

async function loadAiStory(avoidTitles: string[]): Promise<Story | null> {
  try {
    const response = await fetch("/api/story-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avoidTitles }),
      // A bit over the server's worst case (Gemini racing OpenAI, then Groq),
      // so a slow-but-working AI still delivers. Stories are fetched ahead of
      // time, so the child rarely waits for this.
      signal: AbortSignal.timeout(35000),
    });
    const data = (await readJsonResponse(response)) as { story?: unknown };
    return data.story ? parseStory(data.story) : null;
  } catch {
    return null;
  }
}

export function StoryGameView({
  onBack,
  onSpeak,
  onStoryFinished,
}: {
  onBack: () => void;
  onSpeak: (text: string, onEnd?: () => void) => void;
  onStoryFinished: (result: StoryResult) => void;
}) {
  // Per-story tally for the progress page: right word on the first tap, and
  // how many wrong words were tapped along the way.
  const tallyRef = useRef({ title: "", firstTry: 0, wrongTaps: 0, answered: 0, reported: false });
  const onStoryFinishedRef = useRef(onStoryFinished);
  onStoryFinishedRef.current = onStoryFinished;

  // A story the child left in the middle still counts for the day, with the
  // words they got to.
  const reportPartial = (): void => {
    const tally = tallyRef.current;
    if (tally.reported || tally.answered === 0) return;
    tally.reported = true;
    onStoryFinishedRef.current({
      date: today(),
      title: tally.title,
      steps: tally.answered,
      firstTry: tally.firstTry,
      wrongTaps: tally.wrongTaps,
      partial: true,
    });
  };
  useEffect(() => () => reportPartial(), []);
  const [story, setStory] = useState<Story>(() => pickLocalStory());
  const [stepIndex, setStepIndex] = useState(0);
  // True once the current step's word was picked, while its full sentence is read.
  const [stepAnswered, setStepAnswered] = useState(false);
  // Whether the child picked a wrong word on this step before the right one.
  const [stepHadMistake, setStepHadMistake] = useState(false);
  const [choices, setChoices] = useState<StoryChoice[]>([]);
  const [narrating, setNarrating] = useState(false);
  const [finished, setFinished] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [playedTitles, setPlayedTitles] = useState<string[]>([]);
  // The story starts only when the child taps "start".
  const [started, setStarted] = useState(false);
  // The next AI story, asked for ahead of time: when the screen opens, and
  // again as each story starts, so "start" and "new story" rarely wait.
  const upcomingStoryRef = useRef<Promise<Story | null> | null>(null);
  useEffect(() => {
    upcomingStoryRef.current = loadAiStory([]);
  }, []);
  // Waits at most `maxWaitMs` for the story fetched ahead of time. One that is
  // still on its way stays for the next "new story" instead of being lost.
  const takeUpcomingStory = async (maxWaitMs: number): Promise<Story | null> => {
    const upcoming = upcomingStoryRef.current;
    upcomingStoryRef.current = null;
    if (!upcoming) return null;
    const timedOut = Symbol("timed out");
    const result = await Promise.race([
      upcoming,
      new Promise<typeof timedOut>((resolve) => window.setTimeout(() => resolve(timedOut), maxWaitMs)),
    ]);
    if (result !== timedOut) return result;
    upcomingStoryRef.current ??= upcoming;
    return null;
  };

  const playStep = (index: number, current: Story): void => {
    const step = current.steps[index];
    setStepAnswered(false);
    setStepHadMistake(false);
    if (!step) {
      setStepIndex(current.steps.length);
      setNarrating(false);
      setFinished(true);
      if (!tallyRef.current.reported) {
        tallyRef.current.reported = true;
        onStoryFinished({
          date: today(),
          title: current.title,
          steps: current.steps.length,
          firstTry: tallyRef.current.firstTry,
          wrongTaps: tallyRef.current.wrongTaps,
        });
      }
      window.setTimeout(() => onSpeak(STORY_ENDING_LINE), 300);
      return;
    }
    setStepIndex(index);
    setChoices(storyStepChoices(step));
    setFeedback("");
    setNarrating(true);
    onSpeak(step.before, () => setNarrating(false));
  };

  const startStory = (next: Story): void => {
    reportPartial();
    setStory(next);
    tallyRef.current = { title: next.title, firstTry: 0, wrongTaps: 0, answered: 0, reported: false };
    setStepIndex(0);
    setStepAnswered(false);
    setFinished(false);
    setFeedback("");
    setPlayedTitles((current) => [...current, next.title].slice(-10));
    upcomingStoryRef.current = loadAiStory([...playedTitles, next.title].slice(-10));
    // Title first, then the first sentence.
    setNarrating(true);
    onSpeak(next.title, () => playStep(0, next));
  };


  const handlePick = (choice: StoryChoice): void => {
    if (narrating || finished || stepAnswered) return;
    const step = story.steps[stepIndex];
    if (!step) return;

    if (choice.kind !== "correct") {
      tallyRef.current.wrongTaps += 1;
      setStepHadMistake(true);
      setFeedback(STORY_FEEDBACK.wrong);
      onSpeak(STORY_FEEDBACK.wrong);
      return;
    }

    if (!stepHadMistake) tallyRef.current.firstTry += 1;
    tallyRef.current.answered += 1;
    setFeedback(STORY_FEEDBACK.correct);
    setStepAnswered(true);
    setNarrating(true);
    // Right on the first try: just continue the sentence the child already
    // heard. After a mistake (and the "try again" message in between), read
    // the whole corrected sentence so it's heard together.
    const toRead = stepHadMistake ? storyStepSentence(step) : storyStepContinuation(step);
    onSpeak(toRead, () => playStep(stepIndex + 1, story));
  };

  // One "new story" button: a fresh AI-written story when the AI answers,
  // otherwise (offline, blocked, slow) one of the ready-made stories.
  // The story fetched ahead of time (usually ready by now); if that one
  // failed, one fresh try. Nothing in time → a ready-made story.
  const startNextStory = async (): Promise<void> => {
    setIsLoadingNext(true);
    let next = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    // Only when the early one failed (not when it's merely slow).
    if (!next && !upcomingStoryRef.current) {
      upcomingStoryRef.current = loadAiStory(playedTitles);
      next = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    }
    setIsLoadingNext(false);
    startStory(next ?? pickLocalStory(story.id));
  };

  // The first story: the AI one asked for when the screen opened (waiting a
  // little if it's still on its way), else a ready-made one.
  const startFirstStory = async (): Promise<void> => {
    setIsLoadingNext(true);
    const first = await takeUpcomingStory(STORY_MAX_WAIT_MS);
    setIsLoadingNext(false);
    setStarted(true);
    startStory(first ?? story);
  };

  // Completed steps show their full sentence; the current one shows the
  // blank; later steps stay hidden so the story unfolds as it's told.
  const completedSteps = finished ? story.steps.length : stepIndex + (stepAnswered ? 1 : 0);
  const currentStep = !finished && !stepAnswered ? story.steps[stepIndex] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-5 py-3 font-black shadow-sm"
          onClick={onBack}
        >
          חזרה
        </button>
        <div>
          <h2 className="text-3xl font-black">📖 בואו נספר סיפור</h2>
          <p className="text-muted">הקשיבו לסיפור, ובכל פעם שחסרה מילה בחרו את המילה שממשיכה אותו.</p>
        </div>
      </div>

      {!started ? (
        <div className="grid flex-1 place-items-center">
          <button
            type="button"
            className="flex flex-col items-center gap-3 rounded-[2rem] bg-gradient-to-br from-rose-400 to-orange-400 px-16 py-10 text-white shadow-soft transition active:scale-95 disabled:opacity-80"
            disabled={isLoadingNext}
            onClick={() => void startFirstStory()}
          >
            <span className="text-7xl">{isLoadingNext ? "📖" : "▶️"}</span>
            <span className="text-3xl font-black">{isLoadingNext ? "מכינים סיפור..." : "מתחילים סיפור"}</span>
          </button>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mb-6 rounded-soft border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-2xl font-black">
            {story.emoji} {story.title}
          </h3>
          <div className="space-y-2 text-xl font-black leading-relaxed">
            {story.steps.slice(0, completedSteps).map((step, index) => (
              <p key={`${story.id}-${index}`}>
                <span className="ml-2">{step.answer.emoji}</span>
                {storyStepSentence(step)}
              </p>
            ))}
            {currentStep && (
              <p className="text-slate-700">
                {currentStep.before} <span className="text-blue-500 underline">____</span>{" "}
                {currentStep.after}
              </p>
            )}
            {finished && <p className="pt-2 text-blue-700">{STORY_ENDING_LINE}</p>}
          </div>
          {!finished && (
            <p className="mt-3 text-sm font-bold text-muted">
              שלב {Math.min(stepIndex + 1, story.steps.length)} מתוך {story.steps.length}
            </p>
          )}
        </div>

        {finished ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={isLoadingNext}
              className="rounded-2xl bg-blue-600 px-6 py-4 text-xl font-black text-white disabled:opacity-60"
              onClick={() => void startNextStory()}
            >
              {isLoadingNext ? "📖 מכינים סיפור חדש..." : "🔄 סיפור חדש"}
            </button>
          </div>
        ) : narrating || !currentStep ? (
          <p className="text-lg font-black text-muted">🔊 מקריא/ה את הסיפור...</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {choices.map((choice) => (
                <button
                  key={`${stepIndex}-${choice.word.label}`}
                  type="button"
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-soft border border-slate-200 bg-white p-5 shadow-sm transition active:scale-95"
                  onClick={() => handlePick(choice)}
                >
                  <span className="text-5xl">{choice.word.emoji}</span>
                  <span className="text-xl font-black">{choice.word.label}</span>
                </button>
              ))}
            </div>
            {feedback ? (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-lg font-black text-amber-950">
                {feedback}
              </p>
            ) : null}
          </>
        )}
      </div>
      )}
    </div>
  );
}
