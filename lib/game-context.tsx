import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/api";
import {
  requestLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from "./location-service";

// EXPO_PUBLIC_API_URL was never a real configured variable -- every build
// (Railway/Vercel/EAS) only ever sets EXPO_PUBLIC_API_BASE_URL (see
// constants/api.ts), so this always fell through to the "http://localhost:3000"
// fallback in every production build. On native that means background
// location updates (see lib/background-tasks.ts) were POSTing to
// localhost on the player's own phone, not the real backend.
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
