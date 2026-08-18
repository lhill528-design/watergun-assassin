import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";
import { useRef, useState } from "react";



export default function AdminPowerUpsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("⚡");
  const [newEffect, setNewEffect] = useState("");
  const [newCost, setNewCost] = useState("100");
  const [newUsageFee, setNewUsageFee] = useState("0");
  const [newDuration, setNewDuration] = useState("");
  const [newCategory, setNewCategory] = useState<"offensive" | "defensive" | "utility" | "special" | "chaos">("utility");
  const [seedMessage, setSeedMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  // A ref (not just the isSeeding state above) so the guard is checked
  // synchronously -- a second tap that lands before React re-renders the
  // disabled button still can't slip through and open a second
  // confirmation dialog.
  const isSeedingRef = useRef(false);
  const setSeeding = (seeding: boolean) => {
    isSeedingRef.current = seeding;
    setIsSeeding(seeding);
  };

  const powerUpsQuery = trpc.powerUp.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createPowerUp = trpc.powerUp.create.useMutation({ onSuccess: () => { powerUpsQuery.refetch(); setShowAdd(false); resetForm(); } });
  const updatePowerUp = trpc.powerUp.update.useMutation({ onSuccess: () => powerUpsQuery.refetch() });
  const seedAllPowerUps = trpc.powerUp.seedAll.useMutation({
    onSuccess: (data) => {
      utils.powerUp.list.invalidate({ gameId: activeGameId! });
      setSeedMessage({ kind: "success", text: `Loaded ${data.count} power-ups from the full catalog.` });
    },
    onError: (err) => {
      setSeedMessage({ kind: "error", text: err.message });
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- the inline message above is what actually drives the
      // UI on every platform.
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });
  const pendingFeesQuery = trpc.powerUp.pendingFees.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const resolveFee = trpc.powerUp.resolveFee.useMutation({
    onSuccess: () => pendingFeesQuery.refetch(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const powerUps = powerUpsQuery.data || [];

  const resetForm = () => { setNewName(""); setNewEmoji("⚡"); setNewEffect(""); setNewCost("100"); setNewUsageFee("0"); setNewDuration(""); };

  const handleLoadDefaults = () => {
    if (!activeGameId) return;
    setSeedMessage(null);
    requestConfirmedAction({
      title: "Load All 44 Power-Ups",
      message: "This will add the complete spreadsheet catalog to your game shop. You can toggle individual ones on/off after.",
      confirmLabel: "Load All",
      isRunning: isSeedingRef.current,
      onRunningChange: setSeeding,
      run: () => seedAllPowerUps.mutateAsync({ gameId: activeGameId }),
    });
  };

  const handleCreate = () => {
    if (!newName.trim() || !newEffect.trim()) { Alert.alert("Error", "Name and effect are required"); return; }
    createPowerUp.mutate({
      gameId: activeGameId!,
      name: newName.trim(),
      emoji: newEmoji,
      effect: newEffect.trim(),
      cost: parseInt(newCost) || 100,
      usageFeeCents: Math.round((parseFloat(newUsageFee) || 0) * 100),
      duration: newDuration ? parseInt(newDuration) : null,
      category: newCategory,
    });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-xl font-bold text-foreground">⚡ Power-Up Setup</Text>
            <Text className="text-muted text-xs">{powerUps.length} configured</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View className="flex-row gap-3 mb-4">
          <TouchableOpacity
            className="flex-1 bg-primary/20 border border-primary rounded-xl p-3 items-center"
            onPress={handleLoadDefaults}
            disabled={isSeeding}
          >
            <Text className="text-primary font-bold text-sm">{isSeeding ? "Loading..." : "📦 Load All 44"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-surface border border-border rounded-xl p-3 items-center"
            onPress={() => setShowAdd(!showAdd)}
          >
            <Text className="text-foreground font-bold text-sm">{showAdd ? "Cancel" : "+ Custom"}</Text>
          </TouchableOpacity>
        </View>
        {seedMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${seedMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${seedMessage.kind === "success" ? "text-success" : "text-error"}`}>{seedMessage.text}</Text>
          </View>
        )}

        {/* Add Custom Form */}
        {showAdd && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">New Power-Up</Text>
            <View className="gap-3">
              <View className="flex-row gap-2">
                <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground w-14 text-center text-xl" value={newEmoji} onChangeText={setNewEmoji} />
                <TextInput className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Name" placeholderTextColor="#8B8B9E" value={newName} onChangeText={setNewName} />
              </View>
              <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Effect description" placeholderTextColor="#8B8B9E" value={newEffect} onChangeText={setNewEffect} multiline />
              <View className="flex-row gap-2">
                <TextInput className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Cost (pts)" placeholderTextColor="#8B8B9E" value={newCost} onChangeText={setNewCost} keyboardType="numeric" />
                <TextInput className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Duration (min)" placeholderTextColor="#8B8B9E" value={newDuration} onChangeText={setNewDuration} keyboardType="numeric" />
              </View>
              <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Manual use fee ($)" placeholderTextColor="#8B8B9E" value={newUsageFee} onChangeText={setNewUsageFee} keyboardType="decimal-pad" />
              <View className="flex-row gap-2">
                {(["offensive", "defensive", "utility", "special", "chaos"] as const).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    className={`flex-1 py-2 rounded-lg items-center ${newCategory === cat ? "bg-primary" : "bg-background border border-border"}`}
                    onPress={() => setNewCategory(cat)}
                  >
                    <Text className={`text-xs font-bold ${newCategory === cat ? "text-background" : "text-muted"}`}>{cat.slice(0, 3).toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity className="bg-primary py-3 rounded-xl items-center" onPress={handleCreate}>
                <Text className="text-background font-bold">Create Power-Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Manual cash-fee approvals */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-foreground font-bold mb-2">Pending Use Fees</Text>
          {(pendingFeesQuery.data || []).filter(fee => fee.status === "pending").length === 0 ? (
            <Text className="text-muted text-sm">No payments are waiting for approval.</Text>
          ) : (pendingFeesQuery.data || []).filter(fee => fee.status === "pending").map(fee => (
            <View key={fee.id} className="border-t border-border py-3">
              <Text className="text-foreground">{fee.playerName} · {fee.powerUpName} · ${(fee.amountCents / 100).toFixed(2)}</Text>
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity className="bg-success px-3 py-2 rounded-lg" onPress={() => resolveFee.mutate({ gameId: activeGameId!, feeId: fee.id, status: "paid" })}>
                  <Text className="text-background font-bold">Mark Paid</Text>
                </TouchableOpacity>
                <TouchableOpacity className="bg-background border border-border px-3 py-2 rounded-lg" onPress={() => resolveFee.mutate({ gameId: activeGameId!, feeId: fee.id, status: "waived" })}>
                  <Text className="text-foreground font-bold">Waive</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Power-Ups List */}
        {powerUps.length === 0 ? (
          <View className="bg-surface rounded-xl p-8 border border-border items-center">
            <Text className="text-muted text-center">No power-ups configured. Load defaults or add custom ones.</Text>
          </View>
        ) : (
          <View className="gap-2">
            {powerUps.map((pu) => (
              <View key={pu.id} className={`bg-surface rounded-xl p-4 border ${pu.isEnabled ? "border-border" : "border-error/30"}`}>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-lg">{pu.emoji}</Text>
                      <Text className={`font-bold ${pu.isEnabled ? "text-foreground" : "text-muted"}`}>{pu.name}</Text>
                      <Text className="text-xs text-muted bg-background px-2 py-0.5 rounded">{pu.category}</Text>
                    </View>
                    <Text className="text-muted text-xs mt-1">{pu.effect}</Text>
                    <View className="flex-row gap-3 mt-2">
                      <Text className="text-primary text-xs font-bold">{pu.cost} pts</Text>
                      {(pu.usageFeeCents || 0) > 0 && <Text className="text-primary text-xs font-bold">${(pu.usageFeeCents / 100).toFixed(2)} use fee</Text>}
                      {pu.duration && <Text className="text-muted text-xs">⏱️ {pu.duration}min</Text>}
                      {pu.discount ? <Text className="text-success text-xs">-{pu.discount}%</Text> : null}
                    </View>
                  </View>
                  <TouchableOpacity
                    className={`w-12 h-7 rounded-full justify-center ${pu.isEnabled ? "bg-primary items-end" : "bg-border items-start"}`}
                    onPress={() => updatePowerUp.mutate({ id: pu.id, isEnabled: !pu.isEnabled })}
                  >
                    <View className="w-5 h-5 rounded-full bg-foreground mx-1" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
