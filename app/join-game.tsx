import { Text, View, TouchableOpacity, TextInput, Alert, Share, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";

export default function JoinGameScreen() {
  const router = useRouter();
  const { setActiveGameId } = useGame();
  const params = useLocalSearchParams<{ code?: string }>();
  const [joinCode, setJoinCode] = useState("");

  // Auto-fill join code from deep link params
  useEffect(() => {
    if (params.code) {
      setJoinCode(params.code.toUpperCase());
    }
  }, [params.code]);

  const joinMutation = trpc.game.join.useMutation({
    onSuccess: (data) => {
      setActiveGameId(data.gameId);
      Alert.alert("Joined!", "You've joined the game successfully.", [
        { text: "Let's Go! 💦", onPress: () => router.replace("/(tabs)") },
      ]);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleJoin = () => {
    if (!joinCode.trim()) {
      Alert.alert("Error", "Enter a join code");
      return;
    }
    joinMutation.mutate({ joinCode: joinCode.trim().toUpperCase() });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]} className="p-4">
      <View className="flex-row items-center mb-6">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text className="text-primary text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-foreground text-xl font-bold ml-2">Join Game</Text>
      </View>

      <View className="flex-1 justify-center px-4">
        <View className="items-center mb-8">
          <Text className="text-5xl mb-4">🎮</Text>
          <Text className="text-foreground text-2xl font-bold text-center">Enter Join Code</Text>
          <Text className="text-muted text-sm text-center mt-2">Get the code from your game admin</Text>
          {params.code ? (
            <View className="mt-3 bg-success/20 border border-success rounded-xl px-4 py-2">
              <Text className="text-success text-sm text-center font-semibold">✅ Code auto-filled from invite link</Text>
            </View>
          ) : null}
        </View>

        <View className="bg-surface rounded-xl p-6 border border-border mb-6">
          <Text className="text-muted text-xs uppercase tracking-wider mb-2">Game Code</Text>
          <TextInput
            className="bg-background border border-border rounded-xl px-4 py-4 text-foreground text-center text-2xl font-bold tracking-[8px]"
            placeholder="ABC123"
            placeholderTextColor="#555"
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity
          className="bg-primary rounded-xl py-4 items-center"
          onPress={handleJoin}
          disabled={joinMutation.isPending}

        >
          <Text className="text-background font-bold text-lg">
            {joinMutation.isPending ? "Joining..." : "Join Game 💦"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}
