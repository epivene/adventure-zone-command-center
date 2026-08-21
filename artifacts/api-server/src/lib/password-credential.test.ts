import { describe, expect, it } from "vitest";
import { hashPasswordCredential, verifyPasswordCredential } from "./password-credential";

describe("password credentials", () => {
  it("verifies the password used to create the credential", async () => {
    const credential = await hashPasswordCredential("correct horse battery staple");
    await expect(verifyPasswordCredential("correct horse battery staple", credential.hash, credential.salt)).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const credential = await hashPasswordCredential("one password");
    await expect(verifyPasswordCredential("another password", credential.hash, credential.salt)).resolves.toBe(false);
  });
});
