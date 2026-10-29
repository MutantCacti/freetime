import type { Column, DayCell } from "../calendar";
import { HOUR_ANCHOR } from "../links";
import type { Links } from "../links";
import { stepClasses } from "../dither";
import { LEVELS } from "../levels";
import { hhmm, weekdayShort } from "../format";
import { addDays, startOfWeek } from "../dates";

/** Day, Week and short Range: columns of 48 half-hour rows in a scrolling window. */
export function ColumnGrid({ columns }: { columns: Column[] }) {
  const rows = columns[0]?.slots.length ?? 0;
  return (
    <div class="cal-scroll" id="cal-scroll" data-layout="columns" data-start-anchor={HOUR_ANCHOR}>
      <div class={`cols n${columns.length}`}>
        <div class="corner" aria-hidden="true"></div>
        {columns.map((col) => (
          <div class={col.isToday ? "colhead is-today" : "colhead"} data-date={col.date}>
            {col.header}
          </div>
        ))}
        {Array.from({ length: rows }, (_, r) => {
          const first = columns[0]!.slots[r]!;
          const fullHour = first.minute === 0;
          const id = fullHour ? `h${String(first.hour).padStart(2, "0")}` : undefined;
          return (
            <>
              <div class={fullHour ? "timelabel hour" : "timelabel"} id={id}>
                {fullHour ? hhmm(first.hour, 0) : ""}
              </div>
              {columns.map((col) => {
                const s = col.slots[r]!;
                const split = s.nowStep !== null ? `split m${s.nowStep}` : "";
                const cls = ["slot", s.classes, s.past && !split ? "past" : "", split, col.isToday ? "is-today" : ""].filter(Boolean).join(" ");
                return (
                  <div class={cls} tabindex={0} role="img" aria-label={s.label} data-s={s.start} data-e={s.end}>
                    {s.nowStep !== null ? <div class={`now-line m${s.nowStep}`} id="now-line" aria-hidden="true"></div> : null}
                  </div>
                );
              })}
            </>
          );
        })}
      </div>
    </div>
  );
}

/** Month and long Range: day cells, weeks as rows, Monday first. */
export function DayCellGrid({ weeks, links }: { weeks: DayCell[][]; links: Links }) {
  const monday = startOfWeek(weeks[0]![0]!.date);
  return (
    <div class="cal-scroll" data-layout="cells">
      <div class="month">
        {/* PRINTED OUTPUT: month / weekday headings */}
        {Array.from({ length: 7 }, (_, i) => (
          <div class="dow" aria-hidden="true">
            {weekdayShort(addDays(monday, i))}
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const cls = ["daycell", cell.classes, cell.inPeriod ? "" : "out", cell.isPast ? "past" : "", cell.isToday ? "is-today" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <a class={cls} href={links.view({ view: "day", date: cell.date })} aria-label={cell.label} aria-current={cell.isToday ? "date" : undefined}>
              {/* PRINTED OUTPUT: month / day number */}
              <span class="daynum" aria-hidden="true">
                {cell.dayOfMonth}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** The palette's LEVELS steps with their dither; "Busy" at the top, "Free" at the bottom. */
export function ColourBar() {
  return (
    <div class="colourbar" aria-hidden="true">
      {/* PRINTED OUTPUT: colour bar / busy and free labels */}
      <span class="cb-label cb-busy">Busy</span>
      <div class="cb-ramp">
        {Array.from({ length: LEVELS }, (_, step) => (
          <div class={`cb-band ${stepClasses(step)}`}></div>
        ))}
      </div>
      <span class="cb-label cb-free">Free</span>
    </div>
  );
}

export { HOUR_ANCHOR };
