// The one helper that builds every link the server renders. Each link
// carries the current `dtz`, and `tz` when one is set; nothing else adds `tz`.

import { START_HOUR } from "./config";
import { type ViewParams, type ZoneState, usesTimeWindow } from "./state";

export const HOUR_ANCHOR = `h${String(START_HOUR).padStart(2, "0")}`;

type Params = Record<string, string | undefined | null>;

function query(params: Params): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%2F/g, "/")}`);
  }
  return pairs.length ? `?${pairs.join("&")}` : "";
}

export class Links {
  constructor(private readonly zone: Pick<ZoneState, "tz" | "dtz">) {}

  /** Zone parameters every link keeps. */
  get zoneParams(): { tz?: string; dtz?: string } {
    const out: { tz?: string; dtz?: string } = {};
    if (this.zone.tz) out.tz = this.zone.tz;
    if (this.zone.dtz) out.dtz = this.zone.dtz;
    return out;
  }

  href(path: string, params: Params = {}, hash = ""): string {
    const { tz: _tz, dtz: _dtz, ...rest } = params;
    return `${path}${query({ ...rest, ...this.zoneParams })}${hash ? `#${hash}` : ""}`;
  }

  /** A calendar link for a view, landing on the 08:00 anchor where the view has a time window. */
  view(params: ViewParams): string {
    return this.href("/", params, usesTimeWindow(params) ? HOUR_ANCHOR : "");
  }

  /** The same calendar link with `tz` replaced (null removes it). Used only by the time-zone selector. */
  withTz(params: ViewParams, tz: string | null): string {
    const next = new Links({ tz, dtz: this.zone.dtz });
    return next.view(params);
  }
}
