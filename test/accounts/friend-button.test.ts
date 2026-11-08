// The Add friend control's look (ACCOUNTS-SPEC.md §4). Phase 3 wires it to
// real routes; these check each state renders the right control.
import { describe, expect, it } from "vitest";
import { FriendButton, FriendRequestsBadge, type FriendState } from "../../src/accounts/views";
import { decode } from "./helpers";

const html = (state: FriendState, extra = {}) => decode(String(FriendButton({ state, action: "/u/abc/friend", unfriendAction: "/u/abc/unfriend", ...extra })));

describe("FriendButton", () => {
  it.each([
    ["add", "Add friend"],
    ["invite", "Add friend"],
    ["accept", "Accept friend request"],
  ] as const)("%s is a primary pill that posts", (state, label) => {
    const h = html(state);
    expect(h).toContain('class="friend-action friend-cta"');
    expect(h).toContain('method="post" action="/u/abc/friend"');
    expect(h).toMatch(new RegExp(`<button type="submit" class="pill pill-primary friend-pill">.*${label}</button>`));
  });

  it("invite carries the share link's code and says it's instant", () => {
    const h = html("invite", { fields: { f: "code123" } });
    expect(h).toContain('<input type="hidden" name="f" value="code123"/>');
    expect(h).toContain("You'll be friends at once.");
  });

  it("signed out links to sign-up", () => {
    const h = html("signed-out", { signUpHref: "/account/sign-up?next=%2Fu%2Fabc" });
    expect(h).toContain('<a class="pill pill-primary friend-pill" href="/account/sign-up?next=%2Fu%2Fabc">');
    expect(h).toContain("Sign up to add friend");
    expect(h).not.toContain("<form");
  });

  it("sent and friends are quiet status lines; only friends has Unfriend", () => {
    const sent = html("sent");
    expect(sent).toContain('class="friend-action friend-status" data-state="sent"');
    expect(sent).toContain("Request sent");
    expect(sent).not.toContain("<button");
    const friends = html("friends");
    expect(friends).toContain("Friends");
    expect(friends).toContain('action="/u/abc/unfriend"');
    expect(friends).toContain("Unfriend");
    expect(friends).not.toContain("friend-cta");
  });

  it("the request badge shows only when something is waiting", () => {
    expect(FriendRequestsBadge({ count: 0 })).toBeNull();
    expect(decode(String(FriendRequestsBadge({ count: 1 })))).toContain("friend request</a>");
    expect(decode(String(FriendRequestsBadge({ count: 3 })))).toContain('<span class="request-count">3</span>friend requests');
    expect(decode(String(FriendRequestsBadge({ count: 120 })))).toContain(">99+<");
  });
});
