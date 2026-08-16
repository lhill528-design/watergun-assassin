import "@/global.css";
import "@/lib/background-tasks";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/expo";
import { tokenCache as clerkTokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { GameProvider } from "@/lib/game-context";
import { usePushRegistration } from "@/lib/use-push-registration";
import { useAuth } from "@/hooks/use-auth";

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export const unstable_settings = {
  anchor: "(tabs)",
};

function PushRegistrar() {
  const { user } = useAuth();
  usePushRegistration(user?.id);
  return null;
}

// Lives inside <ClerkProvider> so the tRPC client's headers() can pull a
// fresh Clerk session token on every request.
function AppShell() {
  const { getToken } = useClerkAuth();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient(getToken));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <GameProvider>
          <PushRegistrar />
          {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
          {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
          {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="kill-feed" />
            <Stack.Screen name="elimination-upload" />
            <Stack.Screen name="admin" />
            <Stack.Screen name="bounty-board" />
            <Stack.Screen name="leaderboard" />
            <Stack.Screen name="join-game" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="roulette" />
            <Stack.Screen name="game-history" />
          </Stack>
          <StatusBar style="light" />
          </GameProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  // initialWindowMetrics is always null on web (no synchronous native
  // measurement exists there -- see react-native-safe-area-context's
  // InitialWindow.ts vs InitialWindow.native.ts). Passing no initialMetrics
  // in that case lets SafeAreaProvider's own web implementation measure the
  // live document on mount, instead of being pinned to a fabricated 0x0
  // frame forever. Note that measurement only happens once per mount --
  // it does not re-run on an in-place window resize/orientation change
  // without a remount (a react-native-safe-area-context web limitation,
  // not something this app controls).
  //
  // On native, initialWindowMetrics is populated before first render, so
  // boost its real insets with a minimum 16px/12px top/bottom to avoid a
  // first-paint flash on devices whose reported insets are smaller than
  // that; SafeAreaProvider still keeps measuring and updates from there.
  const providerInitialMetrics = initialWindowMetrics
    ? {
        ...initialWindowMetrics,
        insets: {
          ...initialWindowMetrics.insets,
          top: Math.max(initialWindowMetrics.insets.top, 16),
          bottom: Math.max(initialWindowMetrics.insets.bottom, 12),
        },
      }
    : undefined;

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={clerkTokenCache}>
          <AppShell />
        </ClerkProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
