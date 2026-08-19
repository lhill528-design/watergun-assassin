import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";
import { useRef, useState } from "react";

export default function RoundControlScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [purgeDuration, setPurgeDuration] = useState("60");
  const [purgeSchedule, setPurgeSchedule] = useState("");
  const [resultMessage, setResultMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // One shared guard across every round-control action -- only one of
  // these makes sense to run at a time (you wouldn't Start Round while
  // Ending Purge is still in flight), so a single ref-backed lock blocks
  // any of them from firing while another is running. `actingLabel`
  // records which one, purely so its own button can show "..." instead of
  // just being disabled like the others.
  const isActingRef = useRef(false);
  const [isActing, setIsActing] = useState(false);
  const [actingLabel, setActingLabel] = useState<string | null>(null);
  const setActing = (acting: boolean) => { isActingRef.current = acting; setIsActing(acting); };

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const invalidateGame = () => utils.game.get.invalidate({ gameId: activeGameId! });
  const onActionError = (err: { message: string }) => {
    setResultMessage({ kind: "error", text: err.message });
    if (Platform.OS !== "web") Alert.alert("Error", err.message);
  };

  const startRound = trpc.game.startRound.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Round started!" }); },
    onError: onActionError,
  });
  const endRound = trpc.game.endRound.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Round ended!" }); },
    onError: onActionError,
  });
  const startPurge = trpc.game.startPurge.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Purge activated!" }); },
    onError: onActionError,
  });
  const endPurge = trpc.game.endPurge.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Purge ended!" }); },
    onError: onActionError,
  });
  const schedulePurge = trpc.game.schedulePurge.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Purge schedule updated." }); },
    onError: (error) => { setResultMessage({ kind: "error", text: error.message }); if (Platform.OS !== "web") Alert.alert("Could not schedule", error.message); },
  });
  const endGame = trpc.game.endGame.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Game over!" }); },
    onError: onActionError,
  });
  const updateGame = trpc.game.update.useMutation({
    onSuccess: () => { invalidateGame(); setResultMessage({ kind: "success", text: "Game status updated." }); },
    onError: onActionError,
  });

  const game = gameQuery.data;

  const runAction = (label: string, title: string, message: string, confirmLabel: string, run: () => Promise<unknown>) => {
    setResultMessage(null);
    setActingLabel(label);
    requestConfirmedAction({ title, message, confirmLabel, isRunning: isActingRef.current, onRunningChange: setActing, run });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-foreground">🎮 Round Control</Text>
        </View>

        {/* Current Status */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-sm font-bold text-foreground mb-3">Current Status</Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-xs text-muted">Game</Text>
              <Text className="text-foreground font-bold">{game?.status?.toUpperCase()}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Round</Text>
              <Text className="text-foreground font-bold">{game?.currentRound || 0}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted">Purge</Text>
              <Text className={`font-bold ${game?.purgeActive ? "text-error" : "text-success"}`}>
                {game?.purgeActive ? "ACTIVE" : "INACTIVE"}
              </Text>
            </View>
          </View>
        </View>

        {resultMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${resultMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${resultMessage.kind === "success" ? "text-success" : "text-error"}`}>{resultMessage.text}</Text>
          </View>
        )}

        {/* Round Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">🎯 Round Management</Text>
        <View className="gap-3 mb-6">
          <TouchableOpacity
            className="bg-success/20 border border-success rounded-xl p-4 items-center"
            onPress={() => runAction("startRound", "Start Round", `Start Round ${(game?.currentRound || 0) + 1}?`, "Confirm", () => startRound.mutateAsync({ gameId: activeGameId! }))}
            disabled={isActing}
          >
            <Text className="text-success font-bold text-base">{isActing && actingLabel === "startRound" ? "Starting..." : "▶️ Start New Round"}</Text>
            <Text className="text-success/70 text-xs mt-1">Begins Round {(game?.currentRound || 0) + 1}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-warning/20 border border-warning rounded-xl p-4 items-center"
            onPress={() => runAction("endRound", "End Round", "End the current round early?", "Confirm", () => endRound.mutateAsync({ gameId: activeGameId! }))}
            disabled={isActing}
          >
            <Text className="text-warning font-bold text-base">{isActing && actingLabel === "endRound" ? "Ending..." : "⏹️ End Round Early"}</Text>
          </TouchableOpacity>
        </View>

        {/* Purge Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">⚠️ Purge Control</Text>
        <View className="gap-3 mb-6">
          {!game?.purgeActive ? (
            <View>
              <Text className="text-muted text-xs mb-2">Scheduled purge (ISO date/time, e.g. 2026-08-04T18:00:00-04:00)</Text>
              <View className="flex-row gap-2 mb-4"><TextInput className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-foreground" value={purgeSchedule} onChangeText={setPurgeSchedule} placeholder={game?.purgeScheduledAt ? new Date(game.purgeScheduledAt).toISOString() : "Future date/time"} placeholderTextColor="#777"/><TouchableOpacity className="bg-warning/20 border border-warning rounded-lg px-3 justify-center" onPress={() => schedulePurge.mutate({ gameId: activeGameId!, startsAt: purgeSchedule.trim() || null })}><Text className="text-warning font-bold">Save</Text></TouchableOpacity></View>
              <View className="flex-row items-center gap-3 mb-3">
                <Text className="text-foreground text-sm">Duration (minutes):</Text>
                <TextInput
                  className="bg-surface border border-border rounded-lg px-3 py-2 text-foreground w-20 text-center"
                  value={purgeDuration}
                  onChangeText={setPurgeDuration}
                  keyboardType="numeric"
                />
              </View>
              <TouchableOpacity
                className="bg-error/20 border border-error rounded-xl p-4 items-center"
                onPress={() => runAction("startPurge", "Start Purge", `Activate ${purgeDuration} minute purge? All players can be eliminated by anyone!`, "Confirm", () => startPurge.mutateAsync({ gameId: activeGameId!, durationMinutes: parseInt(purgeDuration) || 60 }))}
                disabled={isActing}
              >
                <Text className="text-error font-bold text-base">{isActing && actingLabel === "startPurge" ? "Activating..." : "⚠️ ACTIVATE PURGE"}</Text>
                <Text className="text-error/70 text-xs mt-1">All players become targets</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              className="bg-success/20 border border-success rounded-xl p-4 items-center"
              onPress={() => runAction("endPurge", "End Purge", "End the purge and return to normal play?", "Confirm", () => endPurge.mutateAsync({ gameId: activeGameId! }))}
              disabled={isActing}
            >
              <Text className="text-success font-bold text-base">{isActing && actingLabel === "endPurge" ? "Ending..." : "🕊️ End Purge"}</Text>
              <Text className="text-success/70 text-xs mt-1">Return to normal rules</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Game Controls */}
        <Text className="text-sm font-bold text-foreground mb-3">🏁 Game Control</Text>
        <View className="gap-3">
          {game?.status === "paused" && (
            <TouchableOpacity
              className="bg-success/20 border border-success rounded-xl p-4 items-center"
              onPress={() => { if (!isActingRef.current) updateGame.mutate({ gameId: activeGameId!, status: "active" }); }}
              disabled={isActing}
            >
              <Text className="text-success font-bold">▶️ Resume Game</Text>
            </TouchableOpacity>
          )}
          {game?.status === "active" && (
            <TouchableOpacity
              className="bg-warning/20 border border-warning rounded-xl p-4 items-center"
              onPress={() => runAction("pauseGame", "Pause Game", "Pause the game?", "Confirm", () => updateGame.mutateAsync({ gameId: activeGameId!, status: "paused" }))}
              disabled={isActing}
            >
              <Text className="text-warning font-bold">{isActing && actingLabel === "pauseGame" ? "Pausing..." : "⏸️ Pause Game"}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            className="bg-error/20 border border-error rounded-xl p-4 items-center"
            onPress={() => runAction("endGame", "End Game", "This will end the game permanently. Are you sure?", "Confirm", () => endGame.mutateAsync({ gameId: activeGameId! }))}
            disabled={isActing}
          >
            <Text className="text-error font-bold">{isActing && actingLabel === "endGame" ? "Ending..." : "🏁 End Game"}</Text>
            <Text className="text-error/70 text-xs mt-1">Cannot be undone</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
