import { Text, View, TouchableOpacity, Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";

export default function EliminationUploadScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const playersQuery = trpc.player.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const submitMutation = trpc.elimination.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      Alert.alert("Submitted!", "Your elimination claim has been submitted for admin review.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const player = playerQuery.data;
  const players = playersQuery.data || [];

  const handleSubmit = () => {
    if (!activeGameId || !player?.targetId) return;
    Alert.alert(
      "Submit Elimination",
      "Claim this elimination? Admin will review your evidence.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: () => {
            submitMutation.mutate({
              gameId: activeGameId,
              eliminatedId: player.targetId!,
              videoUrl: "pending-upload",
            });
          },
        },
      ]
    );
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Header */}
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3">
            <Text className="text-primary text-lg">←</Text>
          </TouchableOpacity>
          <View>
            <Text className="text-xl font-bold text-foreground">🎬 Submit Elimination</Text>
            <Text className="text-muted text-sm">Upload video evidence for review</Text>
          </View>
        </View>

        {submitted ? (
          <View className="items-center py-12">
            <Text className="text-5xl mb-4">✅</Text>
            <Text className="text-foreground text-xl font-bold">Submitted!</Text>
            <Text className="text-muted text-center mt-2">Your elimination claim is pending admin review.</Text>
            <TouchableOpacity
              className="bg-primary px-6 py-3 rounded-full mt-6"
              onPress={() => router.back()}
            >
              <Text className="text-background font-bold">Back to Home</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {/* Target Info */}
            <View className="bg-surface rounded-xl p-4 mb-4 border border-error/30">
              <Text className="text-xs text-error uppercase tracking-wider mb-1">Target</Text>
              <Text className="text-foreground text-lg font-bold">
                {player?.targetId ? `Player #${player.targetId}` : "No target assigned"}
              </Text>
            </View>

            {/* Video Upload Area */}
            <View className="bg-surface rounded-xl p-8 mb-4 border border-border border-dashed items-center">
              <Text className="text-4xl mb-3">📹</Text>
              <Text className="text-foreground font-bold text-base">Upload Video Evidence</Text>
              <Text className="text-muted text-sm text-center mt-2">
                Record or upload a video showing the elimination
              </Text>
              <TouchableOpacity className="bg-primary/20 border border-primary px-6 py-3 rounded-xl mt-4">
                <Text className="text-primary font-bold">Choose Video</Text>
              </TouchableOpacity>
            </View>

            {/* Instructions */}
            <View className="bg-surface rounded-xl p-4 mb-6 border border-border">
              <Text className="text-sm font-bold text-foreground mb-2">📋 Requirements</Text>
              <View className="gap-2">
                <Text className="text-muted text-sm">• Video must clearly show the elimination</Text>
                <Text className="text-muted text-sm">• Target must be identifiable</Text>
                <Text className="text-muted text-sm">• Water gun hit must be visible</Text>
                <Text className="text-muted text-sm">• Admin will review within 24 hours</Text>
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              className={`py-4 rounded-xl items-center ${player?.targetId ? "bg-error" : "bg-surface border border-muted"}`}
              onPress={handleSubmit}
              disabled={!player?.targetId || submitMutation.isPending}
            >
              <Text className={`font-bold text-base ${player?.targetId ? "text-background" : "text-muted"}`}>
                {submitMutation.isPending ? "Submitting..." : "Submit Elimination Claim"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
