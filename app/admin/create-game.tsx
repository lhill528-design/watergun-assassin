import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const GAME_TYPES = [
  { key: "last_man_standing", label: "Last Man Standing", desc: "Rounds until one player remains", icon: "👑" },
  { key: "highest_points", label: "Highest Points", desc: "Most points by end date/round", icon: "⭐" },
  { key: "most_eliminations", label: "Most Eliminations", desc: "Most kills by end date/round", icon: "💀" },
  { key: "teams", label: "Teams", desc: "Team-based rounds", icon: "👥" },
] as const;

export default function CreateGameScreen() {
  const router = useRouter();
  const { setActiveGameId } = useGame();
  const [name, setName] = useState("");
  const [gameType, setGameType] = useState<typeof GAME_TYPES[number]["key"]>("last_man_standing");
  const [entryFee, setEntryFee] = useState("0");
  const [roundLength, setRoundLength] = useState("72");
  const [safeObject, setSafeObject] = useState("");
  const [targetAssignment, setTargetAssignment] = useState<"auto" | "manual">("auto");
  const [endCondition, setEndCondition] = useState("");
  const [showLocations, setShowLocations] = useState(true);
  const [inheritTarget, setInheritTarget] = useState(true);
  const [startingPoints, setStartingPoints] = useState("100");
  const [eliminationPoints, setEliminationPoints] = useState("100");
  const [locationPingInterval, setLocationPingInterval] = useState("15");

  const createMutation = trpc.game.create.useMutation({
    onSuccess: (data) => {
      setActiveGameId(data.gameId);
      Alert.alert("Game Created!", "Your game has been created. Set up rules and power-ups next.", [
        { text: "Go to Setup", onPress: () => router.push("/admin/game-setup" as any) },
        { text: "Done", onPress: () => router.back() },
      ]);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Error", "Game name is required"); return; }
    createMutation.mutate({
      name: name.trim(),
      gameType,
      entryFee: parseInt(entryFee) || 0,
      roundLength: parseInt(roundLength) || 72,
      safeObject: safeObject || undefined,
      targetAssignment,
      endCondition: endCondition || undefined,
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
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <Text className="text-xl font-bold text-foreground">➕ Create New Game</Text>
        </View>

        {/* Game Name */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Game Name *</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="e.g., Summer Assassin 2025"
            placeholderTextColor="#8B8B9E"
            value={name}
            onChangeText={setName}
          />
        </View>

        {/* Game Type */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Game Type *</Text>
          <View className="gap-2">
            {GAME_TYPES.map((type) => (
              <TouchableOpacity
                key={type.key}
                className={`p-4 rounded-xl border ${gameType === type.key ? "bg-primary/20 border-primary" : "bg-surface border-border"}`}
                onPress={() => setGameType(type.key)}
              >
                <View className="flex-row items-center gap-3">
                  <Text className="text-2xl">{type.icon}</Text>
                  <View>
                    <Text className={`font-bold ${gameType === type.key ? "text-primary" : "text-foreground"}`}>{type.label}</Text>
                    <Text className="text-muted text-xs">{type.desc}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Entry Fee */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Entry Fee ($)</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="0"
            placeholderTextColor="#8B8B9E"
            value={entryFee}
            onChangeText={setEntryFee}
            keyboardType="numeric"
          />
        </View>

        {/* Round Length */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Round Length (hours)</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="72"
            placeholderTextColor="#8B8B9E"
            value={roundLength}
            onChangeText={setRoundLength}
            keyboardType="numeric"
          />
        </View>

        {/* Safe Object */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Safe Object</Text>
          <Text className="text-muted text-xs mb-2">Object players hold to be immune (cannot change after game starts)</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="e.g., Red bandana, Rubber duck"
            placeholderTextColor="#8B8B9E"
            value={safeObject}
            onChangeText={setSafeObject}
          />
        </View>

        {/* Target Assignment */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Target Assignment</Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              className={`flex-1 p-3 rounded-xl border items-center ${targetAssignment === "auto" ? "bg-primary/20 border-primary" : "bg-surface border-border"}`}
              onPress={() => setTargetAssignment("auto")}
            >
              <Text className={`font-bold ${targetAssignment === "auto" ? "text-primary" : "text-foreground"}`}>🔄 Auto</Text>
              <Text className="text-muted text-xs">Random assignment</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 p-3 rounded-xl border items-center ${targetAssignment === "manual" ? "bg-primary/20 border-primary" : "bg-surface border-border"}`}
              onPress={() => setTargetAssignment("manual")}
            >
              <Text className={`font-bold ${targetAssignment === "manual" ? "text-primary" : "text-foreground"}`}>✋ Manual</Text>
              <Text className="text-muted text-xs">Admin assigns</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* End Condition */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">End Condition</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="e.g., 5 rounds or July 30, 2025"
            placeholderTextColor="#8B8B9E"
            value={endCondition}
            onChangeText={setEndCondition}
          />
        </View>

        {/* Starting Points */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Starting Points</Text>
          <Text className="text-muted text-xs mb-2">Points each player starts with</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="100"
            placeholderTextColor="#8B8B9E"
            value={startingPoints}
            onChangeText={setStartingPoints}
            keyboardType="numeric"
          />
        </View>

        {/* Elimination Points */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Elimination Points</Text>
          <Text className="text-muted text-xs mb-2">Points awarded per confirmed elimination</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="100"
            placeholderTextColor="#8B8B9E"
            value={eliminationPoints}
            onChangeText={setEliminationPoints}
            keyboardType="numeric"
          />
        </View>

        {/* Location Ping Interval */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Location Ping Interval (minutes)</Text>
          <Text className="text-muted text-xs mb-2">How often player locations update</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-foreground"
            placeholder="15"
            placeholderTextColor="#8B8B9E"
            value={locationPingInterval}
            onChangeText={setLocationPingInterval}
            keyboardType="numeric"
          />
        </View>

        {/* Toggle Options */}
        <View className="mb-6 gap-3">
          <TouchableOpacity
            className="flex-row items-center justify-between bg-surface rounded-xl p-4 border border-border"
            onPress={() => setShowLocations(!showLocations)}
          >
            <View>
              <Text className="text-foreground font-semibold">Show All Locations During Purge</Text>
              <Text className="text-muted text-xs">All player GPS visible during purge events</Text>
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

        {/* Create Button */}
        <TouchableOpacity
          className="bg-primary py-4 rounded-xl items-center"
          onPress={handleCreate}
          disabled={createMutation.isPending}
        >
          <Text className="text-background font-bold text-base">
            {createMutation.isPending ? "Creating..." : "Create Game"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
