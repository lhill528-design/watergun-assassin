import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestGameCreation, handleGameCreated } from "@/lib/game-creation";
import { useRef, useState } from "react";

const GAME_TYPES = [
  { key: "last_man_standing", label: "Last Man Standing", desc: "Rounds until one player remains", icon: "👑" },
  { key: "highest_points", label: "Highest Points", desc: "Most points by end date/round", icon: "⭐" },
  { key: "most_eliminations", label: "Most Eliminations", desc: "Most kills by end date/round", icon: "💀" },
  { key: "teams", label: "Teams", desc: "Team-based rounds", icon: "👥" },
] as const;

export default function CreateGameScreen() {
  const router = useRouter();
  const { setActiveGameId } = useGame();
  const utils = trpc.useUtils();
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
  const [formError, setFormError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A ref (not just the isSubmitting state above) so the guard is checked
  // synchronously -- a second tap that lands before React re-renders the
  // disabled button still can't slip through and call mutate() again.
  const isSubmittingRef = useRef(false);

  const setSubmitting = (submitting: boolean) => {
    isSubmittingRef.current = submitting;
    setIsSubmitting(submitting);
  };

  const createMutation = trpc.game.create.useMutation({
    onSuccess: (data) => {
      setJustCreated(true);
      handleGameCreated({
        gameId: data.gameId,
        setActiveGameId,
        invalidateMyGames: () => utils.game.myGames.invalidate(),
        invalidateAdminGames: () => utils.game.adminGames.invalidate(),
        navigateToGameSetup: () => router.replace("/admin/game-setup" as any),
      });
    },
    onError: (err) => {
      setSubmitting(false);
      setFormError(err.message);
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- inline formError above is what actually drives the UI
      // on every platform.
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const handleCreate = () => {
    setFormError(null);
    requestGameCreation({
      values: {
        name, gameType, entryFee, roundLength, safeObject, targetAssignment,
        endCondition, showLocations, inheritTarget, startingPoints, eliminationPoints, locationPingInterval,
      },
      isSubmitting: isSubmittingRef.current,
      onSubmittingChange: setSubmitting,
      createGame: (input) => createMutation.mutate(input),
      onValidationError: setFormError,
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

        {justCreated && (
          <View className="bg-success/20 border border-success rounded-xl p-3 mb-4">
            <Text className="text-success text-sm text-center font-semibold">Game created! Taking you to setup…</Text>
          </View>
        )}
        {formError && (
          <View className="bg-error/20 border border-error rounded-xl p-3 mb-4">
            <Text className="text-error text-sm text-center">{formError}</Text>
          </View>
        )}

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
          disabled={isSubmitting}
        >
          <Text className="text-background font-bold text-base">
            {isSubmitting ? "Creating..." : "Create Game"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
