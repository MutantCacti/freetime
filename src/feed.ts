// Fetching the feed, with a Cache API copy for freshness and for failures.
// The feed URL (ICAL_URL) is never logged and never sent to the browser.

import { FEED_FRESH_SECONDS, FEED_KEEP_SECONDS, FEED_TIMEOUT_MS } from "./config";
import { AppError } from "./errors";
import { FeedParseError, parseFeed } from "./ical";

type Component = ReturnType<typeof parseFeed>;

export interface FeedResult {
  root: Component;
  /** A saved copy is being used because the fetch failed. */
  stale: boolean;
  /** Why the saved copy is in use. */
  problem?: AppError;
}

export interface FeedOptions {
  /** Fetches the upstream feed. */
  fetchFeed: () => Promise<Response>;
  /** Current time in epoch seconds. */
  nowSec: number;
  /** Cache key URL for the saved copy (never the feed URL). */
  cacheKey: string;
  cache: Cache;
  waitUntil: (p: Promise<unknown>) => void;
}

const FETCHED_AT = "x-fetched-at";

// Parsing is the slow part; reuse the last parse within an isolate.
let memo: { key: string; root: Component } | null = null;

function parseCached(text: string, key: string): Component {
  if (memo?.key === key) return memo.root;
  const root = parseFeed(text);
  memo = { key, root };
  return root;
}

async function fetchUpstream(fetchFeed: () => Promise<Response>): Promise<string> {
  let res: Response;
  try {
    res = await fetchFeed();
  } catch (err) {
    throw new AppError("FEED_FETCH", "feed fetch failed", { cause: err });
  }
  if (!res.ok) {
    // The body is discarded: upstream response bodies are never shown or logged.
    await res.body?.cancel();
    throw new AppError(`FEED_STATUS_${res.status}`, `feed returned HTTP ${res.status}`, { upstreamStatus: res.status });
  }
  try {
    return await res.text();
  } catch (err) {
    throw new AppError("FEED_FETCH", "feed body could not be read", { cause: err });
  }
}

export async function loadFeed(opts: FeedOptions): Promise<FeedResult> {
  const saved = await opts.cache.match(opts.cacheKey);
  const savedAt = Number(saved?.headers.get(FETCHED_AT) ?? NaN);
  const savedText = saved ? await saved.text() : null;

  if (savedText !== null && opts.nowSec - savedAt < FEED_FRESH_SECONDS) {
    try {
      return { root: parseCached(savedText, `${savedAt}:${savedText.length}`), stale: false };
    } catch {
      // A bad saved copy is ignored; fetch a new one.
    }
  }

  try {
    const text = await fetchUpstream(opts.fetchFeed);
    let root: Component;
    try {
      root = parseCached(text, `${opts.nowSec}:${text.length}`);
    } catch (err) {
      const message = err instanceof FeedParseError ? err.message : "feed could not be parsed";
      throw new AppError("FEED_PARSE", message, { cause: err });
    }
    const copy = new Response(text, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": `max-age=${FEED_KEEP_SECONDS}`,
        [FETCHED_AT]: String(opts.nowSec),
      },
    });
    opts.waitUntil(opts.cache.put(opts.cacheKey, copy));
    return { root, stale: false };
  } catch (err) {
    if (savedText !== null && err instanceof AppError) {
      try {
        return { root: parseCached(savedText, `${savedAt}:${savedText.length}`), stale: true, problem: err };
      } catch {
        // Fall through to the original error.
      }
    }
    throw err;
  }
}

/** The upstream fetch used in production. */
export function fetchFromUrl(url: string | undefined): () => Promise<Response> {
  return async () => {
    if (!url) throw new Error("ICAL_URL is not set");
    const target = url.replace(/^webcal:/i, "https:");
    return fetch(target, {
      headers: { accept: "text/calendar" },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
  };
}
