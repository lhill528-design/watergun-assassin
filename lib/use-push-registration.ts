/**
 * Hook to register the device's Expo push token with the server.
 * Called once after the user is authenticated.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { trpc } from "@/lib/trpc";

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushRegistration(userId: number | undefined) {
  const registerToken = trpc.auth.registerPushToken.useMutation();

  useEffect(() => {
    if (!userId || Platform.OS === "web") return;

    async function register() {
      try {
        // Request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        // Get the Expo push token
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: undefined, // Uses the project ID from app.config.ts
        });
        const token = tokenData.data;
        if (!token) return;

        // Register with server
        registerToken.mutate({ token, platform: Platform.OS });
      } catch (err) {
        // Silently fail — push is non-critical
        console.warn("[PushRegistration] Failed to register push token:", err);
      }
    }

    register();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
