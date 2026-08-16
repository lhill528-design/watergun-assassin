// Background tasks must be registered at the top level before any component
// renders. This file is imported in app/_layout.tsx.
//
// Registration (TaskManager.defineTask) MUST happen synchronously during
// module evaluation -- Expo/the OS can re-invoke this bundle in a headless
// JS context and calls back into the task by name immediately, with no
// guarantee it waits for any pending promise first. The previous version of
// this file put the whole registration behind an `async () => { await
// import(...) ... }` wrapper, which meant `defineTask` could still be
// pending (or never run at all, if the headless invocation happened before
// the microtask queue got to it) when the OS expected it to already be
// registered.
import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { BACKGROUND_LOCATION_TASK } from "./location-service";
import { locationUpdateRejectedMessage, pickLatestLocation } from "./location-task-helpers";

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// This task can fire in a headless context where app/_layout.tsx's
// <ClerkProvider> never mounted (a true OS-triggered background wake, not
// the user opening the app) -- so there's no React tree to pull a session
// token from. getClerkInstance() returns the same singleton <ClerkProvider>
// uses when the app *is* running (same publishableKey/tokenCache reuses the
// already-loaded instance instead of creating a competing one); in the
// cold-start case it constructs a fresh, not-yet-loaded instance instead,
// which is why `loaded`/`load()` are checked explicitly here rather than
// assuming `.session` is already populated. `load()` restores the session
// from the same SecureStore-backed tokenCache the Provider uses, which is
// what lets a previously-signed-in user's background task authenticate
// without the UI ever appearing.
async function getBackgroundAuthToken(): Promise<string | null> {
  if (!CLERK_PUBLISHABLE_KEY) return null;
  try {
    const clerk = getClerkInstance({ publishableKey: CLERK_PUBLISHABLE_KEY, tokenCache });
    if (!clerk.loaded) {
      await clerk.load();
    }
    const token = await clerk.session?.getToken();
    return token ?? null;
  } catch (e) {
    console.error("[Location] Failed to obtain a session token for background update:", e);
    return null;
  }
}

if (Platform.OS !== "web" && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      console.error("[Location] Background task error:", error);
      return;
    }
    if (!data) return;

    const { locations } = data as {
      locations: Array<{ coords: { latitude: number; longitude: number }; timestamp: number }>;
    };
    const location = pickLatestLocation(locations);
    if (!location) return;

    try {
      const gameId = await AsyncStorage.getItem("location_game_id");
      const apiUrl = await AsyncStorage.getItem("location_api_url");
      if (!gameId || !apiUrl) return;

      // Never logged or persisted anywhere -- used inline for this one
      // request only. Clerk's own tokenCache already persists what needs
      // persisting; a second copy here would just be a redundant,
      // unencrypted credential sitting in AsyncStorage.
      const token = await getBackgroundAuthToken();
      if (!token) {
        console.warn("[Location] Skipping background update: no authenticated session");
        return;
      }

      const response = await fetch(`${apiUrl}/api/trpc/player.updateLocation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          json: {
            gameId: parseInt(gameId),
            latitude: location.coords.latitude.toString(),
            longitude: location.coords.longitude.toString(),
          },
        }),
      });

      if (!response.ok) {
        // Deliberately not reading/logging the response body -- it's
        // server-controlled content we don't need and shouldn't surface.
        console.error(locationUpdateRejectedMessage(response.status));
      }
    } catch (e) {
      console.error("[Location] Background update failed:", e);
    }
  });
  console.log("[Location] Background task registered");
}
