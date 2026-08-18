import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestConfirmedAction } from "@/lib/confirm-then-run";
import { useRef, useState } from "react";

export default function AdminRulesScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [newRule, setNewRule] = useState("");
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

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const rulesQuery = trpc.rules.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createRule = trpc.rules.create.useMutation({ onSuccess: () => { rulesQuery.refetch(); setNewRule(""); } });
  const updateRule = trpc.rules.update.useMutation({ onSuccess: () => rulesQuery.refetch() });
  const seedStandardRules = trpc.rules.seedStandard.useMutation({
    onSuccess: (data) => {
      utils.rules.list.invalidate({ gameId: activeGameId! });
      const skippedNote = data.skipped ? ` (${data.skipped} already loaded)` : "";
      setSeedMessage({
        kind: "success",
        text: data.created > 0
          ? `Added ${data.created} standard rule${data.created === 1 ? "" : "s"}${skippedNote}.`
          : `Standard rules are already loaded${skippedNote}.`,
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

  const game = gameQuery.data;
  const rules = rulesQuery.data || [];

  const handleAddStandardRules = () => {
    if (!activeGameId) return;
    setSeedMessage(null);
    requestConfirmedAction({
      title: "Add Standard Rules",
      message: `Add the standard rules for ${game?.gameType?.replace(/_/g, " ") || "this game type"}? Rules already loaded won't be duplicated.`,
      confirmLabel: "Add All",
      isRunning: isSeedingRef.current,
      onRunningChange: setSeeding,
      run: () => seedStandardRules.mutateAsync({ gameId: activeGameId }),
    });
  };

  const handleAddCustomRule = () => {
    if (!newRule.trim()) return;
    createRule.mutate({ gameId: activeGameId!, ruleText: newRule.trim(), isStandard: false });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-xl font-bold text-foreground">📜 Rules Manager</Text>
            <Text className="text-muted text-xs">{rules.length} rules configured</Text>
          </View>
        </View>

        {/* Add Standard Rules */}
        <TouchableOpacity
          className="bg-primary/20 border border-primary rounded-xl p-4 mb-4 items-center"
          onPress={handleAddStandardRules}
          disabled={isSeeding}
        >
          <Text className="text-primary font-bold">{isSeeding ? "Loading..." : "📋 Load Standard Rules"}</Text>
          <Text className="text-primary/70 text-xs mt-1">For {game?.gameType?.replace(/_/g, " ") || "game type"}</Text>
        </TouchableOpacity>
        {seedMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${seedMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${seedMessage.kind === "success" ? "text-success" : "text-error"}`}>{seedMessage.text}</Text>
          </View>
        )}

        {/* Add Custom Rule */}
        <View className="mb-4">
          <Text className="text-sm font-bold text-foreground mb-2">Add Custom Rule</Text>
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-foreground text-sm"
              placeholder="Enter custom rule..."
              placeholderTextColor="#8B8B9E"
              value={newRule}
              onChangeText={setNewRule}
              returnKeyType="done"
              onSubmitEditing={handleAddCustomRule}
            />
            <TouchableOpacity
              className="bg-primary px-4 rounded-xl justify-center"
              onPress={handleAddCustomRule}
            >
              <Text className="text-background font-bold">+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Rules List */}
        <Text className="text-sm font-bold text-foreground mb-3">Active Rules</Text>
        {rules.length === 0 ? (
          <View className="bg-surface rounded-xl p-6 border border-border items-center">
            <Text className="text-muted">No rules configured yet</Text>
          </View>
        ) : (
          <View className="gap-2">
            {rules.map((rule, index) => (
              <View key={rule.id} className="bg-surface rounded-xl p-4 border border-border">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 flex-row items-start gap-3">
                    <Text className="text-muted text-sm">{index + 1}.</Text>
                    <View className="flex-1">
                      <Text className={`text-sm ${rule.isEnabled ? "text-foreground" : "text-muted line-through"}`}>
                        {rule.ruleText}
                      </Text>
                      {rule.isStandard && (
                        <Text className="text-primary text-xs mt-1">Standard Rule</Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    className={`w-12 h-7 rounded-full justify-center ${rule.isEnabled ? "bg-primary items-end" : "bg-border items-start"}`}
                    onPress={() => updateRule.mutate({ id: rule.id, isEnabled: !rule.isEnabled })}
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
