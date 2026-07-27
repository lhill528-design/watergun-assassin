import { Platform } from "react-native";

// Background tasks must be registered at the top level before any component renders
// This file is imported in app/_layout.tsx

if (Platform.OS !== "web") {
  const registerTasks = async () => {
    try {
      const TaskManager = await import("expo-task-manager");
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      const { BACKGROUND_LOCATION_TASK } = await import("./location-service");

      if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
        TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
          if (error) {
            console.error("[Location] Background task error:", error);
            return;
          }
          if (data) {
            const { locations } = data as { locations: Array<{ coords: { latitude: number; longitude: number } }> };
            if (locations && locations.length > 0) {
              const location = locations[0];
              try {
                const gameId = await AsyncStorage.getItem("location_game_id");
                const apiUrl = await AsyncStorage.getItem("location_api_url");
                if (gameId && apiUrl) {
                  await fetch(`${apiUrl}/api/trpc/player.updateLocation`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      json: {
                        gameId: parseInt(gameId),
                        latitude: location.coords.latitude.toString(),
                        longitude: location.coords.longitude.toString(),
                      },
                    }),
                  });
                }
              } catch (e) {
                console.error("[Location] Background update failed:", e);
              }
            }
          }
        });
        console.log("[Location] Background task registered");
      }
    } catch (e) {
      console.error("[Location] Failed to register background task:", e);
    }
  };
  registerTasks();
}
