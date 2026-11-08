// `npm run dev:accounts`: the accounts Worker with emails printed to the
// terminal instead of sent, so sign-up and reset links work without Resend,
// and a sample calendar at https://sample.invalid/dev.ics (the dev fixture).
import { createAccountsApp } from "./app";
import { fetchCalendarUrl } from "./busy";
import sample from "../../test/fixtures/dev.ics";

const SAMPLE_CALENDAR = "https://sample.invalid/dev.ics";

export default createAccountsApp({
  sendEmail: async (m) => {
    console.log(`\n--- email to ${m.to}: ${m.subject}\n${m.text}\n---\n`);
  },
  fetchCalendar: async (url) => (url === SAMPLE_CALENDAR ? new Response(sample, { headers: { "content-type": "text/calendar" } }) : fetchCalendarUrl(url)),
});
