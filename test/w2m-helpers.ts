import { gridFor } from "../src/w2m";

/**
 * A minimal when2meet event page with the structure the GET spec reads:
 * the zone handler, the slot list, the fill functions and the "you" grid.
 * For shapes the real fixtures don't have (30-minute slots, a DST change, skipped days).
 */
export function fakeEventPage({ zone, slots }: { zone: string | null; slots: number[] }): string {
  const g = gridFor(slots, zone ?? "UTC");
  const handler = zone
    ? `loadTimezoneOptions("ParticipantTimeZone");\n if (select.value != "${zone}") { LoadAvailabilityGrids(); }`
    : `var el = document.createElement("option"); el.textContent = "UTC"; el.value = "UTC";`;
  const script = [
    "function SelectFromHere(e) {}",
    "function SelectToHere(e) {}",
    'function SelectStop() { fetch("SaveTimes.php"); }',
    "var UserID=0;",
    ...slots.map((t, i) => `TimeOfSlot[${i}]=${t};\nAvailableAtSlot[${i}]=new Array();`),
    `document.addEventListener("DOMContentLoaded", function() { var select = document.getElementById("ParticipantTimeZone"); ${handler} });`,
  ].join("\n");
  const cells = slots.map((t, i) => `<div id='YouTime${t}' data-col="${g.positions[i]![0]}" data-row="${g.positions[i]![1]}" data-time="${t}"></div>`);
  return `<html><body><script>${script}</script><div id="NewEventNameDiv">Fake</div><div id='YouGridSlots'>${cells.join("\n")}</div></body></html>`;
}
