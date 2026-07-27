import { Text, View, FlatList, TouchableOpacity, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function AdminEliminationsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();

  const pendingQuery = trpc.elimination.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const reviewMutation = trpc.elimination.review.useMutation({
    onSuccess: () => { pendingQuery.refetch(); Alert.alert("Review Submitted!"); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const duelsQuery = trpc.duel.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const resolveDuelMutation = trpc.duel.resolve.useMutation({
    onSuccess: () => { duelsQuery.refetch(); Alert.alert("Duel Resolved!"); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const pending = pendingQuery.data || [];
  const pendingDuels = duelsQuery.data || [];

  const playerLabel = (p: any) => p?.displayName?.trim() || p?.user?.displayName?.trim() || p?.user?.name?.trim() || `Player #${p?.userId ?? "?"}`;

  const handlePickWinner = (duelId: number, winnerId: number, winnerName: string) => {
    Alert.alert("Confirm Winner", `Declare ${winnerName} the winner of this duel?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => resolveDuelMutation.mutate({ gameId: activeGameId!, duelId, winnerId }) },
    ]);
  };

  const handleReview = (eliminationId: number, approved: boolean) => {
    const title = approved ? "Approve Elimination" : "Deny Elimination";
    const message = approved ? "Confirm this elimination?" : "Deny this elimination claim?";
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => reviewMutation.mutate({ eliminationId, gameId: activeGameId!, approved }) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Text className="text-primary text-lg">←</Text>
        </TouchableOpacity>
        <View>
          <Text className="text-lg font-bold text-foreground">📹 Elimination Review</Text>
          <Text className="text-muted text-xs">{pending.length} pending</Text>
        </View>
      </View>

      {pendingDuels.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-foreground font-bold mb-2">🎯 Pending Duels ({pendingDuels.length})</Text>
          {pendingDuels.map((duel: any) => (
            <View key={duel.id} className="bg-surface rounded-xl p-4 mb-3 border border-warning">
              <Text className="text-foreground font-semibold mb-3">
                {playerLabel(duel.challenger)} vs {playerLabel(duel.opponent)}
              </Text>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                  onPress={() => handlePickWinner(duel.id, duel.challengerId, playerLabel(duel.challenger))}
                >
                  <Text className="text-primary font-bold" numberOfLines={1}>{playerLabel(duel.challenger)} Wins</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                  onPress={() => handlePickWinner(duel.id, duel.opponentId, playerLabel(duel.opponent))}
                >
                  <Text className="text-primary font-bold" numberOfLines={1}>{playerLabel(duel.opponent)} Wins</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {pending.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-2">✅</Text>
          <Text className="text-foreground font-bold">All Caught Up!</Text>
          <Text className="text-muted text-sm">No pending eliminations to review</Text>
        </View>
      ) : (
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View className="bg-surface rounded-xl p-4 mb-3 border border-border">
              <View className="flex-row items-center justify-between mb-3">
                <View>
                  <Text className="text-foreground font-bold">Elimination Claim</Text>
                  <Text className="text-muted text-xs">
                    Player #{item.eliminatorId} → Player #{item.eliminatedId}
                  </Text>
                  <Text className="text-muted text-xs">Round {item.round} • {new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                <View className="bg-warning/20 px-2 py-1 rounded">
                  <Text className="text-warning text-xs font-bold">PENDING</Text>
                </View>
              </View>

              {/* Video Evidence */}
              {item.videoUrl && item.videoUrl !== "pending-upload" && (
                <View className="bg-background rounded-lg p-3 mb-3 border border-border">
                  <Text className="text-muted text-xs">📹 Video evidence attached</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-success/20 border border-success rounded-xl py-3 items-center"
                  onPress={() => handleReview(item.id, true)}
                >
                  <Text className="text-success font-bold">✅ Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-error/20 border border-error rounded-xl py-3 items-center"
                  onPress={() => handleReview(item.id, false)}
                >
                  <Text className="text-error font-bold">❌ Deny</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}
