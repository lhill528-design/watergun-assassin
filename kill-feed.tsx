import { Text, View, FlatList, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

const EVENT_ICONS: Record<string, string> = {
  elimination_approved: "💀",
  elimination_denied: "❌",
  revival: "❤️",
  purge_start: "⚠️",
  purge_end: "🕊️",
  round_start: "🎯",
  round_end: "🏁",
  game_start: "🚀",
  game_end: "🏆",
  power_up_used: "⚡",
  achievement_earned: "🏅",
};

const EVENT_COLORS: Record<string, string> = {
  elimination_approved: "#00FF88",
  elimination_denied: "#FF3333",
  revival: "#FF1493",
  purge_start: "#FFB800",
  purge_end: "#00D4FF",
  round_start: "#00D4FF",
  round_end: "#8B8B9E",
  game_start: "#00FF88",
  game_end: "#FFB800",
  power_up_used: "#7B2FFF",
  achievement_earned: "#FFB800",
};

export default function KillFeedScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const feedQuery = trpc.killFeed.list.useQuery(
    { gameId: activeGameId!, limit: 100 },
    { enabled: !!activeGameId && isAuthenticated, refetchInterval: 5000 }
  );

  const events = feedQuery.data || [];

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-primary text-lg">←</Text>
        </TouchableOpacity>
        <View>
          <Text className="text-lg font-bold text-foreground">💀 Kill Feed</Text>
          <Text className="text-muted text-xs">Live game events</Text>
        </View>
      </View>

      {events.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-2">🔇</Text>
          <Text className="text-foreground font-bold">No events yet</Text>
          <Text className="text-muted text-sm">Game events will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View className="flex-row items-start gap-3 mb-4">
              <View className="w-10 h-10 rounded-full bg-surface items-center justify-center border border-border">
                <Text className="text-lg">{EVENT_ICONS[item.eventType] || "📌"}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-foreground text-sm font-medium">{item.message}</Text>
                <Text className="text-muted text-xs mt-1">
                  {new Date(item.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              <View className="w-2 h-2 rounded-full mt-2" style={{ backgroundColor: EVENT_COLORS[item.eventType] || "#8B8B9E" }} />
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}
