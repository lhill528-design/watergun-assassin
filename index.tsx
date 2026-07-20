import { Text, View, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

export default function AdminDashboard() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  const gameQuery = trpc.game.get.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const playersQuery = trpc.player.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const pendingQuery = trpc.elimination.pending.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );

  const game = gameQuery.data;
  const players = playersQuery.data || [];
  const pending = pendingQuery.data || [];

  const alivePlayers = players.filter(p => p.status === "alive");
  const eliminatedPlayers = players.filter(p => p.status === "eliminated");
  const paidPlayers = players.filter(p => p.hasPaid);

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-2xl font-bold text-foreground">👑 Admin Panel</Text>
            <Text className="text-muted text-sm">{game?.name || "No active game"}</Text>
          </View>
        </View>

        {!activeGameId ? (
          <View className="items-center py-12">
            <Text className="text-muted">Select or create a game first</Text>
            <TouchableOpacity
              className="bg-primary px-6 py-3 rounded-full mt-4"
              onPress={() => router.push("/admin/create-game" as any)}
            >
              <Text className="text-background font-bold">Create Game</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {/* Stats Overview */}
            <View className="flex-row gap-3 mb-4">
              <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
                <Text className="text-2xl font-bold text-success">{alivePlayers.length}</Text>
                <Text className="text-xs text-muted">Alive</Text>
              </View>
              <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
                <Text className="text-2xl font-bold text-error">{eliminatedPlayers.length}</Text>
                <Text className="text-xs text-muted">Eliminated</Text>
              </View>
              <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
                <Text className="text-2xl font-bold text-warning">{pending.length}</Text>
                <Text className="text-xs text-muted">Pending</Text>
              </View>
              <View className="flex-1 bg-surface rounded-xl p-3 border border-border items-center">
                <Text className="text-2xl font-bold text-primary">{paidPlayers.length}/{players.length}</Text>
                <Text className="text-xs text-muted">Paid</Text>
              </View>
            </View>

            {/* Game Status */}
            <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-xs text-muted uppercase">Status</Text>
                  <Text className="text-foreground font-bold">{game?.status?.toUpperCase()}</Text>
                </View>
                <View>
                  <Text className="text-xs text-muted uppercase">Round</Text>
                  <Text className="text-foreground font-bold">{game?.currentRound || 0}</Text>
                </View>
                <View>
                  <Text className="text-xs text-muted uppercase">Purge</Text>
                  <Text className={`font-bold ${game?.purgeActive ? "text-error" : "text-muted"}`}>
                    {game?.purgeActive ? "ACTIVE" : "OFF"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Actions */}
            <Text className="text-sm font-bold text-foreground mb-3">⚡ Quick Actions</Text>
            <View className="gap-3 mb-6">
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-success/20 border border-success rounded-xl p-3 items-center"
                  onPress={() => router.push("/admin/round-control" as any)}
                >
                  <Text className="text-success font-bold text-sm">🎯 Round Control</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-error/20 border border-error rounded-xl p-3 items-center"
                  onPress={() => router.push("/admin/round-control" as any)}
                >
                  <Text className="text-error font-bold text-sm">⚠️ Purge Control</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-warning/20 border border-warning rounded-xl p-3 items-center"
                  onPress={() => router.push("/admin/eliminations" as any)}
                >
                  <Text className="text-warning font-bold text-sm">📹 Review ({pending.length})</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-xl p-3 items-center"
                  onPress={() => router.push("/admin/players" as any)}
                >
                  <Text className="text-primary font-bold text-sm">👥 Players</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Management Sections */}
            <Text className="text-sm font-bold text-foreground mb-3">🔧 Management</Text>
            <View className="gap-2">
              {[
                { title: "Game Setup", icon: "⚙️", route: "/admin/game-setup" },
                { title: "Rules Manager", icon: "📜", route: "/admin/rules" },
                { title: "Power-Up Setup", icon: "⚡", route: "/admin/power-ups" },
                { title: "Roulette Setup", icon: "🎰", route: "/admin/roulette" },
                { title: "Map Power-Ups", icon: "🗺️", route: "/admin/map-powerups" },
                { title: "Achievements", icon: "🏅", route: "/admin/achievements" },
                { title: "Target Assignment", icon: "🎯", route: "/admin/targets" },
                { title: "Create New Game", icon: "➕", route: "/admin/create-game" },
              ].map((item) => (
                <TouchableOpacity
                  key={item.route}
                  className="bg-surface rounded-xl p-4 border border-border flex-row items-center justify-between"
                  onPress={() => router.push(item.route as any)}
                >
                  <View className="flex-row items-center gap-3">
                    <Text className="text-lg">{item.icon}</Text>
                    <Text className="text-foreground font-semibold">{item.title}</Text>
                  </View>
                  <Text className="text-muted">→</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
