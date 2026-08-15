import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Clerk's documented Expo token cache: persist the session JWT in SecureStore
// on native so users stay signed in across app restarts. Web doesn't need
// this — Clerk manages its own browser session there.
function createTokenCache() {
  return {
    async getToken(key: string) {
      try {
        return await SecureStore.getItemAsync(key);
      } catch (error) {
        await SecureStore.deleteItemAsync(key);
        return null;
      }
    },
    saveToken(key: string, token: string) {
      return SecureStore.setItemAsync(key, token);
    },
  };
}

export const clerkTokenCache = Platform.OS !== "web" ? createTokenCache() : undefined;
