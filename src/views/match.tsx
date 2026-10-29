import type { MatchGrid as Grid } from "../match";
import type { Links } from "../links";
import { KeptFields } from "./panels";

/**
 * Match mode: the when2meet grid you see, one row per slot, each slot free or
 * busy. Rows go across the days, like the Week view, so the arrow keys work the same.
 */
export function MatchGrid({ grid }: { grid: Grid }) {
  const n = grid.columns.length;
  return (
    <div class="cal-scroll" id="cal-scroll" data-layout="match">
      <div class={`cols mgrid c${n}`}>
        <div class="corner" aria-hidden="true"></div>
        {grid.columns.map((col) => (
          <div class={col.isToday ? "colhead is-today" : "colhead"} data-date={col.date}>
            {col.header}
          </div>
        ))}
        {grid.rows.map((row, r) => (
          <>
            {row.breakBefore ? <div class="mbreak" aria-hidden="true"></div> : null}
            <div class={row.hour ? "timelabel hour" : "timelabel"}>{row.label}</div>
            {grid.columns.map((col, c) => {
              const cell = grid.cells[r]![c];
              const hour = row.hour ? "hour" : "";
              if (!cell) {
                // PRINTED OUTPUT: match mode / position with no slot, accessible label
                return <div class={`slot w2m-none ${hour}`} role="img" aria-label="Not in the event"></div>;
              }
              const cls = ["slot", `w2m-${cell.state}`, hour, cell.past ? "past" : "", col.isToday ? "is-today" : ""].filter(Boolean).join(" ");
              return <div class={cls} tabindex={0} role="img" aria-label={cell.label} data-s={cell.start} data-e={cell.end}></div>;
            })}
          </>
        ))}
      </div>
    </div>
  );
}

/** Replaces the colour bar in match mode: two swatches. */
export function W2mKey() {
  return (
    <div class="colourbar w2m-key" aria-hidden="true">
      {/* PRINTED OUTPUT: match mode / key */}
      <span class="w2m-key-item">
        <span class="w2m-swatch w2m-busy"></span>Busy
      </span>
      <span class="w2m-key-item">
        <span class="w2m-swatch w2m-free"></span>Free
      </span>
    </div>
  );
}

export interface W2mFormProps {
  links: Links;
  /** The text to put back in the field after an error. */
  value?: string;
  /** An inline error next to the field (W2M_URL). */
  error?: string;
  /** In the dialog: focus the field when it opens. */
  autofocus?: boolean;
  idPrefix: string;
}

/** The when2meet link form: a GET to /w2m, keeping the zone. */
export function W2mForm({ links, value, error, autofocus, idPrefix }: W2mFormProps) {
  const field = `${idPrefix}-url`;
  const err = `${idPrefix}-error`;
  return (
    <form class="w2m-form" method="get" action="/w2m">
      {/* PRINTED OUTPUT: when2meet form / field label, placeholder and button */}
      <label for={field}>when2meet link</label>
      <div class="w2m-row">
        <input
          type="text"
          inputmode="url"
          name="url"
          id={field}
          value={value}
          placeholder="https://www.when2meet.com/?…"
          autocomplete="off"
          spellcheck={false}
          required
          autofocus={autofocus}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? err : undefined}
        />
        <button type="submit" class="pill pill-primary">
          Go
        </button>
      </div>
      {error ? (
        <p class="field-error" id={err}>
          {error}
        </p>
      ) : null}
      <KeptFields links={links} except={["w2m", "w2mweek"]} />
    </form>
  );
}
