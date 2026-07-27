import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";

export default function AdminGameSetupScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const updateGame = trpc.game.update.useMutation({
    onSuccess: () => { gameQuery.refetch(); Alert.alert("Saved!", "Game settings updated."); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const game = gameQuery.data;

  const [name, setName] = useState("");
  const [entryFee, setEntryFee] = useState("0");
  const [roundLength, setRoundLength] = useState("72");
  const [safeObject, setSafeObject] = useState("");
  const [showLocations, setShowLocations] = useState(true);
  const [inheritTarget, setInheritTarget] = useState(true);
  const [startingPoints, setStartingPoints] = useState("0");
  const [eliminationPoints, setEliminationPoints] = useState("100");
  const [locationPingInterval, setLocationPingInterval] = useState("15");

  useEffect(() => {
    if (game) {
      setName(game.name || "");
      setEntryFee(String(game.entryFee || 0));
      setRoundLength(String(game.roundLength || 72));
      setSafeObject(game.safeObject || "");
      setShowLocations(game.showLocationsDuringPurge ?? true);
      setInheritTarget((game as any).inheritTarget ?? true);
      setStartingPoints(String((game as any).startingPoints || 0));
      setEliminationPoints(String((game as any).eliminationPoints || 100));
      setLocationPingInterval(String((game as any).locationPingInterval || 15));
    }
  }, [game]);

  const handleSave = () => {
    if (!activeGameId) return;
    updateGame.mutate({
      gameId: activeGameId,
      name: name || undefined,
      entryFee: parseInt(entryFee) || 0,
      roundLength: parseInt(roundLength) || 72,
      safeObject: safeObject || undefined,
      showLocationsDuringPurge: showLocations,
      inheritTarget,
      startingPoints: parseInt(startingPoints) || 0,
      eliminationPoints: parseInt(eliminationPoints) || 100,
      locationPingInterval: parseInt(locationPingInterval) || 15,
    });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-foreground">⚙️ Game Setup</Text>
        </View>

        {/* Join Code */}
        <View className="bg-primary/10 border border-primary rounded-xl p-4 mb-4 items-center">
          <Text className="text-xs text-muted uppercase tracking-wider mb-1">Join Code</Text>
          <Text className="text-primary text-3xl font-bold tracking-[6px]">{(game as any)?.joinCode || "------"}</Text>
          <Text className="text-muted text-xs mt-1">Share this code with players to join</Text>
        </View>

        {/* Game Info */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <View className="flex-row justify-between items-center">
            <Text className="text-muted text-xs">Game Type</Text>
            <Text className="text-foreground font-bold">{game?.gameType?.replace(/_/g, " ").toUpperCase()}</Text>
          </View>
          <View className="flex-row justify-between items-center mt-2">
            <Text className="text-muted text-xs">Status</Text>
            <Text className={`font-bold ${game?.status === "active" ? "text-success" : "text-warning"}`}>{game?.status?.toUpperCase()}</Text>
          </View>
        </View>

        {/* Editable Fields */}
        <View className="gap-4">
          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Game Name</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Entry Fee ($)</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={entryFee}
              onChangeText={setEntryFee}
              keyboardType="numeric"
            />
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Round Length (hours)</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={roundLength}
              onChangeText={setRoundLength}
              keyboardType="numeric"
            />
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Safe Object</Text>
            <Text className="text-muted text-xs mb-1">⚠️ Cannot be changed after game starts (unless power-up used)</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={safeObject}
              onChangeText={setSafeObject}
              placeholder="e.g., Red bandana"
              placeholderTextColor="#8B8B9E"
              editable={game?.status === "setup"}
            />
            {game?.status !== "setup" && (
              <Text className="text-error text-xs mt-1">🔒 Locked - game has started</Text>
            )}
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Starting Points</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={startingPoints}
              onChangeText={setStartingPoints}
              keyboardType="numeric"
            />
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Elimination Points</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={eliminationPoints}
              onChangeText={setEliminationPoints}
              keyboardType="numeric"
            />
          </View>

          <View>
            <Text className="text-sm font-bold text-foreground mb-2">Location Ping (minutes)</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
              value={locationPingInterval}
              onChangeText={setLocationPingInterval}
              keyboardType="numeric"
            />
          </View>

          <TouchableOpacity
            className="flex-row items-center justify-between bg-surface rounded-xl p-4 border border-border"
            onPress={() => setShowLocations(!showLocations)}
          >
            <View>
              <Text className="text-foreground font-semibold">Show Locations During Purge</Text>
              <Text className="text-muted text-xs">All player GPS visible during purge</Text>
            </View>
            <View className={`w-12 h-7 rounded-full justify-center ${showLocations ? "bg-primary items-end" : "bg-border items-start"}`}>
              <View className="w-5 h-5 rounded-full bg-foreground mx-1" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center justify-between bg-surface rounded-xl p-4 border border-border"
            onPress={() => setInheritTarget(!inheritTarget)}
          >
            <View>
              <Text className="text-foreground font-semibold">Inherit Target on Kill</Text>
                <Text className="text-muted text-xs">Eliminator gets victim&apos;s target</Text>
            </View>
            <View className={`w-12 h-7 rounded-full justify-center ${inheritTarget ? "bg-primary items-end" : "bg-border items-start"}`}>
              <View className="w-5 h-5 rounded-full bg-foreground mx-1" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          className="bg-primary py-4 rounded-xl items-center mt-6"
          onPress={handleSave}
          disabled={updateGame.isPending}
        >
          <Text className="text-background font-bold text-base">
            {updateGame.isPending ? "Saving..." : "Save Settings"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
