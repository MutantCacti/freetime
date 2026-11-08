import { beforeEach, describe, expect, it } from "vitest";
import { decodePng } from "../../src/accounts/image-decode";
import baselineUrl from "../fixtures/pic-baseline-420.jpg?inline";
import { accountsEnv, decode, makeAccounts, resetDb, signedUp } from "./helpers";
import { buildPng, inlineBytes } from "./png-builder";

beforeEach(resetDb);

/** 600 × 400, orange: big enough to be resized, and cropped. */
const PNG = await buildPng({ w: 600, h: 400, type: 2, pixel: () => [230, 120, 20] });
/** 800 × 600 baseline JPEG (green in the middle, red and blue at the sides). */
const JPEG = inlineBytes(baselineUrl);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...new Array(100).fill(1)]);

async function row() {
  return accountsEnv.DB.prepare("SELECT public_id, picture_key, accent FROM users").first<{ public_id: string; picture_key: string | null; accent: string | null }>();
}
async function stored(): Promise<Uint8Array> {
  const { objects } = await accountsEnv.PICTURES!.list();
  const obj = await accountsEnv.PICTURES!.get(objects[0]!.key);
  expect(obj!.httpMetadata?.contentType).toBe("image/png");
  return new Uint8Array(await obj!.arrayBuffer());
}
const pngSize = (bytes: Uint8Array) => [new DataView(bytes.buffer, bytes.byteOffset).getUint32(16), new DataView(bytes.buffer, bytes.byteOffset).getUint32(20)];
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
    // What's served is the stored, resized copy, never the upload.
    const served = new Uint8Array(await pic.arrayBuffer());
    expect(served).toEqual(await stored());
    expect(served).not.toEqual(PNG);
  });

  it.each([
    ["PNG", () => PNG, "me.png"],
    ["JPEG", () => JPEG, "me.jpg"],
  ])("stores a %s as a 128 × 128 PNG of its centre, with an accent", async (_n, bytes, name) => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect((await b.upload("/account/picture", "picture", new File([bytes()], name))).status).toBe(303);
    const png = await stored();
    expect(pngSize(png)).toEqual([128, 128]);
    expect(png.length).toBeLessThan(64 * 1024);
    const grid = (await decodePng(png))!;
    expect(grid.size).toBe(128);
    expect((await row())!.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("refuses WebP and pictures it can't read, storing nothing", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const webp = await b.upload("/account/picture", "picture", new File([WEBP], "me.webp", { type: "image/webp" }));
    expect(webp.status).toBe(400);
    expect(decode(await webp.text())).toContain("Choose a PNG or JPEG picture.");
    const broken = await b.upload("/account/picture", "picture", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "me.jpg"));
    expect(broken.status).toBe(400);
    expect(decode(await broken.text())).toContain("We couldn't read that picture.");
    expect(await objectCount()).toBe(0);
    expect((await row())!.picture_key).toBeNull();
  });

  it("knows a picture by its bytes, not its name or claimed type", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const fake = await b.upload("/account/picture", "picture", new File(["<svg onload=alert(1)>"], "me.png", { type: "image/png" }));
    expect(fake.status).toBe(400);
    expect(decode(await fake.text())).toContain("Choose a PNG or JPEG picture.");
    expect(await objectCount()).toBe(0);
    const jpeg = await b.upload("/account/picture", "picture", new File([JPEG], "me.txt", { type: "text/plain" }));
    expect(jpeg.status).toBe(303);
    const pic = await a.browser().get(`/u/${(await row())!.public_id}/picture`);
    expect(pic.headers.get("content-type")).toBe("image/png");
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
    expect((await row())!.accent).toBeNull();
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
