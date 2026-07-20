import { Text, View, ScrollView, TouchableOpacity, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

const DEFAULT_ACHIEVEMENTS = [
  { name: "First Blood", emoji: "🩸", description: "Get the first elimination of the game", pointsValue: 200, condition: "first_kill" },
  { name: "Double Kill", emoji: "💀💀", description: "Eliminate 2 players in one round", pointsValue: 150, condition: "double_kill" },
  { name: "Survivor", emoji: "🏆", description: "Survive 3 rounds without being eliminated", pointsValue: 300, condition: "survive_3_rounds" },
  { name: "Ghost", emoji: "👻", description: "Eliminate target without them seeing you", pointsValue: 250, condition: "stealth_kill" },
  { name: "Purge Master", emoji: "⚠️", description: "Get 3+ eliminations during a single purge", pointsValue: 400, condition: "purge_master" },
  { name: "Untouchable", emoji: "🛡️", description: "Go an entire round without being targeted", pointsValue: 200, condition: "untouchable" },
  { name: "Comeback Kid", emoji: "💪", description: "Get an elimination within 1 hour of being revived", pointsValue: 300, condition: "comeback" },
  { name: "Headhunter", emoji: "🎯", description: "Eliminate 5 players total", pointsValue: 500, condition: "5_kills" },
  { name: "Social Butterfly", emoji: "🦋", description: "Send 50 messages in game chat", pointsValue: 100, condition: "50_messages" },
  { name: "Power Shopper", emoji: "🛒", description: "Purchase 5 different power-ups", pointsValue: 150, condition: "5_powerups" },
];

export default function AdminAchievementsScreen() {
  const { activeGameId } = useGame();
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏅");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("100");

  const achievementsQuery = trpc.achievement.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const createAchievement = trpc.achievement.create.useMutation({ onSuccess: () => { achievementsQuery.refetch(); setShowAdd(false); resetForm(); } });
  const seedAllAchievements = trpc.achievement.seedAll.useMutation({
    onSuccess: (data) => {
      Alert.alert("Success", `Loaded ${data.created} achievements!`);
      achievementsQuery.refetch();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const achievements = achievementsQuery.data || [];

  const resetForm = () => { setName(""); setEmoji("🏅"); setDescription(""); setPoints("100"); };

  const handleLoadDefaults = () => {
    Alert.alert("Load All 55 Achievements", "This will add all 55 achievements from the official list (Combat, Survival, Chaos). Existing ones will remain.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Load All 55",
        onPress: () => seedAllAchievements.mutate({ gameId: activeGameId! }),
      },
    ]);
  };

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Error", "Name is required"); return; }
    createAchievement.mutate({
      gameId: activeGameId!,
      name: name.trim(),
      emoji,
      description: description.trim(),
      pointsValue: parseInt(points) || 100,
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
            <Text className="text-xl font-bold text-foreground">🏅 Achievements</Text>
            <Text className="text-muted text-xs">{achievements.length} badges configured</Text>
          </View>
        </View>

        {/* Actions */}
        <View className="flex-row gap-3 mb-4">
          <TouchableOpacity
            className="flex-1 bg-primary/20 border border-primary rounded-xl p-3 items-center"
            onPress={handleLoadDefaults}
          >
            <Text className="text-primary font-bold text-sm">📦 Load All 55</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-surface border border-border rounded-xl p-3 items-center"
            onPress={() => setShowAdd(!showAdd)}
          >
            <Text className="text-foreground font-bold text-sm">{showAdd ? "Cancel" : "+ Custom"}</Text>
          </TouchableOpacity>
        </View>

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
              <TouchableOpacity className="bg-primary py-3 rounded-xl items-center" onPress={handleCreate}>
                <Text className="text-background font-bold">Create Achievement</Text>
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
