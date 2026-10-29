import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createApp, type AppDeps, type Env } from "../src/app";
import basic from "./fixtures/basic.ics?raw";

/** Tue 3 Nov 2026, 14:20 UTC (14:20 in London, which is on GMT). */
export const NOW = Date.UTC(2026, 10, 3, 14, 20);

let counter = 0;

export interface TestApp {
  get(path: string, init?: RequestInit): Promise<Response>;
  html(path: string): Promise<string>;
  logs: Record<string, unknown>[];
  fetches: number;
  setNow(ms: number): void;
  setFeed(feed: FeedSource): void;
}

export type FeedSource = string | (() => Response | Promise<Response>);

/**
 * An app wired to a fixture feed, a fixed clock and a captured log.
 * Each app gets its own Cache API key, so tests don't share saved copies.
 */
export function makeApp(options: { feed?: FeedSource; now?: number; env?: Partial<Env>; deps?: Partial<AppDeps> } = {}): TestApp {
  let feed: FeedSource = options.feed ?? basic;
  let now = options.now ?? NOW;
  const logs: Record<string, unknown>[] = [];
  const state = { fetches: 0 };
  const app = createApp({
    fetchFeed: async () => {
      state.fetches++;
      return typeof feed === "string" ? new Response(feed) : feed();
    },
    now: () => now,
    log: (entry) => logs.push(entry),
    cachePath: `/__feed-cache/test-${++counter}-${Math.random().toString(36).slice(2)}`,
    ...options.deps,
  });
  const testEnv = { ...env, ...options.env } as Env;
  const api: TestApp = {
    async get(path, init) {
      const ctx = createExecutionContext();
      const res = await app.request(path, init, testEnv, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    },
    async html(path) {
      const res = await api.get(path);
      return res.text();
    },
    logs,
    get fetches() {
      return state.fetches;
    },
    setNow(ms) {
      now = ms;
    },
    setFeed(f) {
      feed = f;
    },
  };
  return api;
}

/** Undo the separator markup ("·" in a span) so text can be matched as written. */
export function plain(s: string): string {
  return s.replace(/<span class="sep">·<\/span>/g, "·");
}

export function decode(s: string): string {
  return plain(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Every <a href> in a page. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => decode(m[1]!));
}

/** The opening tag of the first element with this attribute fragment. */
export function tagWith(html: string, fragment: string): string | null {
  const re = new RegExp(`<[a-z]+\\b[^>]*${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`);
  return re.exec(html)?.[0] ?? null;
}

export function attr(tag: string | null, name: string): string | null {
  if (!tag) return null;
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : null;
}

/** The href of the top-bar item with data-tb=name. */
export function topbarHref(html: string, name: string): string | null {
  return attr(tagWith(html, `data-tb="${name}"`), "href");
}

/** Query parameters of a link. */
export function params(href: string): URLSearchParams {
  return new URL(href, "http://localhost").searchParams;
}

/** The class list of the slot or day cell with this accessible label. */
export function cellClass(html: string, label: string): string | null {
  return attr(tagWith(html, `aria-label="${label}"`), "class");
}
