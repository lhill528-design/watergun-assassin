import { Text, View, FlatList, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function BountyBoardScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [bountyAmount, setBountyAmount] = useState("");

  const boardQuery = trpc.bounty.board.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId }
  );
  const playersQuery = trpc.player.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId }
  );
  const placeMutation = trpc.bounty.place.useMutation({
    onSuccess: () => {
      boardQuery.refetch();
      setBountyAmount("");
      setSelectedPlayer(null);
      Alert.alert("Bounty Placed", "Your bounty has been placed!");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const board = boardQuery.data || [];
  const players = playersQuery.data || [];

  const handlePlaceBounty = () => {
    if (!selectedPlayer || !bountyAmount || !activeGameId) return;
    const amount = parseInt(bountyAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert("Invalid", "Enter a valid point amount");
      return;
    }
    placeMutation.mutate({ gameId: activeGameId, targetPlayerId: selectedPlayer, amount });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text className="text-primary text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-foreground text-xl font-bold ml-2">🎯 Bounty Board</Text>
      </View>

      {/* Place Bounty Section */}
      <View className="bg-surface mx-4 mt-4 rounded-xl p-4 border border-border">
        <Text className="text-foreground font-bold text-sm mb-3">Place a Bounty</Text>
        <View className="flex-row gap-2 mb-3 flex-wrap">
          {players.filter(p => p.status === "alive").map((p) => (
            <TouchableOpacity
              key={p.id}
              style={{ opacity: selectedPlayer === p.id ? 1 : 0.5, backgroundColor: selectedPlayer === p.id ? "#FF1493" : "#2a2a2a", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}
              onPress={() => setSelectedPlayer(p.id)}
            >
              <Text className="text-foreground text-xs">{(p as any).user?.name || `Player #${p.id}`}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row gap-2">
          <TextInput
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground"
            placeholder="Points amount"
            placeholderTextColor="#666"
            keyboardType="numeric"
            value={bountyAmount}
            onChangeText={setBountyAmount}
          />
          <TouchableOpacity
            className="bg-primary px-4 py-2 rounded-lg justify-center"
            onPress={handlePlaceBounty}
            disabled={!selectedPlayer || !bountyAmount}
          >
            <Text className="text-background font-bold text-sm">Place</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bounty Board List */}
      <View className="px-4 mt-4 mb-2">
        <Text className="text-muted text-xs uppercase tracking-wider">Active Bounties</Text>
      </View>

      <FlatList
        data={board}
        keyExtractor={(item) => item.playerId.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-4xl mb-2">🕊️</Text>
            <Text className="text-muted text-base">No active bounties</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View className="bg-surface rounded-xl p-4 mb-3 border border-border flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-8 h-8 rounded-full bg-error/20 items-center justify-center">
                <Text className="text-error font-bold text-sm">#{index + 1}</Text>
              </View>
              <View>
                <Text className="text-foreground font-bold">{item.playerName}</Text>
                <Text className="text-muted text-xs">{item.bountyCount} bounties placed</Text>
              </View>
            </View>
            <View className="items-end">
              <Text className="text-error font-bold text-lg">{item.bountyPoints}</Text>
              <Text className="text-muted text-xs">points</Text>
            </View>
          </View>
        )}
      />
    </ScreenContainer>
  );
}
