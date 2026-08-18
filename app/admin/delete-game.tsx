import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { requestGameDeletion } from "@/lib/game-deletion";

export default function DeleteGameScreen() {
  const router = useRouter();
  const { activeGameId, setActiveGameId } = useGame();
  const utils = trpc.useUtils();
  const [confirmationName, setConfirmationName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // A ref (not just the isDeleting state above) so the guard is checked
  // synchronously -- a second tap that lands before React re-renders the
  // disabled button still can't slip through and open a second
  // confirmation dialog.
  const isDeletingRef = useRef(false);
  const setDeleting = (deleting: boolean) => {
    isDeletingRef.current = deleting;
    setIsDeleting(deleting);
  };
  const gameQuery = trpc.game.get.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const deleteMutation = trpc.game.delete.useMutation({
    onSuccess: () => {
      const deletedGameId = activeGameId;
      setActiveGameId(null);
      utils.game.myGames.invalidate();
      utils.game.adminGames.invalidate();
      utils.game.history.invalidate();
      if (deletedGameId != null) utils.game.get.invalidate({ gameId: deletedGameId });
      router.replace("/(tabs)/profile" as any);
    },
    onError: (error) => setDeleteError(error.message),
  });
  const game = gameQuery.data;
  const matches = Boolean(game && confirmationName.trim() === game.name);

  const handleDelete = () => {
    setDeleteError(null);
    requestGameDeletion({
      gameName: game?.name || "",
      isDeleting: isDeletingRef.current,
      onDeletingChange: setDeleting,
      deleteGame: () => deleteMutation.mutateAsync({ gameId: activeGameId!, confirmationName: confirmationName.trim() }),
    });
  };

  return <ScreenContainer edges={["top", "left", "right", "bottom"]}>
    <View className="p-5">
      <TouchableOpacity onPress={() => router.back()}><Text className="text-primary text-lg mb-6">← Back</Text></TouchableOpacity>
      <Text className="text-error text-2xl font-bold mb-3">Delete Game Permanently</Text>
      <Text className="text-foreground mb-4">Use this only for a mistaken or test game. Completing a real game keeps it in every participant's Game History.</Text>
      <Text className="text-muted mb-2">Type the exact game name to unlock deletion:</Text>
      <Text className="text-foreground font-bold mb-3">{game?.name || "Loading…"}</Text>
      <TextInput className="bg-surface border border-error rounded-xl p-4 text-foreground mb-5" value={confirmationName} onChangeText={setConfirmationName} placeholder="Exact game name" placeholderTextColor="#888" autoCapitalize="none" />
      {deleteError && <Text className="text-error text-sm mb-4">{deleteError}</Text>}
      <TouchableOpacity className={`p-4 rounded-xl items-center ${matches ? "bg-error" : "bg-surface border border-muted"}`} disabled={!matches || isDeleting} onPress={handleDelete}><Text className={matches ? "text-white font-bold" : "text-muted font-bold"}>{isDeleting ? "Deleting…" : "Delete Game Permanently"}</Text></TouchableOpacity>
    </View>
  </ScreenContainer>;
}
