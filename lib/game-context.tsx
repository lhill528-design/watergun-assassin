import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/api";
import {
  requestLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from "./location-service";

// EXPO_PUBLIC_API_URL isn't this app's documented API-base-URL variable --
// every other reference (constants/api.ts, .env.example, README, Railway,
// Vercel) uses EXPO_PUBLIC_API_BASE_URL. It was previously configured as
// its own separate value in EAS specifically, so it wasn't necessarily
// unset in every build, but having two independently-configured names for
// what should be the same URL meant they could silently diverge whenever
// only one was updated. Standardized on the one documented variable so
// there's a single source of truth for the value background location
// updates (see lib/background-tasks.ts) get sent to.
const API_URL = getApiBaseUrl();

interface GameContextType {
  activeGameId: number | null;
  setActiveGameId: (id: number | null) => void;
  isAdmin: boolean;
  setIsAdmin: (val: boolean) => void;
}

const GameContext = createContext<GameContextType>({
  activeGameId: null,
  setActiveGameId: () => {},
  isAdmin: false,
  setIsAdmin: () => {},
});

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [activeGameId, setActiveGameIdState] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("activeGameId").then((val) => {
      if (val) setActiveGameIdState(parseInt(val));
    });
  }, []);

  // Start/stop background location tracking when game changes
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (activeGameId) {
      requestLocationPermissions().then((granted) => {
        if (granted) {
          startBackgroundLocationTracking(activeGameId, API_URL);
        }
      });
    } else {
      stopBackgroundLocationTracking();
    }
    return () => {
      // Don't stop on unmount — background tracking should persist
    };
  }, [activeGameId]);

  const setActiveGameId = (id: number | null) => {
    setActiveGameIdState(id);
    if (id) {
      AsyncStorage.setItem("activeGameId", id.toString());
    } else {
      AsyncStorage.removeItem("activeGameId");
      stopBackgroundLocationTracking();
    }
  };

  return (
    <GameContext.Provider value={{ activeGameId, setActiveGameId, isAdmin, setIsAdmin }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
