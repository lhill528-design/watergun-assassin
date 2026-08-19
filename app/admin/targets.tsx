import { Text, View, ScrollView, TouchableOpacity, Alert, TextInput, Platform } from "react-native";
import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";

export default function AdminTargetsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Separate ref-backed guards -- assigning and clearing are different
  // operations, and each is checked synchronously (not via
  // mutation.isPending's async re-render) so a rapid second tap on either
  // button can't fire a second mutation.
  const isAssigningRef = useRef(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const setAssigning = (assigning: boolean) => { isAssigningRef.current = assigning; setIsAssigning(assigning); };
  const isClearingRef = useRef(false);
  const [isClearing, setIsClearing] = useState(false);
  const setClearing = (clearing: boolean) => { isClearingRef.current = clearing; setIsClearing(clearing); };

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const playersQuery = trpc.player.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const updateGame = trpc.game.update.useMutation({ onSuccess: () => gameQuery.refetch() });
  const assignTargets = trpc.game.assignTargets.useMutation({
    onSuccess: (data) => {
      utils.player.list.invalidate({ gameId: activeGameId! });
      setMessage({ kind: "success", text: `Assigned targets for ${data.affected} player${data.affected === 1 ? "" : "s"} in a circular chain.` });
    },
    onError: (err) => {
      setMessage({ kind: "error", text: err.message });
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- the inline message above is what actually drives the
      // UI on every platform.
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });
  const clearTargets = trpc.game.clearTargets.useMutation({
    onSuccess: (data) => {
      utils.player.list.invalidate({ gameId: activeGameId! });
      setMessage({ kind: "success", text: `Cleared targets for ${data.affected} player${data.affected === 1 ? "" : "s"}.` });
    },
    onError: (err) => {
      setMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const game = gameQuery.data;
  const players = playersQuery.data || [];
  const alivePlayers = players.filter(p => p.status === "alive");
  const getPlayerName = (player: (typeof players)[number] | undefined) => {
    if (!player) return "None";
    const playerUser = (player as any).user;
    return playerUser?.displayName?.trim() || playerUser?.name?.trim() || `Player #${player.userId}`;
  };
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredAlivePlayers = normalizedSearchQuery
    ? alivePlayers.filter(player => getPlayerName(player).toLocaleLowerCase().includes(normalizedSearchQuery))
    : alivePlayers;

  const handleAutoAssign = () => {
    setMessage(null);
    if (alivePlayers.length < 2) {
      setMessage({ kind: "error", text: "Need at least 2 alive players to assign targets" });
      return;
    }
    requestConfirmedAction({
      title: "Auto-Assign Targets",
      message: `Randomly assign targets for ${alivePlayers.length} alive players?`,
      confirmLabel: "Assign",
      isRunning: isAssigningRef.current,
      onRunningChange: setAssigning,
      run: () => assignTargets.mutateAsync({ gameId: activeGameId! }),
    });
  };

  const handleClearTargets = () => {
    setMessage(null);
    requestConfirmedAction({
      title: "Clear All Targets",
      message: "Remove all target assignments?",
      confirmLabel: "Clear",
      isRunning: isClearingRef.current,
      onRunningChange: setClearing,
      run: () => clearTargets.mutateAsync({ gameId: activeGameId! }),
    });
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

        {message && (
          <View className={`rounded-xl p-3 mb-4 border ${message.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${message.kind === "success" ? "text-success" : "text-error"}`}>{message.text}</Text>
          </View>
        )}

        {/* Actions */}
        <View className="gap-3 mb-6">
          <TouchableOpacity
            className="bg-primary/20 border border-primary rounded-xl p-4 items-center"
            onPress={handleAutoAssign}
            disabled={isAssigning}
          >
            <Text className="text-primary font-bold">{isAssigning ? "Assigning..." : "🔄 Auto-Assign All Targets"}</Text>
            <Text className="text-primary/70 text-xs mt-1">Creates circular target chain</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="bg-error/20 border border-error rounded-xl p-4 items-center"
            onPress={handleClearTargets}
            disabled={isClearing}
          >
            <Text className="text-error font-bold">{isClearing ? "Clearing..." : "🗑️ Clear All Targets"}</Text>
          </TouchableOpacity>
        </View>

        {/* Player Target List */}
        <View className="mb-3">
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
        <Text className="text-sm font-bold text-foreground mb-3">
          {normalizedSearchQuery ? `Current Assignments (${filteredAlivePlayers.length} of ${alivePlayers.length})` : "Current Assignments"}
        </Text>
        {filteredAlivePlayers.length === 0 ? (
          <View className="bg-surface rounded-xl p-6 border border-border items-center">
            <Text className="text-muted">
              {normalizedSearchQuery ? "No players match that display name." : "No alive players"}
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {filteredAlivePlayers.map((p) => {
              const target = players.find(t => t.id === p.targetId);
              return (
                <View key={p.id} className="bg-surface rounded-xl p-4 border border-border">
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text className="text-foreground font-bold">{getPlayerName(p)}</Text>
                      <Text className="text-muted text-xs">{p.kills || 0} kills • {p.points || 0} pts</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs text-muted">Target →</Text>
                      <Text className="text-primary font-bold text-sm">
                        {getPlayerName(target)}
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
