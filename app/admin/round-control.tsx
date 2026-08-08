import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function RoundControlScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [purgeDuration, setPurgeDuration] = useState("60");
  const [purgeSchedule, setPurgeSchedule] = useState("");

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const startRound = trpc.game.startRound.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Round Started!"); } });
  const endRound = trpc.game.endRound.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Round Ended!"); } });
  const startPurge = trpc.game.startPurge.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Purge Activated!"); } });
  const endPurge = trpc.game.endPurge.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Purge Ended!"); } });
  const schedulePurge = trpc.game.schedulePurge.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Purge Schedule Updated"); }, onError: error => Alert.alert("Could not schedule", error.message) });
  const endGame = trpc.game.endGame.useMutation({ onSuccess: () => { gameQuery.refetch(); Alert.alert("Game Over!"); } });
  const updateGame = trpc.game.update.useMutation({ onSuccess: () => gameQuery.refetch() });

  const game = gameQuery.data;

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: onConfirm },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-foreground">🎮 Round Control</Text>
        </View>

        {/* Current Status */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-sm font-bold text-foreground mb-3">Current Status</Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-muted">Game</Text>
              <Text className="text-foreground font-bold">{game?.status?.toUpperCase()}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Round</Text>
              <Text className="text-foreground font-bold">{game?.currentRound || 0}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Purge</Text>
              <Text className={`font-bold ${game?.purgeActive ? "text-error" : "text-success"}`}>
                {game?.purgeActive ? "ACTIVE" : "INACTIVE"}
              </Text>
            </View>
          </View>
        </View>

        {/* Round Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">🎯 Round Management</Text>
        <View className="gap-3 mb-6">
          <TouchableOpacity
            className="bg-success/20 border border-success rounded-xl p-4 items-center"
            onPress={() => confirmAction("Start Round", `Start Round ${(game?.currentRound || 0) + 1}?`, () => startRound.mutate({ gameId: activeGameId! }))}
          >
            <Text className="text-success font-bold text-base">▶️ Start New Round</Text>
            <Text className="text-success/70 text-xs mt-1">Begins Round {(game?.currentRound || 0) + 1}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-warning/20 border border-warning rounded-xl p-4 items-center"
            onPress={() => confirmAction("End Round", "End the current round early?", () => endRound.mutate({ gameId: activeGameId! }))}
          >
            <Text className="text-warning font-bold text-base">⏹️ End Round Early</Text>
          </TouchableOpacity>
        </View>

        {/* Purge Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">⚠️ Purge Control</Text>
        <View className="gap-3 mb-6">
          {!game?.purgeActive ? (
            <View>
              <Text className="text-muted text-xs mb-2">Scheduled purge (ISO date/time, e.g. 2026-08-04T18:00:00-04:00)</Text>
              <View className="flex-row gap-2 mb-4"><TextInput className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-foreground" value={purgeSchedule} onChangeText={setPurgeSchedule} placeholder={game?.purgeScheduledAt ? new Date(game.purgeScheduledAt).toISOString() : "Future date/time"} placeholderTextColor="#777"/><TouchableOpacity className="bg-warning/20 border border-warning rounded-lg px-3 justify-center" onPress={() => schedulePurge.mutate({ gameId: activeGameId!, startsAt: purgeSchedule.trim() || null })}><Text className="text-warning font-bold">Save</Text></TouchableOpacity></View>
              <View className="flex-row items-center gap-3 mb-3">
                <Text className="text-foreground text-sm">Duration (minutes):</Text>
                <TextInput
                  className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground w-20 text-center"
                  value={purgeDuration}
                  onChangeText={setPurgeDuration}
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity
                className="bg-error/20 border border-error rounded-xl p-4 items-center"
                onPress={() => confirmAction("Start Purge", `Activate ${purgeDuration} minute purge? All players can be eliminated by anyone!`, () => startPurge.mutate({ gameId: activeGameId!, durationMinutes: parseInt(purgeDuration) || 60 }))}
              >
                <Text className="text-error font-bold text-base">⚠️ ACTIVATE PURGE</Text>
                <Text className="text-error/70 text-xs mt-1">All players become targets</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              className="bg-success/20 border border-success rounded-xl p-4 items-center"
              onPress={() => confirmAction("End Purge", "End the purge and return to normal play?", () => endPurge.mutate({ gameId: activeGameId! }))}
            >
              <Text className="text-success font-bold text-base">🕊️ End Purge</Text>
              <Text className="text-success/70 text-xs mt-1">Return to normal rules</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Game Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">🏁 Game Control</Text>
        <View className="gap-3">
          {game?.status === "paused" && (
            <TouchableOpacity
              className="bg-success/20 border border-success rounded-xl p-4 items-center"
              onPress={() => updateGame.mutate({ gameId: activeGameId!, status: "active" })}
            >
              <Text className="text-success font-bold">▶️ Resume Game</Text>
            </TouchableOpacity>
          )}
          {game?.status === "active" && (
            <TouchableOpacity
              className="bg-warning/20 border border-warning rounded-xl p-4 items-center"
              onPress={() => confirmAction("Pause Game", "Pause the game?", () => updateGame.mutate({ gameId: activeGameId!, status: "paused" }))}
            >
              <Text className="text-warning font-bold">⏸️ Pause Game</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="bg-error/20 border border-error rounded-xl p-4 items-center"
            onPress={() => confirmAction("End Game", "This will end the game permanently. Are you sure?", () => endGame.mutate({ gameId: activeGameId! }))}
          >
            <Text className="text-error font-bold">🏁 End Game</Text>
            <Text className="text-error/70 text-xs mt-1">Cannot be undone</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
