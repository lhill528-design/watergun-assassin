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
};

function getBearerToken(req: CreateExpressContextOptions["req"]): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return undefined;
}

async function resolveUser(clerkId: string): Promise<User | null> {
  const signedInAt = new Date();
  const existing = await db.getUserByClerkId(clerkId);

  if (!existing) {
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
    return (await db.getUserByClerkId(clerkId)) ?? null;
  }

  await db.upsertUser({ clerkId, lastSignedIn: signedInAt });
  return existing;
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;

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
        // Token was valid, but fetching/creating the local user row failed
        // (DB unreachable, Clerk users.getUser() failed, etc.) -- a
        // different failure mode than a bad token, worth telling apart in
        // the logs. Never log the token/claims/DB connection string --
        // only the error's own message.
        console.error(
          "[auth] resolveUser failed for a verified token:",
          error instanceof Error ? error.message : error,
        );
        user = null;
      }
    } catch (error) {
      // Invalid/expired/malformed token — leave user null so public
      // procedures still work. Logged (reason + message only, never the
      // token itself) since this was previously silent, making every auth
      // failure indistinguishable from "no token sent" in Railway's logs.
      if (error instanceof TokenVerificationError) {
        console.warn(`[auth] token verification failed: ${error.reason} - ${error.message}`);
      } else {
        console.warn("[auth] unexpected error verifying token:", error instanceof Error ? error.message : error);
      }
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
