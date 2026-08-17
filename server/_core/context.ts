import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { TokenVerificationError } from "@clerk/backend/errors";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

const clerkClient = createClerkClient({ secretKey: ENV.clerkSecretKey });

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  // Set only when a bearer token verified successfully but resolving/
  // provisioning the local user row then failed (DB unavailable, Clerk's
  // users.getUser() failed, etc.). Lets auth.me distinguish "not
  // authenticated" (user: null, authError: null -- a normal, expected
  // state) from "authenticated, but the backend couldn't finish loading
  // your account" (should surface as an error, not silently look identical
  // to being logged out).
  authError: "provisioning_failed" | null;
};

function getBearerToken(req: CreateExpressContextOptions["req"]): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return undefined;
}

// Logs only a fixed stage label plus the error's class name -- never
// error.message. Messages from DB drivers or SDK errors can carry
// hostnames, usernames, connection strings, or other unexpected internal
// detail; the class name (e.g. "Error", a driver's error class) is enough
// to triage from Railway's logs without risking that leak. Never log
// tokens, Authorization headers, OTPs, keys, DATABASE_URL, credentials,
// claims, or full user data here or anywhere else in this function.
function logAuthFailure(stage: string, error: unknown): void {
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  console.warn(`[auth] ${stage} failed; error class: ${errorClass}`);
}

async function resolveUser(clerkId: string): Promise<User> {
  const signedInAt = new Date();
  const existing = await db.getUserByClerkId(clerkId);

  if (existing) {
    await db.upsertUser({ clerkId, lastSignedIn: signedInAt });
    return existing;
  }

  // First time we've seen this Clerk user — pull their profile and provision a local row.
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const primaryEmail =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    null;

  await db.upsertUser({
    clerkId,
    name: clerkUser.fullName || clerkUser.firstName || null,
    email: primaryEmail,
    loginMethod: "clerk",
    lastSignedIn: signedInAt,
  });

  const created = await db.getUserByClerkId(clerkId);
  if (!created) {
    // db.upsertUser()/getUserByClerkId() silently no-op instead of
    // throwing when the database is unavailable (see server/db.ts) -- that
    // best-effort behavior is fine for other call sites, but here it would
    // otherwise look identical to "no user" and get swallowed as if this
    // visitor were simply signed out. Throw so the caller can tell this
    // apart from that.
    throw new Error("database unavailable, or provisioning completed without producing a user row");
  }
  return created;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  let authError: TrpcContext["authError"] = null;

  const token = getBearerToken(opts.req);
  if (token) {
    try {
      const claims = await verifyToken(token, {
        secretKey: ENV.clerkSecretKey,
        // Omitted (not `[]`) when unset, since an empty array would reject
        // every token instead of skipping the `azp` check.
        ...(ENV.clerkAuthorizedParties.length > 0
          ? { authorizedParties: ENV.clerkAuthorizedParties }
          : {}),
      });

      try {
        user = await resolveUser(claims.sub);
      } catch (error) {
        // Token was valid, but provisioning the local user row failed --
        // a different, backend-side failure mode than a bad token.
        logAuthFailure("user provisioning", error);
        authError = "provisioning_failed";
        user = null;
      }
    } catch (error) {
      // Invalid/expired/malformed token — leave user null so public
      // procedures still work; this is a normal "not authenticated" state,
      // not a backend failure, so authError is not set here.
      if (error instanceof TokenVerificationError) {
        console.warn(`[auth] token verification failed; reason: ${error.reason}`);
      } else {
        logAuthFailure("token verification", error);
      }
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authError,
  };
}
