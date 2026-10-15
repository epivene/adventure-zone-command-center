import type { Request, Response } from "express";
import { ConnectionError, type ConnectionPrincipal } from "./contracts";

// Only explicit authentication failures should trigger an OAuth challenge.
// Database/adapter failures must fail closed without invalidating the client session.
export async function authenticateConnectionRequest(
  req: Request,
  res: Response,
  deps: {
    resource: string;
    verify: (token: string) => Promise<ConnectionPrincipal>;
  },
): Promise<ConnectionPrincipal | undefined> {
  const challenge = () => {
    res.status(401).set(
      "WWW-Authenticate",
      `Bearer error="invalid_token", resource_metadata="${new URL(deps.resource).origin}/.well-known/oauth-protected-resource/api/chatgpt/mcp"`,
    ).json({ error: "invalid_token" });
    return undefined;
  };
  const header = req.get("Authorization");
  if (!header?.startsWith("Bearer ") || !header.slice(7).trim()) return challenge();
  try {
    return await deps.verify(header.slice(7));
  } catch (error) {
    if (error instanceof ConnectionError && error.status === 401 &&
        ["CONNECTION_ACCESS_DENIED", "CONNECTION_REVOKED"].includes(error.code)) {
      return challenge();
    }
    // No token, SQL, decrypted artifact, or raw exception in the response.
    res.status(503).set("Retry-After", "5").json({
      error: "CONNECTION_AUTH_CHECK_UNAVAILABLE",
      message: "Connection verification is temporarily unavailable. Retry shortly; reconnecting is not required for this error.",
      retryAfterSeconds: 5,
    });
    return undefined;
  }
}
