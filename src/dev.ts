// `npm run dev`: the same app, fed from a fixture instead of ICAL_URL.
import { createApp } from "./app";
import feed from "../test/fixtures/dev.ics";

export default createApp({
  fetchFeed: async () => new Response(feed, { headers: { "content-type": "text/calendar" } }),
});
