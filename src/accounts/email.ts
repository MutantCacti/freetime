// Email through Resend (ACCOUNTS-SPEC.md §6): confirm an address, reset a password.
// No tracking: plain text and simple HTML, links exactly as written.

import { AppError } from "../errors";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

/** The production sender: Resend's HTTP API. Failures carry the status only, never the address. */
export function resendSender(apiKey: string | undefined, from: string | undefined): SendEmail {
  return async (message) => {
    if (!apiKey || !from) throw new AppError("EMAIL_SEND", "RESEND_API_KEY or RESEND_FROM is not set");
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      });
    } catch (err) {
      throw new AppError("EMAIL_SEND", "Resend could not be reached", { cause: err });
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new AppError("EMAIL_SEND", `Resend answered HTTP ${res.status}`, { upstreamStatus: res.status });
    }
    await res.body?.cancel();
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function build(to: string, subject: string, lines: string[], link: string, linkText: string, after: string[]): EmailMessage {
  const text = [...lines, "", link, "", ...after].join("\n");
  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const html = [
    ...lines.map(p),
    `<p><a href="${escapeHtml(link)}">${escapeHtml(linkText)}</a></p>`,
    `<p>${escapeHtml(link)}</p>`,
    ...after.map(p),
  ].join("\n");
  return { to, subject, text, html };
}

/** Sent on sign-up, and to a new address when you change your email. */
export function confirmEmail(to: string, name: string, link: string): EmailMessage {
  return build(
    to,
    "Confirm your email for freetime", // PRINTED OUTPUT: email / confirm address, subject
    // PRINTED OUTPUT: email / confirm address, body
    [`Hi ${name},`, "Confirm this email address to finish setting up your freetime account:"],
    link,
    "Confirm my email", // PRINTED OUTPUT: email / confirm address, link text
    // PRINTED OUTPUT: email / confirm address, footer
    ["The link works once, for 24 hours.", "If you didn't ask for this, ignore this email and nothing will change."],
  );
}

/** Sent from "Forgot your password?". */
export function resetEmail(to: string, name: string, link: string): EmailMessage {
  return build(
    to,
    "Reset your freetime password", // PRINTED OUTPUT: email / password reset, subject
    // PRINTED OUTPUT: email / password reset, body
    [`Hi ${name},`, "Someone asked to reset the password for your freetime account. To choose a new one, open:"],
    link,
    "Choose a new password", // PRINTED OUTPUT: email / password reset, link text
    // PRINTED OUTPUT: email / password reset, footer
    ["The link works once, for 1 hour, and signs you out everywhere else.", "If you didn't ask for this, ignore this email: your password stays the same."],
  );
}
