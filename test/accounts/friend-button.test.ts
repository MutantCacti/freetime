// The Add friend control (ACCOUNTS-SPEC.md §4): a round accent button in the
// profile card. Phase 3 wires the signed-in states to real routes; these check
// each state renders the right control.
import { describe, expect, it } from "vitest";
import { FriendButton, FriendRequestsBadge, type FriendState } from "../../src/accounts/views";
import { decode } from "./helpers";

const html = (state: FriendState, extra = {}) =>
  decode(String(FriendButton({ state, name: "Ada", action: "/u/abc/friend", cancelAction: "/u/abc/cancel", unfriendAction: "/u/abc/unfriend", ...extra })));

describe("FriendButton", () => {
  it.each([
    ["add", "Add Ada as a friend"],
    ["invite", "Add Ada as a friend"],
    ["accept", "Accept Ada's friend request"],
  ] as const)("%s is the round person-plus button, and posts", (state, label) => {
    const h = html(state);
    expect(h).toContain('method="post" action="/u/abc/friend"');
    expect(h).toMatch(new RegExp(`<button type="submit" class="add-friend" data-state="${state}" aria-label="${label}"><svg[^>]*class="icon icon-user-plus"`));
  });

  it("invite carries the share link's code", () => {
    expect(html("invite", { fields: { f: "code123" } })).toContain('<input type="hidden" name="f" value="code123"/>');
  });

  it("sent is an outlined check; tapping it again takes the request back", () => {
    const h = html("sent");
    expect(h).toContain('action="/u/abc/cancel"');
    expect(h).toMatch(/<button type="submit" class="add-friend is-done" data-state="sent" aria-label="Friend request sent to Ada. Take it back"><svg[^>]*><path d="M3 8.5/);
  });

  it("friends is an outlined check that unfriends", () => {
    const h = html("friends");
    expect(h).toContain('action="/u/abc/unfriend"');
    expect(h).toContain('class="add-friend is-done" data-state="friends"');
  });

  it("with no route yet, it's drawn but can't be pressed", () => {
    expect(html("add", { action: undefined })).toMatch(/<button type="button" class="add-friend"[^>]*disabled=""/);
  });

  it("signed out: a link to sign in, with the note app.js shows on the first tap", () => {
    const h = html("signed-out", { signInHref: "/account/sign-in?next=%2F%40ada" });
    expect(h).toMatch(/^<a class="add-friend" data-state="signed-out" data-signin-tip="" href="\/account\/sign-in\?next=%2F%40ada" aria-label="Sign in to add Ada as a friend">/);
    expect(h).toContain('<span class="add-friend-tip" hidden="">Sign in to add friends</span>');
    expect(h).not.toContain("<form");
  });

  it("the request badge shows only when something is waiting", () => {
    expect(FriendRequestsBadge({ count: 0 })).toBeNull();
    expect(decode(String(FriendRequestsBadge({ count: 1 })))).toContain("friend request</a>");
    expect(decode(String(FriendRequestsBadge({ count: 3 })))).toContain('<span class="request-count">3</span>friend requests');
    expect(decode(String(FriendRequestsBadge({ count: 120 })))).toContain(">99+<");
  });
});
