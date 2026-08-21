import { Text, View, ScrollView, TouchableOpacity, Alert, TextInput, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { requestConfirmedAction } from "@/lib/confirm-then-run";
import { useRef, useState } from "react";
import { searchAddress, GEOCODING_ATTRIBUTION } from "@/lib/geocoding";
import { playerLabel } from "@/lib/player-label";

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
  const utils = trpc.useUtils();

  // Purchase guard: a single, global lock (not per-item) -- rapid clicks
  // on the same button, or on a different catalog item while one
  // purchase is already in flight, must not fire a second mutation. A
  // ref (not just the state below) so the check is synchronous, seeing
  // the up-to-date value even before a re-render lands.
  const isPurchasingRef = useRef(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchasingPowerUpId, setPurchasingPowerUpId] = useState<number | null>(null);
  const setPurchasing = (purchasing: boolean) => {
    isPurchasingRef.current = purchasing;
    setIsPurchasing(purchasing);
  };
  const [purchaseMessage, setPurchaseMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Activation guard: same shape, entirely separate from the purchase
  // guard above -- activating one inventory item must not be blocked by
  // (or block) an in-flight purchase, and vice versa.
  const isActivatingRef = useRef(false);
  const [isActivating, setIsActivating] = useState(false);
  const [activatingItemId, setActivatingItemId] = useState<number | null>(null);
  const setActivating = (activating: boolean) => {
    isActivatingRef.current = activating;
    setIsActivating(activating);
  };
  const [activationMessage, setActivationMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  // Per-item validation errors (target/gift/stake/address/safe-object) --
  // keyed by inventory item id so each item's own inline message doesn't
  // clobber another item's.
  const [itemErrors, setItemErrors] = useState<Record<number, string>>({});
  const setItemError = (itemId: number, message: string | null) => {
    setItemErrors((current) => {
      const next = { ...current };
      if (message) next[itemId] = message;
      else delete next[itemId];
      return next;
    });
  };

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
    onSuccess: (data) => {
      // A purchase can immediately trigger an achievement (and its points)
      // server-side, so the player's own balance/badge views need to be
      // invalidated alongside the inventory, not just powerUp.inventory.
      utils.player.me.invalidate({ gameId: activeGameId! });
      utils.player.list.invalidate({ gameId: activeGameId! });
      utils.game.leaderboard.invalidate({ gameId: activeGameId! });
      utils.achievement.playerList.invalidate({ gameId: activeGameId! });
      utils.powerUp.inventory.invalidate({ gameId: activeGameId! });
      setPurchaseMessage({ kind: "success", text: `Purchased for ${data.cost} pts. It's in your inventory -- activate it when ready.` });
    },
    onError: (err) => {
      setPurchaseMessage({ kind: "error", text: err.message });
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- the inline message above is what actually drives the
      // UI on every platform.
      if (Platform.OS !== "web") Alert.alert("Error", err.message);
    },
  });
  const activateMutation = trpc.powerUp.activate.useMutation({
    onSuccess: () => {
      // Recon's own report is the persistent "🔍 Recon: ..." banner
      // rendered below from reconQuery.data -- invalidating it here makes
      // that banner show the fresh report on its own, reactively, with no
      // Alert (and no special-casing by power-up name) required.
      utils.powerUp.inventory.invalidate({ gameId: activeGameId! });
      utils.player.me.invalidate({ gameId: activeGameId! });
      utils.player.list.invalidate({ gameId: activeGameId! });
      utils.player.reconTarget.invalidate({ gameId: activeGameId! });
      // Activation can also immediately trigger an achievement server-side.
      utils.game.leaderboard.invalidate({ gameId: activeGameId! });
      utils.achievement.playerList.invalidate({ gameId: activeGameId! });
      setActivationMessage({ kind: "success", text: "Activated! Any cash fee was added to the admin's collection queue." });
    },
    onError: (err) => {
      setActivationMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Unable to activate", err.message);
    },
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
    setPurchaseMessage(null);
    setPurchasingPowerUpId(powerUpId);
    requestConfirmedAction({
      title: "Purchase Power-Up",
      message: `Buy ${name} for ${cost} points?`,
      confirmLabel: "Buy",
      isRunning: isPurchasingRef.current,
      onRunningChange: setPurchasing,
      run: () => purchaseMutation.mutateAsync({ gameId: activeGameId!, powerUpId }),
    });
  };

  const handleActivate = async (item: any) => {
    // Blocks re-entry for the whole rest of this function, including the
    // async geocoding below -- a second tap landing before any dialog
    // even exists yet must not start a second, parallel attempt.
    if (isActivatingRef.current) return;
    setItemError(item.id, null);
    setActivationMessage(null);

    const targetPlayerId = selectedTargets[item.id];
    if (TARGETED_POWER_UPS.has(item.powerUp?.name) && !targetPlayerId) {
      setItemError(item.id, "Select a player before activating this power-up.");
      return;
    }
    const giftInventoryId = selectedGifts[item.id];
    if (item.powerUp?.name === "Care Package" && !giftInventoryId) {
      setItemError(item.id, "Select another unused inventory item to give away.");
      return;
    }
    if (item.powerUp?.name === "Sniper's Duel" && !giftInventoryId) {
      setItemError(item.id, "Select an unused power-up to stake in the duel.");
      return;
    }
    const safeObject = safeObjects[item.id]?.trim();
    if (item.powerUp?.name === "Monkey Wrench" && !safeObject) {
      setItemError(item.id, "Choose the replacement safe object before activating.");
      return;
    }

    // Past this point we're either geocoding or about to show the
    // confirmation dialog -- lock now.
    setActivating(true);
    setActivatingItemId(item.id);

    let sanctuaryCoords: { zoneLatitude: string; zoneLongitude: string } | undefined;
    if (item.powerUp?.name === "Sanctuary") {
      const address = sanctuaryAddresses[item.id]?.trim();
      if (address) {
        setGeocodingSanctuary(item.id);
        try {
          const { latitude, longitude } = await searchAddress(utils, address);
          sanctuaryCoords = { zoneLatitude: latitude.toFixed(6), zoneLongitude: longitude.toFixed(6) };
        } catch (err) {
          setItemError(item.id, err instanceof Error ? err.message : "Couldn't look up that address right now.");
          setActivating(false);
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
        if (!address) { setItemError(item.id, "Manual Decoy needs the address where you will be."); setActivating(false); return; }
        try {
          const { latitude, longitude } = await searchAddress(utils, address);
          decoyData = { mode, address, anchorLatitude: latitude, anchorLongitude: longitude };
        } catch (err) {
          setItemError(item.id, err instanceof Error ? err.message : "Couldn't locate that address.");
          setActivating(false);
          return;
        }
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
    requestConfirmedAction({
      title: "Activate Power-Up",
      message: activateLabel,
      confirmLabel: "Activate",
      isRunning: false, // already locked above; this call always proceeds to the dialog
      onRunningChange: setActivating,
      run: () => activateMutation.mutateAsync({ gameId: activeGameId!, inventoryId: item.id, targetPlayerId, activationData: Object.keys(activationData).length ? activationData : undefined }),
    });
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

        {activationMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${activationMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${activationMessage.kind === "success" ? "text-success" : "text-error"}`}>{activationMessage.text}</Text>
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
                    <TouchableOpacity
                      className={`px-4 py-2 rounded-lg ${isActivating ? "bg-primary/50" : "bg-primary"}`}
                      onPress={() => handleActivate(item)}
                      disabled={isActivating}
                    >
                      <Text className="text-background font-bold">
                        {isActivating && activatingItemId === item.id ? "Activating..." : "Activate"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {itemErrors[item.id] && (
                  <Text className="text-error text-xs mt-2">{itemErrors[item.id]}</Text>
                )}
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
                            {playerLabel(candidate)} {(candidate as any).protectionBadge ? `🛡️ ${(candidate as any).protectionBadge.label}` : ""}
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
                  <View className="mt-3"><View className="flex-row gap-2 mb-2"><TouchableOpacity className={`px-3 py-2 rounded-lg ${(decoyModes[item.id] || "automatic") === "automatic" ? "bg-primary" : "bg-background border border-border"}`} onPress={() => setDecoyModes(current => ({ ...current, [item.id]: "automatic" }))}><Text className="text-foreground">Automatic (current GPS)</Text></TouchableOpacity><TouchableOpacity className={`px-3 py-2 rounded-lg ${decoyModes[item.id] === "manual" ? "bg-primary" : "bg-background border border-border"}`} onPress={() => setDecoyModes(current => ({ ...current, [item.id]: "manual" }))}><Text className="text-foreground">Manual address</Text></TouchableOpacity></View>{decoyModes[item.id] === "manual" && <><TextInput className="bg-background border border-border rounded-lg px-3 py-2 text-foreground" placeholder="Address where you will be" placeholderTextColor="#8B8B9E" value={decoyAddresses[item.id] || ""} onChangeText={value => setDecoyAddresses(current => ({ ...current, [item.id]: value }))}/><Text className="text-muted text-xs mt-1">{GEOCODING_ATTRIBUTION}</Text></>}<Text className="text-muted text-xs mt-1">The displayed decoy is placed exactly five miles from the anchor.</Text></View>
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
                    <Text className="text-muted text-xs mt-1">{GEOCODING_ATTRIBUTION}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {purchaseMessage && (
          <View className={`rounded-xl p-3 mb-4 border ${purchaseMessage.kind === "success" ? "bg-success/20 border-success" : "bg-error/20 border-error"}`}>
            <Text className={`text-sm text-center ${purchaseMessage.kind === "success" ? "text-success" : "text-error"}`}>{purchaseMessage.text}</Text>
          </View>
        )}

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
              const canPurchase = canAfford && !hasReachedUsageLimit && !isPurchasing;

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
                      {isPurchasing && purchasingPowerUpId === pu.id
                        ? "Purchasing..."
                        : hasReachedUsageLimit ? "Maximum Used" : canAfford ? "Purchase" : "Not Enough Points"}
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
