import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";

export default function DeleteGameScreen() {
  const router = useRouter();
  const { activeGameId, setActiveGameId } = useGame();
  const [confirmationName, setConfirmationName] = useState("");
  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const deleteMutation = trpc.game.delete.useMutation({
    onSuccess: () => { setActiveGameId(null); Alert.alert("Game Deleted", "The game and all of its related records were permanently removed.", [{ text: "OK", onPress: () => router.replace("/(tabs)/profile" as any) }]); },
    onError: error => Alert.alert("Could not delete game", error.message),
  });
  const game = gameQuery.data;
  const matches = Boolean(game && confirmationName.trim() === game.name);
  const confirmDelete = () => Alert.alert("Final confirmation", `Permanently delete “${game?.name}”? Completed games should normally be preserved in Game History. This cannot be undone.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete Permanently", style: "destructive", onPress: () => deleteMutation.mutate({ gameId: activeGameId!, confirmationName }) },
  ]);
  return <ScreenContainer edges={["top", "left", "right", "bottom"]}>
    <View className="p-5">
      <TouchableOpacity onPress={() => router.back()}><Text className="text-primary text-lg mb-6">← Back</Text></TouchableOpacity>
      <Text className="text-error text-2xl font-bold mb-3">Delete Game Permanently</Text>
      <Text className="text-foreground mb-4">Use this only for a mistaken or test game. Completing a real game keeps it in every participant's Game History.</Text>
      <Text className="text-muted mb-2">Type the exact game name to unlock deletion:</Text>
      <Text className="text-foreground font-bold mb-3">{game?.name || "Loading…"}</Text>
      <TextInput className="bg-surface border border-error rounded-xl p-4 text-foreground mb-5" value={confirmationName} onChangeText={setConfirmationName} placeholder="Exact game name" placeholderTextColor="#888" autoCapitalize="none" />
      <TouchableOpacity className={`p-4 rounded-xl items-center ${matches ? "bg-error" : "bg-surface border border-muted"}`} disabled={!matches || deleteMutation.isPending} onPress={confirmDelete}><Text className={matches ? "text-white font-bold" : "text-muted font-bold"}>{deleteMutation.isPending ? "Deleting…" : "Delete Game Permanently"}</Text></TouchableOpacity>
    </View>
  </ScreenContainer>;
}
