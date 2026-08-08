import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const OUTCOME_TYPES = [
  { key: "points_bonus", label: "Points Bonus", emoji: "💰" },
  { key: "points_penalty", label: "Points Penalty", emoji: "💸" },
  { key: "power_up", label: "Free Power-Up", emoji: "⚡" },
  { key: "discount_coupon", label: "Discount Coupon", emoji: "🏷️" },
  { key: "nothing", label: "Nothing", emoji: "🫥" },
  { key: "custom", label: "Custom", emoji: "🎲" },
] as const;

export default function AdminRouletteScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🎲");
  const [newType, setNewType] = useState<"power_up" | "points_bonus" | "points_penalty" | "discount_coupon" | "nothing" | "custom">("points_bonus");
  const [newValue, setNewValue] = useState("100");
  const [newWeight, setNewWeight] = useState("1");
  const [newDescription, setNewDescription] = useState("");

  const outcomesQuery = trpc.roulette.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createOutcome = trpc.roulette.create.useMutation({ onSuccess: () => { outcomesQuery.refetch(); setShowAdd(false); resetForm(); } });
  const updateOutcome = trpc.roulette.update.useMutation({ onSuccess: () => outcomesQuery.refetch() });
  const deleteOutcome = trpc.roulette.delete.useMutation({ onSuccess: () => outcomesQuery.refetch() });
  const seedDefaults = trpc.roulette.seedDefaults.useMutation({
    onSuccess: (data) => { outcomesQuery.refetch(); Alert.alert("Done!", `Loaded ${data.count} default roulette outcomes.`); },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const outcomes = outcomesQuery.data || [];
  const totalWeight = outcomes.filter(o => o.isEnabled).reduce((sum, o) => sum + o.weight, 0);

  const resetForm = () => { setNewName(""); setNewEmoji("🎲"); setNewType("points_bonus"); setNewValue("100"); setNewWeight("1"); setNewDescription(""); };

  const handleLoadDefaults = () => {
    Alert.alert("Load Default Outcomes", "Add 12 pre-configured roulette outcomes (jackpot, wins, losses, coupons, custom effects)?", [
      { text: "Cancel", style: "cancel" },
      { text: "Load All", onPress: () => seedDefaults.mutate({ gameId: activeGameId! }) },
    ]);
  };

  const handleCreate = () => {
    if (!newName.trim()) { Alert.alert("Error", "Name is required"); return; }
    createOutcome.mutate({
      gameId: activeGameId!,
      name: newName.trim(),
      emoji: newEmoji,
      type: newType,
      value: parseInt(newValue) || 0,
      weight: parseInt(newWeight) || 1,
      description: newDescription.trim() || undefined,
    });
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert("Delete Outcome", `Remove "${name}" from the wheel?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteOutcome.mutate({ id }) },
    ]);
  };

  const getChance = (weight: number) => {
    if (totalWeight === 0) return "0%";
    return `${Math.round((weight / totalWeight) * 100)}%`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "points_bonus": return "text-success";
      case "points_penalty": return "text-error";
      case "power_up": return "text-primary";
      case "discount_coupon": return "text-warning";
      case "nothing": return "text-muted";
      case "custom": return "text-foreground";
      default: return "text-muted";
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-xl font-bold text-foreground">🎰 Roulette Setup</Text>
            <Text className="text-muted text-xs">{outcomes.length} outcomes configured</Text>
          </View>
        </View>

        {/* Info Card */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-foreground font-bold text-sm mb-1">How Roulette Works</Text>
          <Text className="text-muted text-xs leading-relaxed">
            Players spend 50 points to spin directly from the Shop banner. Roulette is not purchased or stored in inventory. Each outcome's weight determines its probability. Configure prizes, penalties, and custom effects below.
          </Text>
          {totalWeight > 0 && (
            <View className="mt-2 bg-background rounded-lg p-2">
              <Text className="text-muted text-xs">Total weight pool: {totalWeight} | Active outcomes: {outcomes.filter(o => o.isEnabled).length}</Text>
            </View>
          )}
        </View>

        {/* Quick Actions */}
        <View className="flex-row gap-3 mb-4">
          <TouchableOpacity
            className="flex-1 bg-primary/20 border border-primary rounded-xl p-3 items-center"
            onPress={handleLoadDefaults}
          >
            <Text className="text-primary font-bold text-sm">{seedDefaults.isPending ? "Loading..." : "📦 Load Defaults"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-surface border border-border rounded-xl p-3 items-center"
            onPress={() => setShowAdd(!showAdd)}
          >
            <Text className="text-foreground font-bold text-sm">{showAdd ? "Cancel" : "+ Add Outcome"}</Text>
          </TouchableOpacity>
        </View>

        {/* Add Form */}
        {showAdd && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">New Roulette Outcome</Text>
            <View className="gap-3">
              <View className="flex-row gap-2">
                <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground w-14 text-center text-xl" value={newEmoji} onChangeText={setNewEmoji} />
                <TextInput className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Name (e.g. Jackpot)" placeholderTextColor="#8B8B9E" value={newName} onChangeText={setNewName} />
              </View>

              {/* Type Selection */}
              <Text className="text-xs text-muted font-bold">Outcome Type:</Text>
              <View className="flex-row flex-wrap gap-2">
                {OUTCOME_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    className={`px-3 py-2 rounded-lg ${newType === t.key ? "bg-primary" : "bg-background border border-border"}`}
                    onPress={() => setNewType(t.key)}
                  >
                    <Text className={`text-xs font-bold ${newType === t.key ? "text-background" : "text-muted"}`}>{t.emoji} {t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Text className="text-xs text-muted mb-1">Value (pts/%)</Text>
                  <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="100" placeholderTextColor="#8B8B9E" value={newValue} onChangeText={setNewValue} keyboardType="numeric" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-muted mb-1">Weight (probability)</Text>
                  <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="1" placeholderTextColor="#8B8B9E" value={newWeight} onChangeText={setNewWeight} keyboardType="numeric" />
                </View>
              </View>

              <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Description (shown to player on spin)" placeholderTextColor="#8B8B9E" value={newDescription} onChangeText={setNewDescription} multiline />

              <TouchableOpacity className="bg-primary py-3 rounded-xl items-center" onPress={handleCreate}>
                <Text className="text-background font-bold">Add to Wheel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Outcomes List */}
        {outcomes.length === 0 ? (
          <View className="bg-surface rounded-xl p-8 border border-border items-center">
            <Text className="text-3xl mb-2">🎰</Text>
            <Text className="text-muted text-center">No roulette outcomes configured yet.</Text>
            <Text className="text-muted text-xs text-center mt-1">Load defaults or add custom outcomes.</Text>
          </View>
        ) : (
          <View className="gap-2">
            {outcomes.map((outcome) => (
              <View key={outcome.id} className={`bg-surface rounded-xl p-4 border ${outcome.isEnabled ? "border-border" : "border-error/30"}`}>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-lg">{outcome.emoji}</Text>
                      <Text className={`font-bold ${outcome.isEnabled ? "text-foreground" : "text-muted"}`}>{outcome.name}</Text>
                      <Text className={`text-xs font-bold ${getTypeColor(outcome.type)}`}>{outcome.type.replace("_", " ")}</Text>
                    </View>
                    {outcome.description && (
                      <Text className="text-muted text-xs mt-1">{outcome.description}</Text>
                    )}
                    <View className="flex-row gap-3 mt-2">
                      {outcome.value ? <Text className={`text-xs font-bold ${outcome.type === "points_penalty" ? "text-error" : "text-success"}`}>{outcome.type === "points_penalty" ? "-" : "+"}{outcome.value}{outcome.type === "discount_coupon" ? "%" : " pts"}</Text> : null}
                      <Text className="text-muted text-xs">⚖️ Weight: {outcome.weight}</Text>
                      <Text className="text-primary text-xs font-bold">🎯 {getChance(outcome.weight)}</Text>
                    </View>
                  </View>
                  <View className="items-end gap-2">
                    <TouchableOpacity
                      className={`w-12 h-7 rounded-full justify-center ${outcome.isEnabled ? "bg-primary items-end" : "bg-border items-start"}`}
                      onPress={() => updateOutcome.mutate({ id: outcome.id, isEnabled: !outcome.isEnabled })}
                    >
                      <View className="w-5 h-5 rounded-full bg-foreground mx-1" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(outcome.id, outcome.name)}>
                      <Text className="text-error text-xs">Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Probability Preview */}
        {outcomes.filter(o => o.isEnabled).length > 0 && (
          <View className="bg-surface rounded-xl p-4 mt-4 border border-border">
            <Text className="text-foreground font-bold text-sm mb-3">🎯 Probability Preview</Text>
            <View className="gap-2">
              {outcomes.filter(o => o.isEnabled).map((o) => (
                <View key={o.id} className="flex-row items-center gap-2">
                  <Text className="text-sm">{o.emoji}</Text>
                  <View className="flex-1 bg-background rounded-full h-4 overflow-hidden">
                    <View
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(o.weight / totalWeight) * 100}%` }}
                    />
                  </View>
                  <Text className="text-muted text-xs w-10 text-right">{getChance(o.weight)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
