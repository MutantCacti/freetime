// `npm run dev`: the same app, fed from a fixture instead of ICAL_URL, and
// with when2meet served from the test fixtures (the four test events) instead of the network.
import { createApp } from "./app";
import feed from "../test/fixtures/dev.ics";
import weekdays from "../test/fixtures/w2m/weekdays.html";
import dates from "../test/fixtures/w2m/dates.html";
import june from "../test/fixtures/w2m/june.html";
import ny from "../test/fixtures/w2m/ny.html";
import missing from "../test/fixtures/w2m/missing.html";

const W2M: Record<string, string> = {
  "10000001-Test1": weekdays,
  "10000002-Test2": dates,
  "10000003-Test3": june,
  "10000004-Test4": ny,
};

export default createApp({
  fetchFeed: async () => new Response(feed, { headers: { "content-type": "text/calendar" } }),
  fetchW2m: async (url) => new Response(W2M[new URL(url).search.slice(1)] ?? missing, { headers: { "content-type": "text/html" } }),
});
