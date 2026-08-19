import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";
import { useRef, useState } from "react";

export default function AdminAchievementsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏅");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("100");
  const [createError, setCreateError] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // A ref (not just createMutation.isPending) so the guard is checked
  // synchronously -- a second tap that lands before React re-renders the
  // disabled button still can't slip through and open a second
  // confirmation dialog.
  const isSeedingRef = useRef(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const setSeeding = (seeding: boolean) => { isSeedingRef.current = seeding; setIsSeeding(seeding); };
  const isCreatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);

  const achievementsQuery = trpc.achievement.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createAchievement = trpc.achievement.create.useMutation();
  const seedAllAchievements = trpc.achievement.seedAll.useMutation({
    onSuccess: (data) => {
      utils.achievement.list.invalidate({ gameId: activeGameId! });
      const skippedNote = data.skipped ? ` (${data.skipped} already loaded)` : "";
      setSeedMessage({
        kind: "success",
        text: data.created > 0
          ? `Loaded ${data.created} achievement${data.created === 1 ? "" : "s"}${skippedNote}.`
          : `All achievements are already loaded${skippedNote}.`,
      });
    },
    onError: (err) => {
      setSeedMessage({ kind: "error", text: err.message });
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- the inline message above is what actually drives the
      // UI on every platform.
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });

  const achievements = achievementsQuery.data || [];

  const resetForm = () => { setName(""); setEmoji("🏅"); setDescription(""); setPoints("100"); };

  const handleLoadDefaults = () => {
    setSeedMessage(null);
    requestConfirmedAction({
      title: "Load All 52 Achievements",
      message: "This will add all 52 achievements from the official list (Combat, Survival, Chaos). Achievements already loaded won't be duplicated.",
      confirmLabel: "Load All 52",
      isRunning: isSeedingRef.current,
      onRunningChange: setSeeding,
      run: () => seedAllAchievements.mutateAsync({ gameId: activeGameId! }),
    });
  };

  const handleCreate = async () => {
    if (isCreatingRef.current) return;
    setCreateError(null);
    if (!name.trim()) { setCreateError("Name is required"); return; }

    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      await createAchievement.mutateAsync({
        gameId: activeGameId!,
        name: name.trim(),
        emoji,
        description: description.trim(),
        pointsValue: parseInt(points) || 100,
      });
      utils.achievement.list.invalidate({ gameId: activeGameId! });
      setShowAdd(false);
      resetForm();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the achievement.");
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-xl font-bold text-foreground">🏅 Achievements</Text>
            <Text className="text-muted text-xs">{achievements.length} badges configured</Text>
          </View>
        </View>

        {/* Actions */}
        <View className="flex-row gap-3 mb-4">
          <TouchableOpacity
            className="flex-1 bg-primary/20 border border-primary rounded-xl p-3 items-center"
            onPress={handleLoadDefaults}
            disabled={isSeeding}
          >
            <Text className="text-primary font-bold text-sm">{isSeeding ? "Loading..." : "📦 Load All 52"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-surface border border-border rounded-xl p-3 items-center"
            onPress={() => { setCreateError(null); setShowAdd(!showAdd); }}
          >
            <Text className="text-foreground font-bold text-sm">{showAdd ? "Cancel" : "+ Custom"}</Text>
          </TouchableOpacity>
        </View>

        {seedMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${seedMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${seedMessage.kind === "success" ? "text-success" : "text-error"}`}>{seedMessage.text}</Text>
          </View>
        )}

        {/* Add Form */}
        {showAdd && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">New Achievement</Text>
            <View className="gap-3">
              <View className="flex-row gap-2">
                <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground w-14 text-center text-xl" value={emoji} onChangeText={setEmoji} />
                <TextInput className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Badge Name" placeholderTextColor="#8B8B9E" value={name} onChangeText={setName} />
              </View>
              <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Description" placeholderTextColor="#8B8B9E" value={description} onChangeText={setDescription} />
              <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Points Value" placeholderTextColor="#8B8B9E" value={points} onChangeText={setPoints} keyboardType="numeric" />
              {createError && <Text className="text-error text-sm text-center">{createError}</Text>}
              <TouchableOpacity className="bg-primary py-3 rounded-xl items-center" onPress={handleCreate} disabled={isCreating}>
                <Text className="text-background font-bold">{isCreating ? "Creating..." : "Create Achievement"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Achievements List */}
        {achievements.length === 0 ? (
          <View className="bg-surface rounded-xl p-8 border border-border items-center">
            <Text className="text-muted text-center">No achievements configured. Load defaults or create custom ones.</Text>
          </View>
        ) : (
          <View className="gap-2">
            {achievements.map((a) => (
              <View key={a.id} className="bg-surface rounded-xl p-4 border border-border">
                <View className="flex-row items-center gap-3">
                  <Text className="text-2xl">{a.emoji || "🏅"}</Text>
                  <View className="flex-1">
                    <Text className="text-foreground font-bold">{a.name}</Text>
                    <Text className="text-muted text-xs">{a.description}</Text>
                  </View>
                  <View className="bg-primary/20 px-2 py-1 rounded">
                    <Text className="text-primary text-xs font-bold">+{a.pointsValue}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
