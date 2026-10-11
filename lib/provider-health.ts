// A provider whose key is wrong, whose credit ran out, or that this network
// can't reach (a filter, a dead connection) fails the same way on every
// request. Trying it first anyway adds its wait to every answer the child waits
// for, so after such a failure it is skipped for a while. This lives in the
// server instance's memory: a cold start simply tries it again.
//
// Each use is tracked on its own ("groq-chat", "groq-speech"): a network filter
// may block a provider's answers and still let its transcription through.

const SKIP_FOR_MS = 10 * 60_000;
// A dropped connection may be gone in a minute; a missing credit is not.
const SKIP_AFTER_NETWORK_ERROR_MS = 2 * 60_000;
const skipUntil = new Map<string, number>();

const isAccountFailure = (error: string): boolean =>
  /quota|credit|billing|api key|api_key|unauthori[sz]ed|forbidden|restricted|permission|invalid response/i.test(
    error,
  );

const isNetworkFailure = (error: string): boolean => /fetch failed|timeout|aborted/i.test(error);

export const isProviderSkipped = (provider: string): boolean =>
  (skipUntil.get(provider) ?? 0) > Date.now();

export const noteProviderFailure = (provider: string, error: string | undefined): void => {
  if (!error) return;
  if (isAccountFailure(error)) skipUntil.set(provider, Date.now() + SKIP_FOR_MS);
  else if (isNetworkFailure(error)) skipUntil.set(provider, Date.now() + SKIP_AFTER_NETWORK_ERROR_MS);
};
