import { Text, View, FlatList, TouchableOpacity, Alert, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";

type ActionMessage = { kind: "success" | "error"; text: string } | null;

export default function AdminEliminationsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();

  const pendingQuery = trpc.elimination.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const [reviewMessage, setReviewMessage] = useState<ActionMessage>(null);
  // Ref-backed so the guard is checked synchronously (see
  // requestConfirmedAction) -- a rapid second click on any elimination's
  // Approve/Deny before React re-renders the disabled buttons still can't
  // start a second review. Shared across every elimination in the list:
  // only one review runs at a time.
  const isReviewingRef = useRef(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const reviewMutation = trpc.elimination.review.useMutation({
    onSuccess: (_data, variables) => {
      pendingQuery.refetch();
      // Approving an elimination can immediately award the eliminator an
      // achievement (and its points) server-side.
      utils.player.list.invalidate({ gameId: activeGameId! });
      utils.game.leaderboard.invalidate({ gameId: activeGameId! });
      utils.achievement.playerList.invalidate({ gameId: activeGameId! });
      const text = variables.approved ? "Elimination approved." : "Elimination denied.";
      setReviewMessage({ kind: "success", text });
      if (Platform.OS !== "web") Alert.alert("Review Submitted!");
    },
    onError: (err) => {
      setReviewMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const duelsQuery = trpc.duel.pending.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const [duelMessage, setDuelMessage] = useState<ActionMessage>(null);
  const isResolvingDuelRef = useRef(false);
  const [resolvingDuelId, setResolvingDuelId] = useState<number | null>(null);
  const resolveDuelMutation = trpc.duel.resolve.useMutation({
    onSuccess: (_data, variables) => {
      duelsQuery.refetch();
      const text = variables.approved ? "Duel result approved." : "Duel result rejected.";
      setDuelMessage({ kind: "success", text });
      if (Platform.OS !== "web") Alert.alert("Duel Resolved!");
    },
    onError: (err) => {
      setDuelMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const sanctuariesQuery = trpc.powerUp.pendingSanctuaries.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const [sanctuaryMessage, setSanctuaryMessage] = useState<ActionMessage>(null);
  const isReviewingSanctuaryRef = useRef(false);
  const [reviewingSanctuaryId, setReviewingSanctuaryId] = useState<number | null>(null);
  const approveSanctuaryMutation = trpc.powerUp.approveSanctuary.useMutation({
    onSuccess: () => {
      sanctuariesQuery.refetch();
      setSanctuaryMessage({ kind: "success", text: "Sanctuary approved." });
      if (Platform.OS !== "web") Alert.alert("Sanctuary Approved!");
    },
    onError: (err) => {
      setSanctuaryMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });
  const rejectSanctuaryMutation = trpc.powerUp.rejectSanctuary.useMutation({
    onSuccess: () => {
      sanctuariesQuery.refetch();
      setSanctuaryMessage({ kind: "success", text: "Sanctuary returned. The player can submit a different address." });
      if (Platform.OS !== "web") Alert.alert("Sanctuary Returned", "The player can submit a different address.");
    },
    onError: (err) => {
      setSanctuaryMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const pending = pendingQuery.data || [];
  const pendingDuels = duelsQuery.data || [];
  const pendingSanctuaries = sanctuariesQuery.data || [];

  const playerLabel = (p: any) => p?.displayName?.trim() || p?.user?.displayName?.trim() || p?.user?.name?.trim() || `Player #${p?.userId ?? "?"}`;

  const handleDuelReview = (duelId: number, approved: boolean, winnerName: string) => {
    setDuelMessage(null);
    requestConfirmedAction({
      title: approved ? "Approve Duel Result" : "Reject Duel Result",
      message: approved
        ? `Approve ${winnerName} as the submitted winner for 350 points and the loser's stake?`
        : "Reject this result and unlock both stakes?",
      confirmLabel: approved ? "Approve" : "Reject",
      isRunning: isResolvingDuelRef.current,
      onRunningChange: (running) => { isResolvingDuelRef.current = running; setResolvingDuelId(running ? duelId : null); },
      run: () => resolveDuelMutation.mutateAsync({ gameId: activeGameId!, duelId, approved }),
    });
  };

  const handleApproveSanctuary = (inventoryId: number, playerName: string) => {
    setSanctuaryMessage(null);
    requestConfirmedAction({
      title: "Approve Sanctuary",
      message: `Approve ${playerName}'s sanctuary and show it on the map?`,
      confirmLabel: "Approve",
      isRunning: isReviewingSanctuaryRef.current,
      onRunningChange: (running) => { isReviewingSanctuaryRef.current = running; setReviewingSanctuaryId(running ? inventoryId : null); },
      run: () => approveSanctuaryMutation.mutateAsync({ gameId: activeGameId!, inventoryId }),
    });
  };

  const handleRejectSanctuary = (inventoryId: number, playerName: string) => {
    setSanctuaryMessage(null);
    requestConfirmedAction({
      title: "Return Sanctuary",
      message: `Return ${playerName}'s sanctuary so they can submit a different address?`,
      confirmLabel: "Return",
      isRunning: isReviewingSanctuaryRef.current,
      onRunningChange: (running) => { isReviewingSanctuaryRef.current = running; setReviewingSanctuaryId(running ? inventoryId : null); },
      run: () => rejectSanctuaryMutation.mutateAsync({ gameId: activeGameId!, inventoryId }),
    });
  };

  const handleReview = (eliminationId: number, approved: boolean) => {
    setReviewMessage(null);
    requestConfirmedAction({
      title: approved ? "Approve Elimination" : "Deny Elimination",
      message: approved ? "Confirm this elimination?" : "Deny this elimination claim?",
      confirmLabel: approved ? "Approve" : "Deny",
      isRunning: isReviewingRef.current,
      onRunningChange: (running) => { isReviewingRef.current = running; setReviewingId(running ? eliminationId : null); },
      run: () => reviewMutation.mutateAsync({ eliminationId, gameId: activeGameId!, approved }),
    });
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
          {duelMessage && (
            <View className={`rounded-xl p-3 mb-3 border ${duelMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
              <Text className={`text-sm text-center ${duelMessage.kind === "success" ? "text-success" : "text-error"}`}>{duelMessage.text}</Text>
            </View>
          )}
          {pendingDuels.map((duel: any) => {
            const isThisDuelResolving = resolvingDuelId === duel.id;
            const duelActionsDisabled = isResolvingDuelRef.current || resolvingDuelId !== null;
            return (
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
                    disabled={duelActionsDisabled}
                    onPress={() => handleDuelReview(duel.id, true, duel.proposedWinnerId === duel.challengerId ? playerLabel(duel.challenger) : playerLabel(duel.opponent))}
                  >
                    <Text className="text-primary font-bold">{isThisDuelResolving ? "Approving..." : "Approve Result"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                    disabled={duelActionsDisabled}
                    onPress={() => handleDuelReview(duel.id, false, "")}
                  >
                    <Text className="text-error font-bold">{isThisDuelResolving ? "Rejecting..." : "Reject Result"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {pendingSanctuaries.length > 0 && (
        <View className="px-4 pt-4">
          <Text className="text-foreground font-bold mb-2">⛪ Pending Sanctuary Requests ({pendingSanctuaries.length})</Text>
          {sanctuaryMessage && (
            <View className={`rounded-xl p-3 mb-3 border ${sanctuaryMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
              <Text className={`text-sm text-center ${sanctuaryMessage.kind === "success" ? "text-success" : "text-error"}`}>{sanctuaryMessage.text}</Text>
            </View>
          )}
          {pendingSanctuaries.map((item: any) => {
            const zone = item.activationData as { zoneLatitude?: string; zoneLongitude?: string } | null;
            const name = playerLabel(item.player);
            const isThisSanctuaryReviewing = reviewingSanctuaryId === item.id;
            const sanctuaryActionsDisabled = isReviewingSanctuaryRef.current || reviewingSanctuaryId !== null;
            return (
              <View key={item.id} className="bg-surface rounded-xl p-4 mb-3 border border-warning">
                <Text className="text-foreground font-semibold mb-1">{name}</Text>
                <Text className="text-muted text-xs mb-3">📍 {zone?.zoneLatitude}, {zone?.zoneLongitude}</Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    className="flex-1 bg-primary/20 border border-primary rounded-xl py-3 items-center"
                    disabled={sanctuaryActionsDisabled}
                    onPress={() => handleApproveSanctuary(item.id, name)}
                  >
                    <Text className="text-primary font-bold">{isThisSanctuaryReviewing ? "Approving..." : "✅ Approve"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error/20 border border-error rounded-xl py-3 items-center"
                    disabled={sanctuaryActionsDisabled}
                    onPress={() => handleRejectSanctuary(item.id, name)}
                  >
                    <Text className="text-error font-bold">{isThisSanctuaryReviewing ? "Returning..." : "Return"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {reviewMessage && (
        <View className={`mx-4 mt-4 rounded-xl p-3 border ${reviewMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
          <Text className={`text-sm text-center ${reviewMessage.kind === "success" ? "text-success" : "text-error"}`}>{reviewMessage.text}</Text>
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
          renderItem={({ item }) => {
            const isThisReviewing = reviewingId === item.id;
            const reviewActionsDisabled = isReviewingRef.current || reviewingId !== null;
            return (
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
                    disabled={reviewActionsDisabled}
                    onPress={() => handleReview(item.id, true)}
                  >
                    <Text className="text-success font-bold">{isThisReviewing ? "Approving..." : "✅ Approve"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-1 bg-error/20 border border-error rounded-xl py-3 items-center"
                    disabled={reviewActionsDisabled}
                    onPress={() => handleReview(item.id, false)}
                  >
                    <Text className="text-error font-bold">{isThisReviewing ? "Denying..." : "❌ Deny"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}
