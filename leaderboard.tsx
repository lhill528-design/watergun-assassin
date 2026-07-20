import { Text, View, FlatList, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

type SortKey = "points" | "kills" | "bountyPoints";

export default function LeaderboardScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [sortBy, setSortBy] = useState<SortKey>("points");

  const leaderboardQuery = trpc.game.leaderboard.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId }
  );

  const data = leaderboardQuery.data || [];
  const sorted = [...data].sort((a, b) => {
    if (sortBy === "points") return (b.points || 0) - (a.points || 0);
    if (sortBy === "kills") return (b.kills || 0) - (a.kills || 0);
    return (b.bountyPoints || 0) - (a.bountyPoints || 0);
  });

  const getMedalEmoji = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text className="text-primary text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-foreground text-xl font-bold ml-2">🏆 Leaderboard</Text>
      </View>

      {/* Sort Tabs */}
      <View className="flex-row px-4 py-3 gap-2">
        {([
          { key: "points" as SortKey, label: "Points" },
          { key: "kills" as SortKey, label: "Kills" },
          { key: "bountyPoints" as SortKey, label: "Bounty Value" },
        ]).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: sortBy === tab.key ? "#FF1493" : "#2a2a2a" }}
            onPress={() => setSortBy(tab.key)}
          >
            <Text style={{ color: sortBy === tab.key ? "#000" : "#aaa", fontWeight: "700", fontSize: 12 }}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-4xl mb-2">🏆</Text>
            <Text className="text-muted text-base">No players yet</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const rank = index + 1;
          const isTop3 = rank <= 3;
          return (
            <View className={`rounded-xl p-4 mb-3 flex-row items-center justify-between ${isTop3 ? "bg-primary/10 border border-primary/30" : "bg-surface border border-border"}`}>
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: isTop3 ? "rgba(255,20,147,0.2)" : "rgba(100,100,100,0.2)" }}>
                  <Text className="font-bold text-sm" style={{ color: isTop3 ? "#FF1493" : "#aaa" }}>{getMedalEmoji(rank)}</Text>
                </View>
                <View>
                  <Text className="text-foreground font-bold">{(item as any).user?.name || `Player #${item.id}`}</Text>
                  <Text className="text-muted text-xs">
                    {item.status === "alive" ? "🟢 Alive" : item.status === "safe" ? "🛡️ Safe" : "💀 Eliminated"}
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text className="text-foreground font-bold text-lg">
                  {sortBy === "points" ? item.points || 0 : sortBy === "kills" ? item.kills || 0 : item.bountyPoints || 0}
                </Text>
                <Text className="text-muted text-xs">{sortBy}</Text>
              </View>
            </View>
          );
        }}
      />
    </ScreenContainer>
  );
}
