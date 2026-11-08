// The accounts database (D1). Every query is here, with bound parameters only.

import { randomId, randomToken, sha256Hex } from "./crypto";

export interface User {
  user_id: number;
  public_id: string;
  name: string;
  bio: string;
  zone: string;
  visibility: "public" | "private";
  email: string;
  email_verified: number;
  password_hash: string | null;
  invite_code: string;
  created_at: number;
}

export type TokenPurpose = "verify" | "reset" | "change";

/** Session length, and how often a used session is extended (ACCOUNTS-SPEC.md §5.3). */
export const SESSION_SECONDS = 30 * 24 * 3600;
const SESSION_EXTEND_AFTER = 24 * 3600;

export const TOKEN_SECONDS: Record<TokenPurpose, number> = { verify: 24 * 3600, reset: 3600, change: 24 * 3600 };

export class Db {
  constructor(private readonly db: D1Database) {}

  // ------------------------------------------------------------ users

  userByEmail(email: string): Promise<User | null> {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
  }

  userById(id: number): Promise<User | null> {
    return this.db.prepare("SELECT * FROM users WHERE user_id = ?").bind(id).first<User>();
  }

  async createUser(u: { name: string; email: string; zone: string; passwordHash: string }, now: number): Promise<User> {
    const row = await this.db
      .prepare(
        "INSERT INTO users (public_id, name, zone, email, password_hash, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
      )
      .bind(randomId(10), u.name, u.zone, u.email, u.passwordHash, randomId(16), now)
      .first<User>();
    return row!;
  }

  async deleteUser(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM users WHERE user_id = ?").bind(id).run();
  }

  async markVerified(id: number): Promise<void> {
    await this.db.prepare("UPDATE users SET email_verified = 1 WHERE user_id = ?").bind(id).run();
  }

  async updateProfile(id: number, p: { name: string; bio: string; zone: string; visibility: "public" | "private" }): Promise<void> {
    await this.db.prepare("UPDATE users SET name = ?, bio = ?, zone = ?, visibility = ? WHERE user_id = ?").bind(p.name, p.bio, p.zone, p.visibility, id).run();
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await this.db.prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").bind(passwordHash, id).run();
  }

  async setEmail(id: number, email: string): Promise<void> {
    await this.db.prepare("UPDATE users SET email = ?, email_verified = 1 WHERE user_id = ?").bind(email, id).run();
  }

  // ------------------------------------------------------------ sessions

  /** A new session: returns the cookie value. Only its hash is stored. */
  async createSession(userId: number, now: number): Promise<string> {
    const token = randomToken();
    await this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), userId, now, now + SESSION_SECONDS)
      .run();
    return token;
  }

  /** The signed-in user for a cookie value, extending the session at most once a day. */
  async userForSession(token: string, now: number): Promise<{ user: User; extended: boolean } | null> {
    const hash = await sha256Hex(token);
    const row = await this.db
      .prepare("SELECT users.*, sessions.expires_at AS session_expires FROM sessions JOIN users USING (user_id) WHERE token_hash = ?")
      .bind(hash)
      .first<User & { session_expires: number }>();
    if (!row) return null;
    if (row.session_expires <= now) {
      await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
      return null;
    }
    const { session_expires, ...user } = row;
    let extended = false;
    if (session_expires - now < SESSION_SECONDS - SESSION_EXTEND_AFTER) {
      await this.db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(now + SESSION_SECONDS, hash).run();
      extended = true;
    }
    return { user, extended };
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }

  /** Sign out everywhere, or everywhere but the session `keep` (a cookie value). */
  async deleteSessions(userId: number, keep?: string): Promise<void> {
    if (keep) {
      await this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(userId, await sha256Hex(keep)).run();
    } else {
      await this.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    }
  }

  // ------------------------------------------------------------ emailed tokens

  /** A new single-use token for an email link: returns the token. Earlier ones for the same purpose stop working. */
  async createToken(userId: number, purpose: TokenPurpose, now: number, newEmail: string | null = null): Promise<string> {
    const token = randomToken();
    await this.db.batch([
      this.db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?").bind(userId, purpose),
      this.db
        .prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, new_email, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(await sha256Hex(token), userId, purpose, newEmail, now + TOKEN_SECONDS[purpose]),
    ]);
    return token;
  }

  /** Check a token without using it up. */
  async peekToken(token: string, purpose: TokenPurpose, now: number): Promise<{ user_id: number; new_email: string | null } | null> {
    const row = await this.db
      .prepare("SELECT user_id, new_email, expires_at FROM email_tokens WHERE token_hash = ? AND purpose = ?")
      .bind(await sha256Hex(token), purpose)
      .first<{ user_id: number; new_email: string | null; expires_at: number }>();
    if (!row || row.expires_at <= now) return null;
    return { user_id: row.user_id, new_email: row.new_email };
  }

  /** Use a token up: valid once. */
  async takeToken(token: string, purpose: TokenPurpose, now: number): Promise<{ user_id: number; new_email: string | null } | null> {
    const row = await this.db
      .prepare("DELETE FROM email_tokens WHERE token_hash = ? AND purpose = ? RETURNING user_id, new_email, expires_at")
      .bind(await sha256Hex(token), purpose)
      .first<{ user_id: number; new_email: string | null; expires_at: number }>();
    if (!row || row.expires_at <= now) return null;
    return { user_id: row.user_id, new_email: row.new_email };
  }

  // ------------------------------------------------------------ limits

  /** How many attempts under `key` in the last `windowSeconds`. */
  async attempts(key: string, windowSeconds: number, now: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?").bind(key, now - windowSeconds).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async recordAttempt(key: string, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("INSERT INTO attempts (key, at) VALUES (?, ?)").bind(key, now),
      // Keep the table small: nothing older than a day matters.
      this.db.prepare("DELETE FROM attempts WHERE at < ?").bind(now - 24 * 3600),
    ]);
  }
}
