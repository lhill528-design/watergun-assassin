import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

// Shown while Clerk is still loading, or while Clerk confirms a session but
// our backend's user row hasn't resolved yet -- see hooks/auth-status.ts.
export function AuthLoadingState() {
  return (
    <View className="flex-1 items-center justify-center gap-3">
      <ActivityIndicator />
      <Text className="text-muted text-sm">Loading your account…</Text>
    </View>
  );
}

// Shown when Clerk confirms a session but fetching/provisioning the local
// user row failed -- distinct from "signed out" so the fix offered is Retry
// or Sign Out, not the sign-in form again (which previously just produced a
// confusing "Session already exists" error on retry).
export function AuthBackendErrorState({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-6">
      <Text className="text-4xl">⚠️</Text>
      <Text className="text-foreground text-lg font-bold text-center">Couldn't load your account</Text>
      <Text className="text-muted text-sm text-center">
        You're signed in, but the server couldn't be reached to finish loading your profile.
      </Text>
      <TouchableOpacity className="bg-primary px-8 py-3 rounded-full" onPress={onRetry}>
        <Text className="text-background font-bold">Retry</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignOut}>
        <Text className="text-muted text-sm">Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

// Shown after the post-setActive() bridge's bounded window ran out without
// Clerk's own isSignedIn ever catching up -- see hooks/use-auth.ts and
// hooks/auth-status.ts. Deliberately not the sign-in form again: if
// isSignedIn is simply lagging rather than genuinely false, retrying
// sign-in there would hit the same confusing "session already exists"
// error the bridge exists to avoid. Retry re-opens the bridge and re-forces
// auth.me without a full sign-in round trip; Sign Out actually ends the
// Clerk session so a subsequent sign-in starts clean either way.
export function AuthSyncExpiredState({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-6">
      <Text className="text-4xl">🔄</Text>
      <Text className="text-foreground text-lg font-bold text-center">Still confirming your sign-in</Text>
      <Text className="text-muted text-sm text-center">
        We verified your code, but couldn't confirm your session in time. This is usually temporary.
      </Text>
      <TouchableOpacity className="bg-primary px-8 py-3 rounded-full" onPress={onRetry}>
        <Text className="text-background font-bold">Retry</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignOut}>
        <Text className="text-muted text-sm">Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
