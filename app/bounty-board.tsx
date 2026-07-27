import { Text, View, FlatList, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function BountyBoardScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();

  const boardQuery = trpc.bounty.board.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId }
  );

  const board = boardQuery.data || [];

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text className="text-primary text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-foreground text-xl font-bold ml-2">🎯 Bounty Board</Text>
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
