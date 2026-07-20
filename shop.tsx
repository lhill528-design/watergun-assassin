import { Text, View, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState, useCallback } from "react";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "offensive", label: "⚔️ Offensive" },
  { key: "defensive", label: "🛡️ Defensive" },
  { key: "utility", label: "🔧 Utility" },
  { key: "special", label: "✨ Special" },
];

const DEMO_POWERUPS = [
  { id: 1, name: "Shield", emoji: "🛡️", effect: "Immunity from elimination, 2hr", cost: 200, duration: 120, category: "defensive", isEnabled: true, discount: 0, description: "Activates a protective barrier around you. While active, any elimination attempt against you automatically fails." },
  { id: 2, name: "Ghost Mode", emoji: "👻", effect: "Hide GPS location, 1hr", cost: 150, duration: 60, category: "defensive", isEnabled: true, discount: 0, description: "Your location completely disappears from all maps, including your target's tracker and during purge events." },
  { id: 3, name: "Safe Swap", emoji: "📍", effect: "Swap Safe object for 24hrs", cost: 300, duration: 1440, category: "utility", isEnabled: true, discount: 0, description: "Allows you to temporarily change your designated safe object to any other object of your choosing for 24 hours." },
  { id: 4, name: "Place Bounty", emoji: "💰", effect: "150pt bounty on any player", cost: 150, duration: null, category: "offensive", isEnabled: true, discount: 0, description: "Place a 150-point bounty on any alive player. When that player is eliminated, the eliminator collects the bounty points." },
  { id: 5, name: "Revive", emoji: "\u2764\ufe0f", effect: "Come back to life after elimination", cost: 500, duration: null, category: "special", isEnabled: true, discount: 0, description: "The ultimate second chance. If you are eliminated while holding this power-up, you automatically come back to life." },
  { id: 6, name: "Target Switch", emoji: "🔄", effect: "Swap for a random new target", cost: 150, duration: null, category: "utility", isEnabled: true, discount: 0, description: "Instantly reassigns you a new random target from the pool of alive players." },
  { id: 7, name: "Stripper", emoji: "💀", effect: "Strip target's active power-ups", cost: 250, duration: null, category: "offensive", isEnabled: true, discount: 0, description: "Immediately deactivates ALL active power-ups on your current target." },
  { id: 8, name: "Radar", emoji: "📡", effect: "Reveal all alive players on map, 30min", cost: 200, duration: 30, category: "utility", isEnabled: true, discount: 0, description: "For 30 minutes, your map shows the real-time location of EVERY alive player, not just your target." },
  { id: 9, name: "Roulette", emoji: "🎰", effect: "Spin for random prize/penalty", cost: 75, duration: null, category: "special", isEnabled: true, discount: 0, description: "Spin the wheel! Possible outcomes: free power-up, point bonus, point penalty, discount coupon, or nothing." },
];

export default function ShopScreen() {
  const { activeGameId, demoMode } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const powerUpsQuery = trpc.powerUp.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const purchaseMutation = trpc.powerUp.purchase.useMutation({
    onSuccess: () => {
      playerQuery.refetch();
      Alert.alert("Success!", "Power-up purchased and activated!");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const powerUps = powerUpsQuery.data || [];
  const player = playerQuery.data;

  const filteredPowerUps = selectedCategory === "all"
    ? powerUps.filter(p => p.isEnabled)
    : powerUps.filter(p => p.isEnabled && p.category === selectedCategory);

  const handlePurchase = (powerUpId: number, name: string, cost: number) => {
    Alert.alert(
      "Purchase Power-Up",
      `Buy ${name} for ${cost} points?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Buy", onPress: () => purchaseMutation.mutate({ gameId: activeGameId!, powerUpId }) },
      ]
    );
  };

  if ((!activeGameId || !isAuthenticated) && !demoMode) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-2">🛒</Text>
          <Text className="text-foreground text-lg font-bold">Power-Up Shop</Text>
          <Text className="text-muted text-sm mt-1">Join a game to access the shop</Text>
        </View>
      </ScreenContainer>
    );
  }

  // Use demo data when in demo mode
  const displayPowerUps = demoMode ? DEMO_POWERUPS : powerUps;
  const displayFiltered = selectedCategory === "all"
    ? displayPowerUps.filter(p => p.isEnabled)
    : displayPowerUps.filter(p => p.isEnabled && p.category === selectedCategory);

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {/* Header with balance */}
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-2xl font-bold text-foreground">Power-Up Shop</Text>
            <Text className="text-muted text-sm">{filteredPowerUps.length} items available</Text>
          </View>
          <View className="bg-surface border border-primary rounded-xl px-4 py-2">
            <Text className="text-xs text-muted">Balance</Text>
            <Text className="text-primary font-bold text-lg">{player?.points || 0} pts</Text>
          </View>
        </View>

        {/* Roulette Banner */}
        <TouchableOpacity
          className="bg-primary/20 border border-primary rounded-xl p-4 mb-4 flex-row items-center justify-between"
          onPress={() => router.push("/roulette" as any)}
        >
          <View className="flex-row items-center gap-3">
            <Text style={{ fontSize: 28 }}>🎰</Text>
            <View>
              <Text className="text-foreground font-bold">Spin the Roulette!</Text>
              <Text className="text-muted text-xs">75 pts per spin — win prizes or face penalties</Text>
            </View>
          </View>
          <Text className="text-primary font-bold">→</Text>
        </TouchableOpacity>

        {/* Category Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
          <View className="flex-row gap-2">
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                className={`px-4 py-2 rounded-full ${selectedCategory === cat.key ? "bg-primary" : "bg-surface border border-border"}`}
                onPress={() => setSelectedCategory(cat.key)}
              >
                <Text className={`text-sm font-semibold ${selectedCategory === cat.key ? "text-background" : "text-foreground"}`}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Power-Up Grid */}
        {displayFiltered.length === 0 ? (
          <View className="bg-surface rounded-xl p-8 items-center border border-border">
            <Text className="text-muted text-center">No power-ups available in this category</Text>
          </View>
        ) : (
          <View className="gap-3">
            {displayFiltered.map((pu) => {
              const discountedCost = pu.discount ? Math.floor(pu.cost * (1 - (pu.discount || 0) / 100)) : pu.cost;
              const canAfford = (player?.points || 0) >= discountedCost;

              return (
                <View key={pu.id} className="bg-surface rounded-xl p-4 border border-border">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 mb-1">
                        <Text className="text-2xl">{pu.emoji}</Text>
                        <Text className="text-foreground font-bold text-base">{pu.name}</Text>
                      </View>
                      <Text className="text-muted text-sm">{pu.effect}</Text>
                      {(pu as any).description && (
                        <TouchableOpacity onPress={() => setExpandedId(expandedId === pu.id ? null : pu.id)}>
                          <Text className="text-primary text-xs mt-1 font-semibold">
                            {expandedId === pu.id ? "Hide details ▲" : "Show details ▼"}
                          </Text>
                          {expandedId === pu.id && (
                            <Text className="text-muted text-xs mt-1 leading-relaxed">{(pu as any).description}</Text>
                          )}
                        </TouchableOpacity>
                      )}
                      {pu.duration && (
                        <Text className="text-muted text-xs mt-1">⏱️ Duration: {pu.duration >= 60 ? `${Math.floor(pu.duration / 60)}hr` : `${pu.duration}min`}</Text>
                      )}
                    </View>
                    <View className="items-end">
                      {pu.discount ? (
                        <View>
                          <Text className="text-muted text-xs line-through">{pu.cost} pts</Text>
                          <Text className="text-success font-bold">{discountedCost} pts</Text>
                          <Text className="text-success text-xs">-{pu.discount}%</Text>
                        </View>
                      ) : (
                        <Text className="text-foreground font-bold">{pu.cost} pts</Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    className={`mt-3 py-2 rounded-lg items-center ${canAfford ? "bg-primary" : "bg-surface border border-muted"}`}
                    onPress={() => canAfford && handlePurchase(pu.id, pu.name, discountedCost)}
                    disabled={!canAfford}
                  >
                    <Text className={`font-bold text-sm ${canAfford ? "text-background" : "text-muted"}`}>
                      {canAfford ? "Purchase" : "Not Enough Points"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
