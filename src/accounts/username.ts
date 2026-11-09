// Usernames: the profile address /@<username> (migration 0005). Kept in one
// place so the sign-up form, the profile form and the routes agree.

/** Lengths shown in forms and checked on the server. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** What a username may be made of, once lower-cased. */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Words that are, or could become, paths or names on the site: refused as
 * usernames so /@<name> never reads as one of the site's own pages.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "account", "accounts", "admin", "administrator", "api", "app", "auth", "contact", "css", "dev", "export",
  "favicon", "fonts", "free_busy", "freebusy", "freetime", "help", "img", "ics", "js", "login", "logout",
  "me", "mutantcacti", "new", "null", "owner", "privacy", "profile", "public", "root", "s", "security",
  "settings", "sign_in", "sign_out", "sign_up", "signin", "signout", "signup", "site", "space", "spaces", "static",
  "support", "system", "terms", "tz", "u", "undefined", "user", "users", "www",
]);

export type UsernameProblem = "required" | "short" | "long" | "chars" | "reserved";

/** The username as stored: trimmed, without a leading @, lower-case. */
export function normaliseUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** What's wrong with a (normalised) username, or null if it can be used. Whether it's taken is the database's question. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (!name) return "required";
  if (name.length < USERNAME_MIN) return "short";
  if (name.length > USERNAME_MAX) return "long";
  if (!USERNAME_RE.test(name)) return "chars";
  if (RESERVED_USERNAMES.has(name)) return "reserved";
  return null;
}

/** A user's profile path: /@<username> once they have one, /u/<public_id> before. */
export function profilePath(user: { public_id: string; username: string | null }): string {
  return user.username ? `/@${user.username}` : `/u/${user.public_id}`;
}
