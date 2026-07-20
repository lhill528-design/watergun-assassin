import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const STANDARD_RULES: Record<string, string[]> = {
  last_man_standing: [
    "Players are eliminated when hit with a water gun",
    "Safe object must be held (not just carried) to be immune",
    "No eliminations inside homes or workplaces",
    "No eliminations while target is driving",
    "Video evidence required for all eliminations",
    "Eliminated players cannot reveal their assassin",
    "No water balloons or super soakers - pistols only",
    "Players must update location every 4 hours during active rounds",
  ],
  highest_points: [
    "Points awarded per elimination: 100",
    "Bonus points for creative eliminations: 50",
    "Points deducted for false claims: -50",
    "Safe object must be held to be immune",
    "Video evidence required for all eliminations",
    "No eliminations inside homes or workplaces",
    "Players can be eliminated multiple times",
    "Players respawn after 2 hours",
  ],
  most_eliminations: [
    "Only confirmed kills count toward total",
    "Video evidence required for all eliminations",
    "Safe object must be held to be immune",
    "No eliminations inside homes or workplaces",
    "No eliminations while target is driving",
    "Players respawn after 1 hour",
    "Ties broken by fewer deaths",
  ],
  teams: [
    "Teams of 2 players each",
    "Both team members must be eliminated to be out",
    "Partners can revive each other once per round",
    "Safe object applies to both team members",
    "Video evidence required for all eliminations",
    "No eliminations inside homes or workplaces",
    "Team communication is encouraged",
  ],
};

export default function AdminRulesScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [newRule, setNewRule] = useState("");

  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const rulesQuery = trpc.rules.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createRule = trpc.rules.create.useMutation({ onSuccess: () => { rulesQuery.refetch(); setNewRule(""); } });
  const updateRule = trpc.rules.update.useMutation({ onSuccess: () => rulesQuery.refetch() });

  const game = gameQuery.data;
  const rules = rulesQuery.data || [];

  const handleAddStandardRules = () => {
    if (!game?.gameType) return;
    const standardRules = STANDARD_RULES[game.gameType] || [];
    Alert.alert(
      "Add Standard Rules",
      `Add ${standardRules.length} standard rules for ${game.gameType.replace(/_/g, " ")}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add All",
          onPress: () => {
            standardRules.forEach((rule) => {
              createRule.mutate({ gameId: activeGameId!, ruleText: rule, isStandard: true });
            });
          },
        },
      ]
    );
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
        >
          <Text className="text-primary font-bold">📋 Load Standard Rules</Text>
          <Text className="text-primary/70 text-xs mt-1">For {game?.gameType?.replace(/_/g, " ") || "game type"}</Text>
        </TouchableOpacity>

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
