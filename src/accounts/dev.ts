// `npm run dev:accounts`: the accounts Worker with emails printed to the
// terminal instead of sent, so sign-up and reset links work without Resend.
import { createAccountsApp } from "./app";

export default createAccountsApp({
  sendEmail: async (m) => {
    console.log(`\n--- email to ${m.to}: ${m.subject}\n${m.text}\n---\n`);
  },
});
