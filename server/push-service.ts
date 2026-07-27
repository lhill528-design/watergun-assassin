/**
 * Push Notification Service
 * Sends Expo push notifications to individual players or groups of players.
 * Uses the Expo Push Notification API to deliver device-level notifications.
 */

import { getDb } from "./db";
import { pushTokens } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send a push notification to a single user by their DB userId.
 */
export async function sendPushToUser(userId: number, message: PushMessage): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const tokens = await db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
  if (!tokens.length) return;

  await dispatchPushMessages(
    tokens.map((t) => t.token),
    message,
  );
}

/**
 * Send a push notification to multiple users.
 */
export async function sendPushToUsers(userIds: number[], message: PushMessage): Promise<void> {
  if (!userIds.length) return;
  const db = await getDb();
  if (!db) return;

  const tokens = await db.select().from(pushTokens).where(inArray(pushTokens.userId, userIds));
  if (!tokens.length) return;

  await dispatchPushMessages(
    tokens.map((t) => t.token),
    message,
  );
}

/**
 * Dispatch push messages to a list of Expo push tokens via the Expo Push API.
 * Batches up to 100 per request as per Expo limits.
 */
async function dispatchPushMessages(tokens: string[], message: PushMessage): Promise<void> {
  const validTokens = tokens.filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["));
  if (!validTokens.length) return;

  const messages = validTokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: message.sound ?? "default",
    badge: message.badge,
  }));

  // Batch into chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.warn(`[PushService] Failed to send batch: ${response.status} ${text}`);
      }
    } catch (err) {
      console.warn("[PushService] Error sending push batch:", err);
    }
  }
}

/**
 * Register or update a push token for a user.
 */
export async function registerPushToken(userId: number, token: string, platform = "expo"): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Check if token already registered for this user
  const existing = await db
    .select()
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));

  const tokenExists = existing.find((t) => t.token === token);
  if (tokenExists) return; // Already registered

  await db.insert(pushTokens).values({ userId, token, platform });
}
