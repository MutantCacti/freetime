// The one helper that builds every link the server renders. Each link
// carries the current `dtz`, and `tz` when one is set; nothing else adds `tz`.
// In when2meet match mode, links also carry `w2m` (and `w2mweek`).

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

/** The when2meet match carried by every link while it's on. */
export interface MatchParams {
  w2m: string;
  w2mweek?: string;
}

export class Links {
  constructor(
    private readonly zone: Pick<ZoneState, "tz" | "dtz">,
    private readonly match: MatchParams | null = null,
  ) {}

  /** Zone parameters every link keeps. */
  get zoneParams(): { tz?: string; dtz?: string } {
    const out: { tz?: string; dtz?: string } = {};
    if (this.zone.tz) out.tz = this.zone.tz;
    if (this.zone.dtz) out.dtz = this.zone.dtz;
    return out;
  }

  /** Everything every link keeps: the zone, and the match while it's on. Forms carry these as hidden fields. */
  get keptParams(): Record<string, string> {
    const out: Record<string, string> = { ...this.zoneParams };
    if (this.match) {
      out.w2m = this.match.w2m;
      if (this.match.w2mweek) out.w2mweek = this.match.w2mweek;
    }
    return out;
  }

  href(path: string, params: Params = {}, hash = ""): string {
    const { tz: _tz, dtz: _dtz, w2m: _w2m, w2mweek: _w2mweek, ...rest } = params;
    return `${path}${query({ ...rest, ...this.keptParams })}${hash ? `#${hash}` : ""}`;
  }

  /** The same links with the match replaced (null ends it). */
  withMatch(match: MatchParams | null): Links {
    return new Links(this.zone, match);
  }

  /** A calendar link for a view, landing on the 08:00 anchor where the view has a time window. */
  view(params: ViewParams): string {
    return this.href("/", params, usesTimeWindow(params) ? HOUR_ANCHOR : "");
  }

  /** The same calendar link with `tz` replaced (null removes it). Used only by the time-zone selector. */
  withTz(params: ViewParams, tz: string | null): string {
    const next = new Links({ tz, dtz: this.zone.dtz }, this.match);
    return next.view(params);
  }
}
