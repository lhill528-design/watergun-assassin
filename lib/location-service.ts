import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BACKGROUND_LOCATION_TASK = "WATERGUN_BACKGROUND_LOCATION";
const LOCATION_GAME_ID_KEY = "location_game_id";
const LOCATION_API_URL_KEY = "location_api_url";

export async function requestLocationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  if (foregroundStatus !== "granted") {
    console.warn("[Location] Foreground permission denied");
    return false;
  }
  await Location.requestBackgroundPermissionsAsync();
  return true;
}

export async function startBackgroundLocationTracking(gameId: number, apiUrl: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await AsyncStorage.setItem(LOCATION_GAME_ID_KEY, gameId.toString());
    await AsyncStorage.setItem(LOCATION_API_URL_KEY, apiUrl);
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5 * 60 * 1000,
        distanceInterval: 100,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Watergun Assassin",
          notificationBody: "Tracking your location for the game",
          notificationColor: "#FF0066",
        },
        pausesUpdatesAutomatically: false,
      });
      console.log("[Location] Background tracking started (5min interval)");
    }
  } catch (e) {
    console.error("[Location] Failed to start background tracking:", e);
  }
}

export async function stopBackgroundLocationTracking(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    await AsyncStorage.removeItem(LOCATION_GAME_ID_KEY);
    await AsyncStorage.removeItem(LOCATION_API_URL_KEY);
  } catch (e) {
    console.error("[Location] Failed to stop background tracking:", e);
  }
}

export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
  if (Platform.OS === "web") return null;
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch (e) {
    console.error("[Location] Failed to get current location:", e);
    return null;
  }
}

export async function startForegroundTracking(
  onLocationUpdate: (location: Location.LocationObject) => void
): Promise<Location.LocationSubscription | null> {
  if (Platform.OS === "web") return null;
  try {
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
      onLocationUpdate
    );
    console.log("[Location] Foreground live tracking started");
    return subscription;
  } catch (e) {
    console.error("[Location] Failed to start foreground tracking:", e);
    return null;
  }
}
