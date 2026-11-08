// Encryption for what must never be readable in the database: iCal addresses
// (and, in phase 5, Google tokens). AES-256-GCM with a key derived from the
// ACCOUNTS_KEY secret by HKDF, one key per purpose, and a fresh 12-byte IV per
// value (ACCOUNTS-SPEC.md §7). Values are decrypted only in memory.

import { AppError } from "../errors";
import { fromBase64url } from "./crypto";

export type SecretPurpose = "calendar";

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string | undefined, purpose: SecretPurpose): Promise<CryptoKey> {
  if (!secret) throw new AppError("INTERNAL", "ACCOUNTS_KEY is not set");
  const id = `${purpose}:${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey("raw", fromBase64url(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(`freetime:${purpose}`) },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keys.set(id, key);
  }
  return key;
}

/** IV followed by the ciphertext. */
export async function seal(secret: string | undefined, purpose: SecretPurpose, text: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret, purpose), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}

/** Throws if the key is wrong or the value was changed. */
export async function open(secret: string | undefined, purpose: SecretPurpose, boxed: Uint8Array): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: boxed.slice(0, 12) }, await keyFor(secret, purpose), boxed.slice(12));
  return new TextDecoder().decode(plain);
}
