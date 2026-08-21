import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPasswordCredential(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(24).toString("base64url");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return { hash: derived.toString("base64url"), salt };
}

export async function verifyPasswordCredential(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    const expected = Buffer.from(hash, "base64url");
    if (derived.length !== expected.length) {
      timingSafeEqual(derived, derived);
      return false;
    }
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
