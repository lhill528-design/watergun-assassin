import { Text, View, ScrollView, TouchableOpacity, Alert, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { SignInForm } from "@/components/sign-in-form";
import { useAuth } from "@/hooks/use-auth";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";

export default function ProfileScreen() {
  const { user, isAuthenticated, logout, refresh } = useAuth();
  const { activeGameId, setActiveGameId } = useGame();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName || "");

  useEffect(() => {
    setDisplayName(user?.displayName || "");
  }, [user?.displayName]);

  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const myGamesQuery = trpc.game.myGames.useQuery(undefined, { enabled: isAuthenticated });
  const activePowerUpsQuery = trpc.powerUp.playerActive.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const achievementsQuery = trpc.achievement.playerList.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const updateDisplayNameMutation = trpc.auth.updateDisplayName.useMutation({
    onSuccess: async (result) => {
      const savedDisplayName = result.displayName;
      setDisplayName(savedDisplayName || "");
      await refresh();
      Alert.alert(
        "Display name saved",
        savedDisplayName ? "Other players will see your new display name." : "Your display name was cleared.",
      );
    },
    onError: (error) => Alert.alert("Unable to save display name", error.message),
  });

  const handleSaveDisplayName = () => {
    const normalizedDisplayName = displayName.trim();
    updateDisplayNameMutation.mutate({ displayName: normalizedDisplayName || null });
  };

  const player = playerQuery.data;
  const myGames = myGamesQuery.data || [];
  const activePowerUps = activePowerUpsQuery.data || [];
  const achievements = achievementsQuery.data || [];

  useEffect(() => {
    if (!myGamesQuery.isLoading && activeGameId && !myGames.some(game => game.id === activeGameId)) setActiveGameId(null);
  }, [activeGameId, myGames, myGamesQuery.isLoading, setActiveGameId]);

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-4xl">👤</Text>
          <Text className="text-foreground text-xl font-bold">Sign In Required</Text>
          <View className="w-full max-w-sm mt-2">
            <SignInForm />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* User Header */}
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-3">
            <Text className="text-3xl">🎯</Text>
          </View>
          <Text className="text-xl font-bold text-foreground">
            {user?.displayName?.trim() || user?.name?.trim() || (user ? `Player #${user.id}` : "Player")}
          </Text>
          <Text className="text-muted text-sm">{user?.email}</Text>
          <View className="w-full bg-surface rounded-xl p-4 mt-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-1">Display Name</Text>
            <Text className="text-xs text-muted mb-3">Shown to other players instead of your account name.</Text>
            <TextInput
              className="bg-background border border-border rounded-lg px-3 py-3 text-foreground"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter a display name"
              placeholderTextColor="#8A8A8A"
              maxLength={50}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSaveDisplayName}
            />
            <TouchableOpacity
              className={`mt-3 rounded-lg p-3 items-center ${updateDisplayNameMutation.isPending ? "bg-primary/50" : "bg-primary"}`}
              onPress={handleSaveDisplayName}
              disabled={updateDisplayNameMutation.isPending}
            >
              <Text className="text-background font-bold">
                {updateDisplayNameMutation.isPending ? "Saving…" : "Save Display Name"}
              </Text>
            </TouchableOpacity>
          </View>
          {user?.role === "admin" && (
            <View className="bg-primary/20 px-3 py-1 rounded-full mt-2">
              <Text className="text-primary text-xs font-bold">ADMIN</Text>
            </View>
          )}
        </View>

        {/* Current Game Stats */}
        {player && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">📊 Current Game Stats</Text>
            <View className="flex-row justify-between">
              <View className="items-center">
                <Text className="text-2xl font-bold text-foreground">{player.kills || 0}</Text>
                <Text className="text-xs text-muted">Kills</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold text-foreground">{player.deaths || 0}</Text>
                <Text className="text-xs text-muted">Deaths</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold text-primary">{player.points || 0}</Text>
                <Text className="text-xs text-muted">Points</Text>
              </View>
              <View className="items-center">
                <Text className={`text-2xl font-bold ${player.status === "alive" ? "text-success" : "text-error"}`}>
                  {player.status === "alive" ? "🟢" : "💀"}
                </Text>
                <Text className="text-xs text-muted">Status</Text>
              </View>
            </View>
          </View>
        )}

        {/* Active Power-Ups */}
        {activePowerUps.length > 0 && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">⚡ Active Power-Ups</Text>
            {activePowerUps.map((pp) => (
              <View key={pp.id} className={`flex-row items-center justify-between py-3 px-2 mb-2 rounded-lg border ${(pp.powerUp?.name === "Immunity Shield" || pp.powerUp?.name === "Untouchable") ? "border-primary bg-primary/10" : "border-border"}`}>
                <View><Text className="text-foreground text-sm font-bold">{pp.powerUp?.emoji} {pp.powerUp?.name || `Power-Up #${pp.powerUpId}`}</Text>{(pp.powerUp?.name === "Immunity Shield" || pp.powerUp?.name === "Untouchable") && <Text className="text-primary text-xs font-bold mt-1">🛡️ ACTIVE PROTECTION — show this screen as proof</Text>}</View>
                <Text className="text-muted text-xs">
                  {pp.pausedAt ? "Paused for Purge" : pp.expiresAt ? `Expires: ${new Date(pp.expiresAt).toLocaleString()}` : "Active until triggered"}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">🏅 Achievements ({achievements.length})</Text>
            <View className="flex-row flex-wrap gap-2">
              {achievements.map((a) => (
                <View key={a.id} className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-xs font-semibold">Badge #{a.achievementId}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* My Games */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-sm font-bold text-foreground mb-3">🎮 My Games</Text>
          {myGames.length === 0 ? (
            <Text className="text-muted text-sm">No games yet. Create or join one!</Text>
          ) : (
            myGames.map((g) => (
              <TouchableOpacity
                key={g.id}
                className={`flex-row items-center justify-between py-3 border-b border-border ${activeGameId === g.id ? "opacity-100" : "opacity-70"}`}
                onPress={() => setActiveGameId(g.id)}
              >
                <View>
                  <Text className="text-foreground font-semibold">{g.name}</Text>
                  <Text className="text-muted text-xs">{g.gameType.replace(/_/g, " ")} • {g.status}</Text>
                </View>
                {activeGameId === g.id && (
                  <View className="bg-success/20 px-2 py-1 rounded">
                    <Text className="text-success text-xs font-bold">ACTIVE</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Admin Panel Access */}
        {(user?.role === "admin" || user?.isSuperAdmin) && (
          <TouchableOpacity
            className="bg-primary rounded-xl p-4 mb-4 items-center"
            onPress={() => router.push("/admin" as any)}
          >
            <Text className="text-background font-bold text-base">👑 Admin Panel</Text>
            <Text className="text-background/70 text-xs mt-1">Manage games, players, and settings</Text>
          </TouchableOpacity>
        )}

        {/* Actions */}
        <View className="gap-3">
          <TouchableOpacity
            className="bg-surface border border-primary rounded-xl p-4 items-center"
            onPress={() => router.push("/admin/create-game" as any)}
          >
            <Text className="text-primary font-bold">+ Create New Game</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-border rounded-xl p-4 items-center"
            onPress={() => router.push("/kill-feed" as any)}
          >
            <Text className="text-foreground font-bold">💀 Kill Feed</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-border rounded-xl p-4 items-center"
            onPress={() => router.push("/game-history" as any)}
          >
            <Text className="text-foreground font-bold">🏁 Game History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-error rounded-xl p-4 items-center"
            onPress={() => {
              Alert.alert("Logout", "Are you sure?", [
                { text: "Cancel", style: "cancel" },
                { text: "Logout", style: "destructive", onPress: logout },
              ]);
            }}
          >
            <Text className="text-error font-bold">Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
