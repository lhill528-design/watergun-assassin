import { Text, View, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function AdminTargetsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const playersQuery = trpc.player.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const updatePlayer = trpc.player.update.useMutation({ onSuccess: () => playersQuery.refetch() });
  const updateGame = trpc.game.update.useMutation({ onSuccess: () => gameQuery.refetch() });

  const game = gameQuery.data;
  const players = playersQuery.data || [];
  const alivePlayers = players.filter(p => p.status === "alive");

  const handleAutoAssign = () => {
    if (alivePlayers.length < 2) {
      Alert.alert("Error", "Need at least 2 alive players to assign targets");
      return;
    }
    Alert.alert("Auto-Assign Targets", `Randomly assign targets for ${alivePlayers.length} alive players?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Assign",
        onPress: () => {
          // Create circular target chain
          const shuffled = [...alivePlayers].sort(() => Math.random() - 0.5);
          shuffled.forEach((player, index) => {
            const targetIndex = (index + 1) % shuffled.length;
            updatePlayer.mutate({ playerId: player.id, targetId: shuffled[targetIndex].id });
          });
          Alert.alert("Done!", "Targets have been assigned in a circular chain.");
        },
      },
    ]);
  };

  const handleClearTargets = () => {
    Alert.alert("Clear All Targets", "Remove all target assignments?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          players.forEach((p) => {
            updatePlayer.mutate({ playerId: p.id, targetId: 0 });
          });
        },
      },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-xl font-bold text-foreground">🎯 Target Assignment</Text>
            <Text className="text-muted text-xs">Mode: {game?.targetAssignment || "auto"}</Text>
          </View>
        </View>

        {/* Mode Toggle */}
        <View className="flex-row gap-3 mb-4">
          <TouchableOpacity
            className={`flex-1 p-3 rounded-xl border items-center ${game?.targetAssignment === "auto" ? "bg-primary/20 border-primary" : "bg-surface border-border"}`}
            onPress={() => updateGame.mutate({ gameId: activeGameId!, targetAssignment: "auto" })}
          >
            <Text className={`font-bold ${game?.targetAssignment === "auto" ? "text-primary" : "text-foreground"}`}>🔄 Auto</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 p-3 rounded-xl border items-center ${game?.targetAssignment === "manual" ? "bg-primary/20 border-primary" : "bg-surface border-border"}`}
            onPress={() => updateGame.mutate({ gameId: activeGameId!, targetAssignment: "manual" })}
          >
            <Text className={`font-bold ${game?.targetAssignment === "manual" ? "text-primary" : "text-foreground"}`}>✋ Manual</Text>
          </TouchableOpacity>
        </View>

        {/* Actions */}
        <View className="gap-3 mb-6">
          <TouchableOpacity
            className="bg-primary/20 border border-primary rounded-xl p-4 items-center"
            onPress={handleAutoAssign}
          >
            <Text className="text-primary font-bold">🔄 Auto-Assign All Targets</Text>
            <Text className="text-primary/70 text-xs mt-1">Creates circular target chain</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="bg-error/20 border border-error rounded-xl p-4 items-center"
            onPress={handleClearTargets}
          >
            <Text className="text-error font-bold">🗑️ Clear All Targets</Text>
          </TouchableOpacity>
        </View>

        {/* Player Target List */}
        <Text className="text-sm font-bold text-foreground mb-3">Current Assignments</Text>
        {alivePlayers.length === 0 ? (
          <View className="bg-surface rounded-xl p-6 border border-border items-center">
            <Text className="text-muted">No alive players</Text>
          </View>
        ) : (
          <View className="gap-2">
            {alivePlayers.map((p) => {
              const target = players.find(t => t.id === p.targetId);
              return (
                <View key={p.id} className="bg-surface rounded-xl p-4 border border-border">
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text className="text-foreground font-bold">Player #{p.userId}</Text>
                      <Text className="text-muted text-xs">{p.kills || 0} kills • {p.points || 0} pts</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs text-muted">Target →</Text>
                      <Text className="text-primary font-bold text-sm">
                        {target ? `Player #${target.userId}` : "None"}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
