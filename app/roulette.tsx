import { Text, View, TouchableOpacity, ScrollView, Alert, Animated, Easing } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export default function RouletteScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const [lastResult, setLastResult] = useState<{ outcome: { name: string; emoji: string; type: string; value: number | null; description: string | null }; message: string } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;

  const gameId = activeGameId ?? 0;

  const outcomesQuery = trpc.roulette.list.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );
  const powerUpsQuery = trpc.powerUp.list.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );
  const playerQuery = trpc.player.me.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );

  const roulettePowerUp = (powerUpsQuery.data || []).find(p => p.name === "Roulette" && p.isEnabled);
  const rouletteCost = roulettePowerUp ? 50 : null;
  const player = playerQuery.data;

  const spinMutation = trpc.roulette.spin.useMutation({
    onSuccess: (data) => {
      setLastResult(data);
      setSpinning(false);
      playerQuery.refetch();
      powerUpsQuery.refetch();
      utils.powerUp.inventory.invalidate({ gameId });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    onError: (err) => {
      setSpinning(false);
      Alert.alert("Can't Spin", err.message);
    },
  });

  const handleSpin = () => {
    if (spinning || gameId === 0 || rouletteCost == null) return;
    setSpinning(true);
    setLastResult(null);

    // Animate wheel spin
    spinAnim.setValue(0);
    Animated.timing(spinAnim, {
      toValue: 1,
      duration: 1800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      spinMutation.mutate({ gameId });
    });
  };

  const spinRotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "1440deg"],
  });

  const outcomes = outcomesQuery.data?.filter(o => o.isEnabled) ?? [];

  const getResultColor = (type: string) => {
    switch (type) {
      case "points_bonus": return "text-success";
      case "points_penalty": return "text-error";
      case "power_up": return "text-primary";
      case "discount_coupon": return "text-warning";
      default: return "text-muted";
    }
  };

  if (!activeGameId) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-2">🎰</Text>
          <Text className="text-foreground text-lg font-bold">No Active Game</Text>
          <Text className="text-muted text-sm mt-1">Join a game to spin the roulette</Text>
          <TouchableOpacity
            className="mt-4 bg-primary px-6 py-3 rounded-full"
            onPress={() => router.back()}
          >
            <Text className="text-background font-bold">Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
          <View className="flex-row items-center">
            <TouchableOpacity onPress={() => router.back()} className="mr-3 p-2">
              <Text className="text-primary text-lg">← Back</Text>
            </TouchableOpacity>
            <Text className="text-2xl font-bold text-foreground">🎰 Roulette</Text>
          </View>
          <View className="bg-surface border border-primary rounded-xl px-3 py-1.5">
            <Text className="text-xs text-muted">Balance</Text>
            <Text className="text-primary font-bold">{player?.points ?? 0} pts</Text>
          </View>
        </View>

        <View className="px-4 pb-6">
          {/* Cost reminder */}
          <View className="bg-surface border border-border rounded-xl p-3 mb-4">
            <Text className="text-muted text-sm text-center">
              {rouletteCost != null ? `${rouletteCost} points per spin` : "Roulette unavailable"} · Win prizes or face penalties
            </Text>
          </View>

          {/* Wheel */}
          <View className="items-center mb-6">
            <Animated.View style={{ transform: [{ rotate: spinRotation }] }}>
              <View className="w-48 h-48 rounded-full bg-primary/20 border-4 border-primary items-center justify-center">
                <Text style={{ fontSize: 72 }}>🎰</Text>
              </View>
            </Animated.View>
          </View>

          {/* Spin button */}
          <TouchableOpacity
            className="bg-primary rounded-2xl py-4 items-center mb-6"
            onPress={handleSpin}
            disabled={spinning || rouletteCost == null}
            style={spinning || rouletteCost == null ? { opacity: 0.6 } : undefined}
          >
            <Text className="text-background font-bold text-xl">
              {spinning ? "Spinning..." : rouletteCost != null ? `🎲 SPIN (${rouletteCost} pts)` : "Unavailable"}
            </Text>
          </TouchableOpacity>

          {/* Result */}
          {lastResult && (
            <View className="bg-surface border border-primary rounded-2xl p-5 mb-6 items-center">
              <Text style={{ fontSize: 48 }}>{lastResult.outcome.emoji}</Text>
              <Text className="text-foreground font-bold text-xl mt-2">{lastResult.outcome.name}</Text>
              <Text className={`font-bold text-lg mt-1 ${getResultColor(lastResult.outcome.type)}`}>
                {lastResult.message}
              </Text>
              {lastResult.outcome.description && (
                <Text className="text-muted text-sm mt-2 text-center">{lastResult.outcome.description}</Text>
              )}
              {lastResult.outcome.type === "discount_coupon" && (
                <Text className="text-warning text-xs mt-2 text-center">Your next Shop purchase will automatically be discounted.</Text>
              )}
            </View>
          )}

          {/* Possible outcomes */}
          {outcomes.length > 0 && (
            <View>
              <Text className="text-foreground font-bold text-lg mb-3">Possible Outcomes</Text>
              {outcomes.map((o) => (
                <View key={o.id} className="flex-row items-center bg-surface border border-border rounded-xl px-4 py-3 mb-2">
                  <Text style={{ fontSize: 24, marginRight: 12 }}>{o.emoji}</Text>
                  <View className="flex-1">
                    <Text className="text-foreground font-semibold">{o.name}</Text>
                    {o.description ? (
                      <Text className="text-muted text-xs mt-0.5">{o.description}</Text>
                    ) : null}
                  </View>
                  <Text className="text-muted text-xs">×{o.weight}</Text>
                </View>
              ))}
            </View>
          )}

          {outcomes.length === 0 && !outcomesQuery.isLoading && (
            <View className="bg-surface border border-border rounded-xl p-4 items-center">
              <Text className="text-muted text-sm">No outcomes configured yet. Ask the admin to set up roulette.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
