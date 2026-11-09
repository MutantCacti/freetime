import { beforeEach, describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, normaliseUsername, profilePath, usernameProblem } from "../../src/accounts/username";
import { accountsEnv, resetDb } from "./helpers";

beforeEach(resetDb);

describe("username rules", () => {
  it("lower-cases, trims and drops a leading @", () => {
    expect(normaliseUsername("  @Ada_Lovelace ")).toBe("ada_lovelace");
  });

  it("allows 3 to 20 of a-z, 0-9 and _", () => {
    expect(usernameProblem("ada")).toBeNull();
    expect(usernameProblem("a_b_1234567890123456")).toBeNull();
    expect(usernameProblem("")).toBe("required");
    expect(usernameProblem("ab")).toBe("short");
    expect(usernameProblem("a".repeat(21))).toBe("long");
    for (const bad of ["ada-l", "ada.l", "ada l", "adé", "ADA"]) expect(usernameProblem(bad), bad).toBe("chars");
  });

  it("refuses the site's own words", () => {
    for (const word of ["account", "api", "help", "contact", "export", "css", "fonts", "img", "spaces", "auth"]) {
      expect(RESERVED_USERNAMES.has(word), word).toBe(true);
      expect(usernameProblem(word), word).toBe("reserved");
    }
  });

  it("a profile's path is /@username once set, /u/<id> before", () => {
    expect(profilePath({ public_id: "abcdefghij", username: "ada" })).toBe("/@ada");
    expect(profilePath({ public_id: "abcdefghij", username: null })).toBe("/u/abcdefghij");
  });
});

describe("migration 0005", () => {
  const insert = (id: string, email: string, username: string | null) =>
    accountsEnv.DB.prepare("INSERT INTO users (public_id, username, name, zone, email, invite_code, created_at) VALUES (?, ?, 'X', 'Europe/London', ?, ?, 0)")
      .bind(id, username, email, `${id}invite`)
      .run();

  it("usernames are optional, unique ignoring case", async () => {
    await insert("aaaaaaaaaa", "a@example.com", null);
    await insert("bbbbbbbbbb", "b@example.com", null);
    await insert("cccccccccc", "c@example.com", "ada");
    await expect(insert("dddddddddd", "d@example.com", "ada")).rejects.toThrow();
    const row = await accountsEnv.DB.prepare("SELECT public_id FROM users WHERE username = ?").bind("ADA").first<{ public_id: string }>();
    expect(row!.public_id).toBe("cccccccccc");
  });

  it("the database refuses the wrong shape", async () => {
    for (const [i, bad] of ["ab", "a".repeat(21), "Ada", "ada-l"].entries()) {
      await expect(insert(`x${i}xxxxxxxx`, `${i}@example.com`, bad), bad).rejects.toThrow();
    }
  });
});
