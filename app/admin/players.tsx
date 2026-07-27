import { Text, View, FlatList, TouchableOpacity, Alert, TextInput } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function AdminPlayersScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const playersQuery = trpc.player.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const updatePlayer = trpc.player.update.useMutation({ onSuccess: () => playersQuery.refetch() });
  const revivePlayer = trpc.player.revive.useMutation({ onSuccess: () => { playersQuery.refetch(); Alert.alert("Player Revived!"); } });

  const players = playersQuery.data || [];
  const getPlayerName = (player: (typeof players)[number]) => {
    const playerUser = (player as any).user;
    return playerUser?.displayName?.trim() || playerUser?.name?.trim() || `Player #${player.userId}`;
  };
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredPlayers = normalizedSearchQuery
    ? players.filter(player => getPlayerName(player).toLocaleLowerCase().includes(normalizedSearchQuery))
    : players;

  const handleMarkPaid = (playerId: number, currentPaid: boolean) => {
    updatePlayer.mutate({ playerId, hasPaid: !currentPaid });
  };

  const handleMarkSafe = (playerId: number) => {
    Alert.alert("Mark Safe", "Mark this player as safe?", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => updatePlayer.mutate({ playerId, status: "safe" }) },
    ]);
  };

  const handleRevive = (playerId: number) => {
    Alert.alert("Revive Player", "Bring this player back to life?", [
      { text: "Cancel", style: "cancel" },
      { text: "Revive", onPress: () => revivePlayer.mutate({ playerId, gameId: activeGameId! }) },
    ]);
  };

  const handleEliminate = (playerId: number) => {
    Alert.alert("Eliminate Player", "Manually eliminate this player?", [
      { text: "Cancel", style: "cancel" },
      { text: "Eliminate", style: "destructive", onPress: () => updatePlayer.mutate({ playerId, status: "eliminated" }) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-primary text-lg">←</Text>
        </TouchableOpacity>
        <View>
          <Text className="text-lg font-bold text-foreground">👥 Player Management</Text>
          <Text className="text-muted text-xs">
            {normalizedSearchQuery ? `${filteredPlayers.length} of ${players.length} players` : `${players.length} players`}
          </Text>
        </View>
      </View>

      <View className="px-4 pt-4">
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search player display names"
          placeholderTextColor="#8B8B9E"
          autoCorrect={false}
          clearButtonMode="while-editing"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
        />
      </View>

      <FlatList
        data={filteredPlayers}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          normalizedSearchQuery ? (
            <View className="bg-surface rounded-xl p-6 border border-border items-center">
              <Text className="text-muted">No players match that display name.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View className="bg-surface rounded-xl p-4 mb-3 border border-border">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-3">
                <View className={`w-3 h-3 rounded-full ${item.status === "alive" ? "bg-success" : item.status === "safe" ? "bg-warning" : "bg-error"}`} />
                <View>
                  <Text className="text-foreground font-bold">{getPlayerName(item)}</Text>
                  <Text className="text-muted text-xs">{item.status} • {item.points || 0} pts • {item.kills || 0} kills</Text>
                </View>
              </View>
              <View className="flex-row items-center gap-1">
                <TouchableOpacity
                  className={`px-2 py-1 rounded ${item.hasPaid ? "bg-success/20" : "bg-error/20"}`}
                  onPress={() => handleMarkPaid(item.id, !!item.hasPaid)}
                >
                  <Text className={`text-xs font-bold ${item.hasPaid ? "text-success" : "text-error"}`}>
                    {item.hasPaid ? "PAID ✓" : "UNPAID"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Actions */}
            <View className="flex-row gap-2">
              {item.status === "eliminated" && (
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-lg py-2 items-center"
                  onPress={() => handleRevive(item.id)}
                >
                  <Text className="text-primary text-xs font-bold">❤️ Revive</Text>
                </TouchableOpacity>
              )}
              {item.status === "alive" && (
                <>
                  <TouchableOpacity
                    className="flex-1 bg-warning/20 border border-warning rounded-lg py-2 items-center"
                    onPress={() => handleMarkSafe(item.id)}
                  >
                    <Text className="text-warning text-xs font-bold">🛡️ Safe</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error/20 border border-error rounded-lg py-2 items-center"
                    onPress={() => handleEliminate(item.id)}
                  >
                    <Text className="text-error text-xs font-bold">💀 Eliminate</Text>
                  </TouchableOpacity>
                </>
              )}
              {item.status === "safe" && (
                <TouchableOpacity
                  className="flex-1 bg-success/20 border border-success rounded-lg py-2 items-center"
                  onPress={() => updatePlayer.mutate({ playerId: item.id, status: "alive" })}
                >
                  <Text className="text-success text-xs font-bold">🔓 Remove Safe</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </ScreenContainer>
  );
}
