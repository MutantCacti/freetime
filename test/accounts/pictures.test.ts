import { beforeEach, describe, expect, it } from "vitest";
import { accountsEnv, decode, makeAccounts, resetDb, signedUp } from "./helpers";

beforeEach(resetDb);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(100).fill(7)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(100).fill(1)]);

async function row() {
  return accountsEnv.DB.prepare("SELECT public_id, picture_key FROM users").first<{ public_id: string; picture_key: string | null }>();
}
async function objectCount() {
  return (await accountsEnv.PICTURES!.list()).objects.length;
}

describe("profile pictures", () => {
  it("uploads a picture, served to anyone and shown on the account page and profile", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.upload("/account/picture", "picture", new File([PNG], "me.png", { type: "image/png" }));
    expect(res.headers.get("location")).toBe("/account?done=picture");
    const { public_id, picture_key } = (await row())!;
    expect(picture_key).toMatch(/^p\/[a-z0-9]{24}$/);
    const src = `/u/${public_id}/picture?v=${picture_key!.slice(-8)}`;
    expect(await (await b.get("/account")).text()).toContain(`<img class="avatar" src="${src}" alt=""`);
    expect(await (await a.browser().get(`/u/${public_id}`)).text()).toContain(`src="${src}"`);
    const pic = await a.browser().get(src);
    expect(pic.status).toBe(200);
    expect(pic.headers.get("content-type")).toBe("image/png");
    expect(pic.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await pic.arrayBuffer())).toEqual(PNG);
  });

  it("knows a picture by its bytes, not its name or claimed type", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const fake = await b.upload("/account/picture", "picture", new File(["<svg onload=alert(1)>"], "me.png", { type: "image/png" }));
    expect(fake.status).toBe(400);
    expect(decode(await fake.text())).toContain("Choose a PNG, JPEG or WebP picture.");
    expect(await objectCount()).toBe(0);
    const jpeg = await b.upload("/account/picture", "picture", new File([JPEG], "me.txt", { type: "text/plain" }));
    expect(jpeg.status).toBe(303);
    const pic = await a.browser().get(`/u/${(await row())!.public_id}/picture`);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
  });

  it("refuses pictures over 2 MB", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await b.upload("/account/picture", "picture", new File([big], "big.png"));
    expect(res.status).toBe(413);
    expect(decode(await res.text())).toContain("That picture is over 2 MB.");
    expect(await objectCount()).toBe(0);
  });

  it("a new picture replaces the old one, and removing deletes it", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await b.upload("/account/picture", "picture", new File([PNG], "a.png"));
    await b.upload("/account/picture", "picture", new File([JPEG], "b.jpg"));
    expect(await objectCount()).toBe(1);
    await b.post("/account/picture/remove", {});
    expect((await row())!.picture_key).toBeNull();
    expect(await objectCount()).toBe(0);
    expect((await a.browser().get(`/u/${(await row())!.public_id}/picture`)).status).toBe(404);
    expect(await (await b.get("/account")).text()).toContain('<span class="avatar" aria-hidden="true">AL</span>');
  });

  it("deleting the account deletes the picture", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await b.upload("/account/picture", "picture", new File([PNG], "a.png"));
    await b.post("/account/delete", { password: "correct horse battery" });
    expect(await objectCount()).toBe(0);
  });

  it("uploading needs to be signed in, from the site", async () => {
    const a = makeAccounts();
    expect((await a.browser().upload("/account/picture", "picture", new File([PNG], "a.png"))).status).toBe(303);
    expect(await objectCount()).toBe(0);
  });
});
