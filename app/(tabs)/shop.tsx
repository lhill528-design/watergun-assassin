import { Text, View, ScrollView, TouchableOpacity, Alert, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import * as Location from "expo-location";

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "offensive", label: "⚔️ Offensive" },
  { key: "defensive", label: "🛡️ Defensive" },
  { key: "utility", label: "🔧 Utility" },
  { key: "special", label: "✨ Special" },
  { key: "chaos", label: "🎲 Chaos" },
];

const TARGETED_POWER_UPS = new Set([
  "Bounty", "Raise the Stakes", "Blacklist", "Asset Freeze", "Sabotage",
  "Sniper's Duel", "Fall Guy", "Frame Job", "Strip Search", "Doppelganger", "Mirror, Mirror", "Bodyguard", "Pickpocket",
  "Lifeline", "Care Package", "Wildcard", "Vendetta", "Reassignment",
]);

export default function ShopScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<Record<number, number>>({});
  const [selectedGifts, setSelectedGifts] = useState<Record<number, number>>({});
  const [safeObjects, setSafeObjects] = useState<Record<number, string>>({});
  const [sanctuaryAddresses, setSanctuaryAddresses] = useState<Record<number, string>>({});
  const [decoyModes, setDecoyModes] = useState<Record<number, "automatic" | "manual">>({});
  const [decoyAddresses, setDecoyAddresses] = useState<Record<number, string>>({});
  const [geocodingSanctuary, setGeocodingSanctuary] = useState<number | null>(null);

  const powerUpsQuery = trpc.powerUp.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const reconQuery = trpc.player.reconTarget.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated, refetchOnMount: true }
  );
  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const playersQuery = trpc.player.list.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const inventoryQuery = trpc.powerUp.inventory.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const purchaseMutation = trpc.powerUp.purchase.useMutation({
    onSuccess: () => {
      playerQuery.refetch();
      inventoryQuery.refetch();
      Alert.alert("Purchased!", "The power-up is in your inventory. Its timer starts only when you activate it.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const activateMutation = trpc.powerUp.activate.useMutation({
    onSuccess: async (_result, variables) => {
      const activatedName = inventoryQuery.data?.find(item => item.id === variables.inventoryId)?.powerUp?.name;
      inventoryQuery.refetch();
      playerQuery.refetch();
      playersQuery.refetch();
      const reconResult = await reconQuery.refetch();
      if (activatedName === "Recon" && reconResult.data) {
        const report = reconResult.data;
        const powerUps = report.activePowerUps.length
          ? report.activePowerUps.map((p: any) => `${p.emoji || "⚡"} ${p.name || "Power-up"} (${p.status === "inventory" ? "unused" : p.status === "pending_payment" ? "awaiting fee" : p.status})`).join("\n")
          : "No active or unused power-ups.";
        Alert.alert(`Recon: ${report.targetName}`, `Points: ${report.points}\n\nActive & unused power-ups:\n${powerUps}`);
        return;
      }
      Alert.alert("Activated!", "The power-up is now in effect. Any cash fee was added to the admin's collection queue.");
    },
    onError: (err) => Alert.alert("Unable to activate", err.message),
  });

  const powerUps = powerUpsQuery.data || [];
  const player = playerQuery.data;
  const inventory = inventoryQuery.data || [];
  const usageCountByPowerUpId = inventory.reduce<Record<number, number>>((counts, item) => {
    counts[item.powerUpId] = (counts[item.powerUpId] || 0) + 1;
    return counts;
  }, {});
  const players = (playersQuery.data || []).filter(p => p.id !== player?.id && p.status === "alive");
  const eliminatedPlayers = (playersQuery.data || []).filter(p => p.id !== player?.id && p.status === "eliminated");

  const filteredPowerUps = selectedCategory === "all"
    ? powerUps.filter(p => p.isEnabled && p.name !== "Roulette")
    : powerUps.filter(p => p.isEnabled && p.name !== "Roulette" && p.category === selectedCategory);

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

  const handleActivate = async (item: any) => {
    const targetPlayerId = selectedTargets[item.id];
    if (TARGETED_POWER_UPS.has(item.powerUp?.name) && !targetPlayerId) {
      Alert.alert("Choose a target", "Select a player before activating this power-up.");
      return;
    }
    const giftInventoryId = selectedGifts[item.id];
    if (item.powerUp?.name === "Care Package" && !giftInventoryId) {
      Alert.alert("Choose a gift", "Select another unused inventory item to give away.");
      return;
    }
    if (item.powerUp?.name === "Sniper's Duel" && !giftInventoryId) {
      Alert.alert("Choose your stake", "Select an unused power-up to stake in the duel.");
      return;
    }
    const safeObject = safeObjects[item.id]?.trim();
    if (item.powerUp?.name === "Monkey Wrench" && !safeObject) {
      Alert.alert("Enter a safe object", "Choose the replacement safe object before activating.");
      return;
    }
    let sanctuaryCoords: { zoneLatitude: string; zoneLongitude: string } | undefined;
    if (item.powerUp?.name === "Sanctuary") {
      const address = sanctuaryAddresses[item.id]?.trim();
      if (address) {
        setGeocodingSanctuary(item.id);
        try {
          const results = await Location.geocodeAsync(address);
          if (!results.length) {
            Alert.alert("Address not found", "Couldn't find that address. Try being more specific, or leave it blank to use your current location.");
            return;
          }
          sanctuaryCoords = { zoneLatitude: results[0].latitude.toFixed(6), zoneLongitude: results[0].longitude.toFixed(6) };
        } catch {
          Alert.alert("Search failed", "Couldn't look up that address right now.");
          return;
        } finally {
          setGeocodingSanctuary(null);
        }
      }
    }
    let decoyData: Record<string, unknown> | undefined;
    if (item.powerUp?.name === "Decoy") {
      const mode = decoyModes[item.id] || "automatic";
      if (mode === "manual") {
        const address = decoyAddresses[item.id]?.trim();
        if (!address) { Alert.alert("Enter your location", "Manual Decoy needs the address where you will be."); return; }
        try {
          const results = await Location.geocodeAsync(address);
          if (!results.length) { Alert.alert("Address not found", "Try a more specific address."); return; }
          decoyData = { mode, address, anchorLatitude: results[0].latitude, anchorLongitude: results[0].longitude };
        } catch { Alert.alert("Search failed", "Couldn't locate that address."); return; }
      } else decoyData = { mode };
    }
    const activationData = {
      ...(giftInventoryId ? { giftInventoryId } : {}),
      ...(safeObject ? { safeObject } : {}),
      ...(sanctuaryCoords || {}),
      ...(item.powerUp?.name === "Sanctuary" && sanctuaryAddresses[item.id]?.trim() ? { address: sanctuaryAddresses[item.id].trim() } : {}),
      ...(item.powerUp?.name === "Sniper's Duel" && giftInventoryId ? { challengerStakeId: giftInventoryId } : {}),
      ...(decoyData || {}),
    };
    const activateLabel = item.powerUp?.name === "Sanctuary" ? "Send this Sanctuary to the admin for approval?" : `Activate ${item.powerUp?.name} now? Its timer begins immediately.`;
    Alert.alert("Activate Power-Up", activateLabel, [
      { text: "Cancel", style: "cancel" },
      { text: "Activate", onPress: () => activateMutation.mutate({ gameId: activeGameId!, inventoryId: item.id, targetPlayerId, activationData: Object.keys(activationData).length ? activationData : undefined }) },
    ]);
  };

  if (!activeGameId || !isAuthenticated) {
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

  const roulettePowerUp = powerUps.find(powerUp => powerUp.name === "Roulette" && powerUp.isEnabled);
  const rouletteCost = roulettePowerUp ? 50 : null;
  const pendingDiscountPercent = (player as any)?.pendingDiscountPercent as number | null | undefined;

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
              <Text className="text-muted text-xs">{rouletteCost != null ? `${rouletteCost} pts per spin` : "Roulette unavailable"} — win prizes or face penalties</Text>
            </View>
          </View>
          <Text className="text-primary font-bold">→</Text>
        </TouchableOpacity>

        {/* Active discount coupon banner */}
        {pendingDiscountPercent != null && (
          <View className="bg-warning/20 border border-warning rounded-xl p-3 mb-4 flex-row items-center gap-2">
            <Text style={{ fontSize: 20 }}>🎟️</Text>
            <Text className="text-warning font-semibold text-sm flex-1">
              You have a {pendingDiscountPercent}% discount coupon — it'll auto-apply to your next purchase below.
            </Text>
          </View>
        )}

        {/* Recon is a one-use snapshot saved until the current round ends. */}
        {reconQuery.data && (
          <View className="bg-primary/10 border border-primary rounded-xl p-3 mb-4">
            <Text className="text-primary font-bold text-sm mb-1">🔍 Recon: {reconQuery.data.targetName}</Text>
            <Text className="text-foreground text-sm">Balance: {reconQuery.data.points} pts</Text>
            {reconQuery.data.activePowerUps.length > 0 ? (
              <Text className="text-muted text-xs mt-1">
                Active & unused power-ups: {reconQuery.data.activePowerUps.map((p: any) => `${p.emoji || "⚡"} ${p.name || "Power-up"} (${p.status === "inventory" ? "unused" : p.status === "pending_payment" ? "awaiting fee" : p.status})`).join(", ")}
              </Text>
            ) : (
              <Text className="text-muted text-xs mt-1">No active or unused power-ups.</Text>
            )}
          </View>
        )}

        {/* Player inventory: purchases remain here until activated. */}
        <View className="mb-5">
          <Text className="text-xl font-bold text-foreground mb-2">My Power-Up Inventory</Text>
          {inventory.filter((item: any) => ["inventory", "pending_payment", "active"].includes(item.status)).length === 0 ? (
            <View className="bg-surface rounded-xl p-4 border border-border">
              <Text className="text-muted text-sm">Purchased power-ups will appear here.</Text>
            </View>
          ) : inventory.filter((item: any) => ["inventory", "pending_payment", "active"].includes(item.status)).map((item: any) => {
            const needsTarget = TARGETED_POWER_UPS.has(item.powerUp?.name);
            return (
              <View key={item.id} className="bg-surface rounded-xl p-4 border border-border mb-2">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text className="text-foreground font-bold">{item.powerUp?.emoji} {item.powerUp?.name}</Text>
                    <Text className="text-muted text-xs">
                      {item.status === "active" ? "Active" : item.status === "pending_payment" ? "Waiting for fee approval" : "Ready to activate"}
                    </Text>
                    {(item.powerUp?.usageFeeCents || 0) > 0 && (
                      <Text className="text-primary text-xs">Use fee: ${(item.powerUp.usageFeeCents / 100).toFixed(2)}</Text>
                    )}
                  </View>
                  {item.status !== "active" && (
                    <TouchableOpacity className="bg-primary px-4 py-2 rounded-lg" onPress={() => handleActivate(item)}>
                      <Text className="text-background font-bold">Activate</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {needsTarget && item.status !== "active" && item.powerUp?.name === "Lifeline" && eliminatedPlayers.length === 0 && (
                  <Text className="text-muted text-xs mt-3">No eliminated players to revive right now.</Text>
                )}
                {needsTarget && item.status !== "active" && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
                    <View className="flex-row gap-2">
                      {(item.powerUp?.name === "Lifeline" ? eliminatedPlayers : players).map((candidate: any) => (
                        <TouchableOpacity
                          key={candidate.id}
                          className={`px-3 py-2 rounded-lg ${selectedTargets[item.id] === candidate.id ? "bg-primary" : "bg-background border border-border"}`}
                          onPress={() => setSelectedTargets(current => ({ ...current, [item.id]: candidate.id }))}
                        >
                          <Text className={selectedTargets[item.id] === candidate.id ? "text-background font-bold" : "text-foreground"}>
                            {candidate.user?.displayName || candidate.user?.name || `Player ${candidate.id}`} {(candidate as any).protectionBadge ? `🛡️ ${(candidate as any).protectionBadge.label}` : ""}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
                {item.powerUp?.name === "Care Package" && item.status !== "active" && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
                    <View className="flex-row gap-2">
                      {inventory.filter((gift: any) => gift.id !== item.id && gift.status === "inventory").map((gift: any) => (
                        <TouchableOpacity
                          key={gift.id}
                          className={`px-3 py-2 rounded-lg ${selectedGifts[item.id] === gift.id ? "bg-primary" : "bg-background border border-border"}`}
                          onPress={() => setSelectedGifts(current => ({ ...current, [item.id]: gift.id }))}
                        >
                          <Text className={selectedGifts[item.id] === gift.id ? "text-background font-bold" : "text-foreground"}>
                            Gift: {gift.powerUp?.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
                {item.powerUp?.name === "Sniper's Duel" && item.status !== "active" && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3"><View className="flex-row gap-2">{inventory.filter((stake: any) => stake.id !== item.id && stake.status === "inventory" && !stake.lockedForDuelId).map((stake: any) => <TouchableOpacity key={stake.id} className={`px-3 py-2 rounded-lg ${selectedGifts[item.id] === stake.id ? "bg-primary" : "bg-background border border-border"}`} onPress={() => setSelectedGifts(current => ({ ...current, [item.id]: stake.id }))}><Text className={selectedGifts[item.id] === stake.id ? "text-background font-bold" : "text-foreground"}>Stake: {stake.powerUp?.name} ({stake.powerUp?.cost || 0})</Text></TouchableOpacity>)}</View></ScrollView>
                )}
                {item.powerUp?.name === "Decoy" && item.status !== "active" && (
                  <View className="mt-3"><View className="flex-row gap-2 mb-2"><TouchableOpacity className={`px-3 py-2 rounded-lg ${(decoyModes[item.id] || "automatic") === "automatic" ? "bg-primary" : "bg-background border border-border"}`} onPress={() => setDecoyModes(current => ({ ...current, [item.id]: "automatic" }))}><Text className="text-foreground">Automatic (current GPS)</Text></TouchableOpacity><TouchableOpacity className={`px-3 py-2 rounded-lg ${decoyModes[item.id] === "manual" ? "bg-primary" : "bg-background border border-border"}`} onPress={() => setDecoyModes(current => ({ ...current, [item.id]: "manual" }))}><Text className="text-foreground">Manual address</Text></TouchableOpacity></View>{decoyModes[item.id] === "manual" && <TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Address where you will be" placeholderTextColor="#8B8B9E" value={decoyAddresses[item.id] || ""} onChangeText={value => setDecoyAddresses(current => ({ ...current, [item.id]: value }))}/>}<Text className="text-muted text-xs mt-1">The displayed decoy is placed exactly five miles from the anchor.</Text></View>
                )}
                {item.powerUp?.name === "Monkey Wrench" && item.status !== "active" && (
                  <TextInput
                    className="bg-background border border-border rounded-lg px-3 py-2 text-foreground mt-3"
                    placeholder="New safe object"
                    placeholderTextColor="#8B8B9E"
                    value={safeObjects[item.id] || ""}
                    onChangeText={value => setSafeObjects(current => ({ ...current, [item.id]: value }))}
                  />
                )}
                {item.powerUp?.name === "Sanctuary" && item.status !== "active" && (
                  <View className="mt-3">
                    <Text className="text-muted text-xs mb-1">Type an address for your sanctuary, or leave blank to use your current location. Admin must approve before it shows on the map.</Text>
                    <TextInput
                      className="bg-background border border-border rounded-lg px-3 py-2 text-foreground"
                      placeholder="e.g. 123 Main St, Houston TX"
                      placeholderTextColor="#8B8B9E"
                      value={sanctuaryAddresses[item.id] || ""}
                      onChangeText={value => setSanctuaryAddresses(current => ({ ...current, [item.id]: value }))}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>

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
        {filteredPowerUps.length === 0 ? (
          <View className="bg-surface rounded-xl p-8 items-center border border-border">
            <Text className="text-muted text-center">No power-ups available in this category</Text>
          </View>
        ) : (
          <View className="gap-3">
            {filteredPowerUps.map((pu) => {
              const adminDiscountedCost = pu.discount ? Math.floor(pu.cost * (1 - (pu.discount || 0) / 100)) : pu.cost;
              const discountedCost = pendingDiscountPercent != null
                ? Math.floor(adminDiscountedCost * (1 - pendingDiscountPercent / 100))
                : adminDiscountedCost;
              const canAfford = (player?.points || 0) - ((player as any)?.reservedPoints || 0) >= discountedCost;
              const usageCount = usageCountByPowerUpId[pu.id] || 0;
              const maxUsesPerGame = pu.maxUsesPerGame;
              const hasReachedUsageLimit = maxUsesPerGame != null && usageCount >= maxUsesPerGame;
              const canPurchase = canAfford && !hasReachedUsageLimit;

              return (
                <View key={pu.id} className="bg-surface rounded-xl p-4 border border-border">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2 mb-1">
                        <Text className="text-2xl">{pu.emoji}</Text>
                        <Text className="text-foreground font-bold text-base">{pu.name}</Text>
                      </View>
                      <Text className="text-muted text-sm">{pu.effect}</Text>
                      {maxUsesPerGame != null && (
                        <Text className="text-primary text-xs mt-1">{usageCount}/{maxUsesPerGame} used this game</Text>
                      )}
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
                      {discountedCost < pu.cost ? (
                        <View>
                          <Text className="text-muted text-xs line-through">{pu.cost} pts</Text>
                          <Text className="text-success font-bold">{discountedCost} pts</Text>
                          {pendingDiscountPercent != null && (
                            <Text className="text-warning text-xs">🎟️ coupon applied</Text>
                          )}
                        </View>
                      ) : (
                        <Text className="text-foreground font-bold">{pu.cost} pts</Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    className={`mt-3 py-2 rounded-lg items-center ${canPurchase ? "bg-primary" : "bg-surface border border-muted"}`}
                    onPress={() => canPurchase && handlePurchase(pu.id, pu.name, discountedCost)}
                    disabled={!canPurchase}
                  >
                    <Text className={`font-bold text-sm ${canPurchase ? "text-background" : "text-muted"}`}>
                      {hasReachedUsageLimit ? "Maximum Used" : canAfford ? "Purchase" : "Not Enough Points"}
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
