import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  requestLocationPermissions,
  startBackgroundLocationTracking,
  stopBackgroundLocationTracking,
} from "./location-service";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

interface GameContextType {
  activeGameId: number | null;
  setActiveGameId: (id: number | null) => void;
  isAdmin: boolean;
  setIsAdmin: (val: boolean) => void;
  demoMode: boolean;
  setDemoMode: (val: boolean) => void;
}

const GameContext = createContext<GameContextType>({
  activeGameId: null,
  setActiveGameId: () => {},
  isAdmin: false,
  setIsAdmin: () => {},
  demoMode: false,
  setDemoMode: () => {},
});

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [activeGameId, setActiveGameIdState] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("activeGameId").then((val) => {
      if (val) setActiveGameIdState(parseInt(val));
    });
    AsyncStorage.getItem("demoMode").then((val) => {
      if (val === "true") setDemoMode(true);
    });
  }, []);

  // Start/stop background location tracking when game changes
  useEffect(() => {
    if (Platform.OS === "web" || demoMode) return;
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
  }, [activeGameId, demoMode]);

  const setActiveGameId = (id: number | null) => {
    setActiveGameIdState(id);
    if (id) {
      AsyncStorage.setItem("activeGameId", id.toString());
    } else {
      AsyncStorage.removeItem("activeGameId");
      stopBackgroundLocationTracking();
    }
  };

  const handleSetDemoMode = (val: boolean) => {
    setDemoMode(val);
    AsyncStorage.setItem("demoMode", val ? "true" : "false");
    if (val) {
      // Set a fake game ID for demo
      setActiveGameIdState(999);
    }
  };

  return (
    <GameContext.Provider value={{ activeGameId, setActiveGameId, isAdmin, setIsAdmin, demoMode, setDemoMode: handleSetDemoMode }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
