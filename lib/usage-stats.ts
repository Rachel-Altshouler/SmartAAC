// Progress numbers are collected on the device the child uses. A child may use
// two tablets (home and kindergarten), so each device keeps its own slice on
// the server (usage_stats_json.devices[deviceId]) and the progress page shows
// them added together — no device overwrites another's numbers.

import type { DemoState, StoryResult } from "@/lib/demo-data";

export type UsageStats = {
  usageBySymbolId: Record<string, number>;
  categoryUsageById: Record<string, number>;
  topicUsageById: Record<string, number>;
  sentenceCount: number;
  sentenceLengths: number[];
  storyResults: StoryResult[];
};

export const emptyUsage = (): UsageStats => ({
  usageBySymbolId: {},
  categoryUsageById: {},
  topicUsageById: {},
  sentenceCount: 0,
  sentenceLengths: [],
  storyResults: [],
});

const asUsage = (raw: unknown): UsageStats => {
  const value = (raw ?? {}) as Partial<UsageStats>;
  return {
    usageBySymbolId: value.usageBySymbolId ?? {},
    categoryUsageById: value.categoryUsageById ?? {},
    topicUsageById: value.topicUsageById ?? {},
    sentenceCount: typeof value.sentenceCount === "number" ? value.sentenceCount : 0,
    sentenceLengths: Array.isArray(value.sentenceLengths) ? value.sentenceLengths : [],
    storyResults: Array.isArray(value.storyResults) ? value.storyResults : [],
  };
};

export const pickUsage = (state: DemoState): UsageStats => ({
  usageBySymbolId: state.usageBySymbolId,
  categoryUsageById: state.categoryUsageById,
  topicUsageById: state.topicUsageById,
  sentenceCount: state.sentenceCount,
  sentenceLengths: state.sentenceLengths,
  storyResults: state.storyResults ?? [],
});

const addCounts = (left: Record<string, number>, right: Record<string, number>): Record<string, number> => {
  const sum = { ...left };
  Object.entries(right).forEach(([key, count]) => {
    sum[key] = (sum[key] ?? 0) + count;
  });
  return sum;
};

export const addUsage = (left: UsageStats, right: UsageStats): UsageStats => ({
  usageBySymbolId: addCounts(left.usageBySymbolId, right.usageBySymbolId),
  categoryUsageById: addCounts(left.categoryUsageById, right.categoryUsageById),
  topicUsageById: addCounts(left.topicUsageById, right.topicUsageById),
  sentenceCount: left.sentenceCount + right.sentenceCount,
  sentenceLengths: [...left.sentenceLengths, ...right.sentenceLengths].slice(-200),
  storyResults: [...left.storyResults, ...right.storyResults]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-100),
});

// The server's usage split into this device's own slice and everyone else's.
// An older, single-blob record (before per-device slices) counts as "others",
// so nothing is lost and nothing is counted twice.
export const splitServerUsage = (
  raw: unknown,
  deviceId: string,
): { mine: UsageStats | null; others: UsageStats } => {
  const record = (raw ?? {}) as { devices?: Record<string, unknown> };
  if (record.devices && typeof record.devices === "object") {
    let others = emptyUsage();
    Object.entries(record.devices).forEach(([id, slice]) => {
      if (id !== deviceId) others = addUsage(others, asUsage(slice));
    });
    return { mine: record.devices[deviceId] ? asUsage(record.devices[deviceId]) : null, others };
  }
  return { mine: null, others: asUsage(raw) };
};

// This device's own counts plus everyone else's, for the progress page.
export const withCombinedUsage = (state: DemoState): DemoState =>
  state.otherUsage ? { ...state, ...addUsage(pickUsage(state), state.otherUsage) } : state;

const DEVICE_ID_KEY = "smartaac-device-id";

export const getDeviceId = (): string => {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return "device-unknown";
  }
};
