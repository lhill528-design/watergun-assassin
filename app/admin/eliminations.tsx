import { Text, View, FlatList, TouchableOpacity, Alert, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function AdminEliminationsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();

  const pendingQuery = trpc.elimination.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const reviewMutation = trpc.elimination.review.useMutation({
    onSuccess: () => {
      pendingQuery.refetch();
      // Approving an elimination can immediately award the eliminator an
      // achievement (and its points) server-side.
      utils.player.list.invalidate({ gameId: activeGameId! });
      utils.game.leaderboard.invalidate({ gameId: activeGameId! });
      utils.achievement.playerList.invalidate({ gameId: activeGameId! });
      Alert.alert("Review Submitted!");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const duelsQuery = trpc.duel.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const resolveDuelMutation = trpc.duel.resolve.useMutation({
    onSuccess: () => { duelsQuery.refetch(); Alert.alert("Duel Resolved!"); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const sanctuariesQuery = trpc.powerUp.pendingSanctuaries.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const approveSanctuaryMutation = trpc.powerUp.approveSanctuary.useMutation({
    onSuccess: () => { sanctuariesQuery.refetch(); Alert.alert("Sanctuary Approved!"); },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const rejectSanctuaryMutation = trpc.powerUp.rejectSanctuary.useMutation({
    onSuccess: () => { sanctuariesQuery.refetch(); Alert.alert("Sanctuary Returned", "The player can submit a different address."); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const pending = pendingQuery.data || [];
  const pendingDuels = duelsQuery.data || [];
  const pendingSanctuaries = sanctuariesQuery.data || [];

  const playerLabel = (p: any) => p?.displayName?.trim() || p?.user?.displayName?.trim() || p?.user?.name?.trim() || `Player #${p?.userId ?? "?"}`;

  const handleDuelReview = (duelId: number, approved: boolean, winnerName: string) => {
    Alert.alert(approved ? "Approve Duel Result" : "Reject Duel Result", approved ? `Approve ${winnerName} as the submitted winner for 350 points and the loser's stake?` : "Reject this result and unlock both stakes?", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => resolveDuelMutation.mutate({ gameId: activeGameId!, duelId, approved }) },
    ]);
  };

  const handleApproveSanctuary = (inventoryId: number, playerName: string) => {
    Alert.alert("Approve Sanctuary", `Approve ${playerName}'s sanctuary and show it on the map?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => approveSanctuaryMutation.mutate({ gameId: activeGameId!, inventoryId }) },
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
              <Text className="text-muted text-xs mb-2">Submitted winner: {duel.proposedWinnerId === duel.challengerId ? playerLabel(duel.challenger) : playerLabel(duel.opponent)}</Text>
              {duel.witnessName ? <Text className="text-muted text-xs mb-2">Witness: {duel.witnessName}</Text> : null}
              {duel.evidenceUrl ? <TouchableOpacity className="mb-3" onPress={() => Linking.openURL(duel.evidenceUrl)}><Text className="text-primary font-bold">▶ View duel video</Text></TouchableOpacity> : null}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                  onPress={() => handleDuelReview(duel.id, true, duel.proposedWinnerId === duel.challengerId ? playerLabel(duel.challenger) : playerLabel(duel.opponent))}
                >
                  <Text className="text-primary font-bold">Approve Result</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                  onPress={() => handleDuelReview(duel.id, false, "")}
                >
                  <Text className="text-error font-bold">Reject Result</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {pendingSanctuaries.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-foreground font-bold mb-2">⛪ Pending Sanctuary Requests ({pendingSanctuaries.length})</Text>
          {pendingSanctuaries.map((item: any) => {
            const zone = item.activationData as { zoneLatitude?: string; zoneLongitude?: string } | null;
            const name = playerLabel(item.player);
            return (
              <View key={item.id} className="bg-surface rounded-xl p-4 mb-3 border border-warning">
                <Text className="text-foreground font-semibold mb-1">{name}</Text>
                <Text className="text-muted text-xs mb-3">📍 {zone?.zoneLatitude}, {zone?.zoneLongitude}</Text>
                <View className="flex-row gap-3"><TouchableOpacity className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center" onPress={() => handleApproveSanctuary(item.id, name)}><Text className="text-primary font-bold">✅ Approve</Text></TouchableOpacity><TouchableOpacity className="flex-1 bg-error/20 border border-error rounded-xl py-3 items-center" onPress={() => rejectSanctuaryMutation.mutate({ gameId: activeGameId!, inventoryId: item.id })}><Text className="text-error font-bold">Return</Text></TouchableOpacity></View>
              </View>
            );
          })}
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
                    {playerLabel((item as any).eliminator)} → {playerLabel((item as any).eliminated)}
                  </Text>
                  <Text className="text-muted text-xs">Round {item.round} • {new Date(item.createdAt).toLocaleDateString()}</Text>
                  {(item as any).activeProtection && <Text className="text-primary text-xs font-bold">🛡️ Active: {(item as any).activeProtection}</Text>}
                </View>
                <View className="bg-warning/20 px-2 py-1 rounded">
                  <Text className="text-warning text-xs font-bold">PENDING</Text>
                </View>
              </View>

              {/* Video Evidence */}
              {item.videoUrl && item.videoUrl !== "pending-upload" && (
                <TouchableOpacity className="bg-background rounded-lg p-3 mb-3 border border-primary" onPress={() => Linking.openURL(item.videoUrl!)}><Text className="text-primary font-bold">▶ Play video evidence</Text></TouchableOpacity>
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
