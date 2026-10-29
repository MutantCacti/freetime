// `npm run dev`: the same app, fed from a fixture instead of ICAL_URL. when2meet's
// four test events (the placeholder links 10000001-Test1 … 10000004-Test4) come from
// the test fixtures; any other link is fetched from when2meet as in production.
import { createApp } from "./app";
import { fetchW2mPage } from "./w2m";
import feed from "../test/fixtures/dev.ics";
import weekdays from "../test/fixtures/w2m/weekdays.html";
import dates from "../test/fixtures/w2m/dates.html";
import june from "../test/fixtures/w2m/june.html";
import ny from "../test/fixtures/w2m/ny.html";

const W2M: Record<string, string> = {
  "10000001-Test1": weekdays,
  "10000002-Test2": dates,
  "10000003-Test3": june,
  "10000004-Test4": ny,
};

export default createApp({
  fetchFeed: async () => new Response(feed, { headers: { "content-type": "text/calendar" } }),
  fetchW2m: async (url) => {
    const fixture = W2M[new URL(url).search.slice(1)];
    return fixture ? new Response(fixture, { headers: { "content-type": "text/html" } }) : fetchW2mPage(url);
  },
});
