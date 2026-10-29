import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers";

const SECRETS = ["SECRET", "secret-uid", "secret-attendee", "room-4", "airport", "agenda", "example.com"];

const PATHS = [
  "/",
  "/?view=day&date=2026-11-03",
  "/?view=week&date=2026-11-02",
  "/?view=month&date=2026-11-01",
  "/?view=range&from=2026-10-01&to=2026-11-20",
  "/?view=range&from=2026-11-02&to=2026-11-10",
  "/help",
  "/contact",
  "/export?from=2026-11-01&to=2026-11-30",
  "/tz",
  "/free-busy.ics?from=2026-10-01&to=2026-12-01",
  "/free-busy.ics?from=2026-11-02&to=2026-11-08",
];

describe("privacy", () => {
  it("no event title, description, location, attendee or UID reaches any response", async () => {
    const app = makeApp();
    for (const path of PATHS) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      const body = await res.text();
      for (const s of SECRETS) expect(body, `${path} leaks ${s}`).not.toContain(s);
    }
  });
});
