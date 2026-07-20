import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

const BACKGROUND_LOCATION_TASK = "watergun-background-location";
const FOREGROUND_INTERVAL = 10000; // 10 seconds when app is open
const BACKGROUND_INTERVAL = 300000; // 5 minutes when app is in background

// Define the background task at module level (required by expo-task-manager)
if (Platform.OS !== "web") {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error("[Location] Background task error:", error);
      return;
    }
    if (data) {
      const { locations } = data as { locations: Location.LocationObject[] };
      if (locations && locations.length > 0) {
        const latest = locations[locations.length - 1];
        // Send to server
        await sendLocationToServer(latest.coords.latitude, latest.coords.longitude);
      }
    }
  });
}

let foregroundSubscription: Location.LocationSubscription | null = null;
let serverUrl: string | null = null;
let authCookie: string | null = null;
let currentGameId: number | null = null;

export function configureLocationService(config: {
  serverUrl: string;
  cookie?: string;
  gameId: number;
}) {
  serverUrl = config.serverUrl;
  authCookie = config.cookie || null;
  currentGameId = config.gameId;
}

async function sendLocationToServer(latitude: number, longitude: number) {
  if (!serverUrl || !currentGameId) return;
  try {
    // Use tRPC batch format for location update
    const response = await fetch(`${serverUrl}/api/trpc/player.updateLocation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authCookie ? { Cookie: authCookie } : {}),
      },
      body: JSON.stringify({
        json: {
          gameId: currentGameId,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
        },
      }),
    });
    if (!response.ok) {
      console.warn("[Location] Failed to send location:", response.status);
    }
  } catch (err) {
    console.warn("[Location] Error sending location:", err);
  }
}

export async function requestLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  if (Platform.OS === "web") {
    // Web only supports foreground
    const { status } = await Location.requestForegroundPermissionsAsync();
    return { foreground: status === "granted", background: false };
  }

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") {
    return { foreground: false, background: false };
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bgStatus === "granted" };
}

export async function startForegroundTracking(
  onLocationUpdate?: (lat: number, lng: number) => void
): Promise<void> {
  if (Platform.OS === "web") {
    // Web: use watchPosition with interval
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    foregroundSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: FOREGROUND_INTERVAL,
        distanceInterval: 5, // 5 meters
      },
      (location) => {
        const { latitude, longitude } = location.coords;
        sendLocationToServer(latitude, longitude);
        onLocationUpdate?.(latitude, longitude);
      }
    );
    return;
  }

  // Native: use watchPositionAsync for foreground
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return;

  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: FOREGROUND_INTERVAL,
      distanceInterval: 5,
    },
    (location) => {
      const { latitude, longitude } = location.coords;
      sendLocationToServer(latitude, longitude);
      onLocationUpdate?.(latitude, longitude);
    }
  );
}

export async function stopForegroundTracking(): Promise<void> {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }
}

export async function startBackgroundTracking(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== "granted") return false;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) return true;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: BACKGROUND_INTERVAL,
    distanceInterval: 50, // 50 meters minimum movement
    deferredUpdatesInterval: BACKGROUND_INTERVAL,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Watergun Assassin",
      notificationBody: "Tracking location for game",
      notificationColor: "#FF1493",
    },
  });

  return true;
}

export async function stopBackgroundTracking(): Promise<void> {
  if (Platform.OS === "web") return;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}

export async function getCurrentLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch {
    return null;
  }
}

export async function isLocationEnabled(): Promise<boolean> {
  return Location.hasServicesEnabledAsync();
}
