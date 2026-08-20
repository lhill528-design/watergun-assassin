import {
  Text, View, ScrollView, TouchableOpacity, Alert, Platform,
  Modal, TextInput, ActivityIndicator, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, useRef } from "react";
import { GameMap } from "@/components/game-map";
import {
  requestLocationPermissions,
  getCurrentLocation,
  startForegroundTracking,
  stopBackgroundLocationTracking,
} from "@/lib/location-service";
import type { LocationSubscription } from "expo-location";
import * as Haptics from "expo-haptics";
import { searchAddress, GEOCODING_ATTRIBUTION } from "@/lib/geocoding";

interface PlayerPin {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  type: "self" | "target" | "safe" | "player" | "purge_player" | "powerup";
}

interface GuessModalState {
  visible: boolean;
  mapPowerUpId: number | null;
  clue: string;
  guessLat: string;
  guessLon: string;
  result: { correct: boolean; message: string; revealedLatitude?: string; revealedLongitude?: string } | null;
}

export default function MapScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const locationSubRef = useRef<LocationSubscription | null>(null);
  const prevProximityRef = useRef<Record<number, number>>({});

  const [guessModal, setGuessModal] = useState<GuessModalState>({
    visible: false, mapPowerUpId: null, clue: "", guessLat: "", guessLon: "", result: null,
  });
  const [addressQuery, setAddressQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  // The most recently checked target's effective (visibility-safe)
  // coordinate -- upserted by player id so re-checking the same player
  // updates the pin in place instead of adding a duplicate, and used to
  // focus the map on it.
  const [checkedTargetPin, setCheckedTargetPin] = useState<{ id: number; label: string; latitude: number; longitude: number } | null>(null);
  const [locationCheckMessage, setLocationCheckMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const utils = trpc.useUtils();
  const [addressError, setAddressError] = useState<string | null>(null);

  const handleGeocodeAddress = async () => {
    if (!addressQuery.trim()) return;
    setAddressError(null);
    setGeocoding(true);
    try {
      const { latitude, longitude } = await searchAddress(utils, addressQuery.trim());
      setGuessModal(g => ({ ...g, guessLat: latitude.toFixed(6), guessLon: longitude.toFixed(6) }));
    } catch (err) {
      // Inline, not Alert.alert -- unreliable on web, which is exactly
      // where address search is needed most (no native geocoding there).
      setAddressError(err instanceof Error ? err.message : "Couldn't look up that address right now.");
    } finally {
      setGeocoding(false);
    }
  };

  const gameId = activeGameId ?? 0;

  const gameQuery = trpc.game.get.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );
  const playersQuery = trpc.player.list.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );
  const playerMeQuery = trpc.player.me.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );
  const mapPowerUpsQuery = trpc.mapPowerUp.list.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated, refetchInterval: 15000, refetchOnWindowFocus: true }
  );
  const vendettaTargetQuery = trpc.player.vendettaTarget.useQuery(
    { gameId },
    { enabled: gameId > 0 && isAuthenticated }
  );

  // Proximity check — only runs when we have a location
  const proximityQuery = trpc.mapPowerUp.checkProximity.useQuery(
    {
      gameId,
      latitude: myLocation?.latitude ?? 0,
      longitude: myLocation?.longitude ?? 0,
    },
    {
      enabled: gameId > 0 && isAuthenticated && !!myLocation,
      refetchInterval: 15000, // Re-check every 15 seconds
    }
  );

  const game = gameQuery.data;
  const players = playersQuery.data || [];
  const myPlayer = playerMeQuery.data;
  const mapPowerUps = mapPowerUpsQuery.data || [];
  const proximityData = proximityQuery.data || [];
  const vendettaTarget = vendettaTargetQuery.data || null;

  const updateLocationMutation = trpc.player.updateLocation.useMutation();
  const disableLocationMutation = trpc.player.disableLocation.useMutation({
    onSuccess: () => {
      setLocationEnabled(false);
      Alert.alert("Location Disabled", "Admin has been notified.");
    },
  });
  const checkLocationMutation = trpc.player.checkLocation.useMutation({
    onSuccess: (data, variables) => {
      const name = resolvePlayerLabelById(variables.targetPlayerId);
      const latitude = parseFloat(data.latitude);
      const longitude = parseFloat(data.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        // Upserted by id in buildPins()'s merge below -- a repeat check
        // moves the existing pin, it never adds a duplicate.
        setCheckedTargetPin({ id: variables.targetPlayerId, label: name, latitude, longitude });
      }
      setLocationCheckMessage({ kind: "success", text: `📍 ${name}: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — now focused on the map above.` });
      // Supplemental only on native, where Alert.alert's callbacks are
      // reliable -- the inline message above is what actually drives the
      // UI on every platform, including web.
      if (Platform.OS !== "web") {
        Alert.alert(`📍 ${name}`, `Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      }
    },
    onError: (err) => {
      setLocationCheckMessage({ kind: "error", text: err.message });
      if (Platform.OS !== "web") Alert.alert("Can't Check Location", err.message);
    },
  });
  const claimMutation = trpc.mapPowerUp.claim.useMutation({
    onSuccess: () => {
      Alert.alert("Collected!", "The power-up has been added to your inventory.");
      mapPowerUpsQuery.refetch();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err) => Alert.alert("Can't Collect", err.message),
  });
  const submitGuessMutation = trpc.mapPowerUp.submitGuess.useMutation({
    onSuccess: (data) => {
      setGuessModal(g => ({ ...g, result: data }));
      if (data.correct) mapPowerUpsQuery.refetch();
      if (data.correct && Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  // Alert when entering 150-yard radius of a hidden power-up
  useEffect(() => {
    if (!proximityData.length || Platform.OS === "web") return;
    proximityData.forEach((item) => {
      const wasWithin = prevProximityRef.current[item.id] !== undefined
        ? prevProximityRef.current[item.id] <= 137
        : false;
      if (item.isWithin150Yards && !wasWithin) {
        // Just entered 150-yard radius
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "🔥 Power-Up Nearby!",
          `You're within 150 yards of a hidden power-up!\n\nClue: "${item.clue || "No clue"}"\n\nDistance: ~${item.distanceYards} yards`,
          [
            { text: "Dismiss" },
            {
              text: "Guess Location",
              onPress: () => setGuessModal({
                visible: true,
                mapPowerUpId: item.id,
                clue: item.clue || "",
                guessLat: myLocation ? myLocation.latitude.toFixed(6) : "",
                guessLon: myLocation ? myLocation.longitude.toFixed(6) : "",
                result: null,
              }),
            },
          ]
        );
      }
      prevProximityRef.current[item.id] = item.distanceMeters;
    });
  }, [proximityData]);

  // Start foreground location tracking when screen is active
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!activeGameId || !isAuthenticated || !locationEnabled) return;

    let mounted = true;

    const startTracking = async () => {
      const granted = await requestLocationPermissions();
      if (!granted || !mounted) return;

      const initial = await getCurrentLocation();
      if (initial && mounted) {
        setMyLocation({ latitude: initial.coords.latitude, longitude: initial.coords.longitude });
        updateLocationMutation.mutate({
          gameId: activeGameId,
          latitude: initial.coords.latitude.toString(),
          longitude: initial.coords.longitude.toString(),
        });
      }

      const sub = await startForegroundTracking((loc) => {
        if (!mounted) return;
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setMyLocation(coords);
        updateLocationMutation.mutate({
          gameId: activeGameId,
          latitude: coords.latitude.toString(),
          longitude: coords.longitude.toString(),
        });
      });

      if (sub) locationSubRef.current = sub;
    };

    startTracking();

    return () => {
      mounted = false;
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, [activeGameId, isAuthenticated, locationEnabled]);

  const distanceMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const R = 6371000;
    const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
    const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
    const lat1 = (a.latitude * Math.PI) / 180;
    const lat2 = (b.latitude * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const visibleUnclaimedPowerUps = mapPowerUps.filter(mp => (mp.isVisible || (mp as any).discovered) && !mp.claimedBy && mp.latitude && mp.longitude);
  const safeZones = players
    .map(p => (p as any).sanctuaryZone as { latitude: string; longitude: string; radiusMeters: number; approved?: boolean } | null | undefined)
    .filter((zone): zone is { latitude: string; longitude: string; radiusMeters: number; approved?: boolean } => !!zone && zone.approved !== false)
    .map(zone => ({ latitude: parseFloat(zone.latitude), longitude: parseFloat(zone.longitude), radiusMeters: zone.radiusMeters, label: "Sanctuary Safe Zone" }));
  const COLLECT_RADIUS_METERS = 50;

  const resolvePlayerLabel = (player: (typeof players)[number]) => {
    const playerWithDisplayName = player as typeof player & {
      displayName?: string | null;
      user?: (NonNullable<typeof player.user> & { displayName?: string | null }) | null;
    };
    const displayName = playerWithDisplayName.displayName?.trim()
      || playerWithDisplayName.user?.displayName?.trim();
    const accountName = playerWithDisplayName.user?.name?.trim();
    return displayName || accountName || `Player #${player.userId}`;
  };

  const resolvePlayerLabelById = (playerId: number) => {
    const found = players.find(p => p.id === playerId);
    return found ? resolvePlayerLabel(found) : "Player";
  };

  const buildPins = (): PlayerPin[] => {
    const pins: PlayerPin[] = [];
    const purgeActive = Boolean(game?.purgeActive && game?.showLocationsDuringPurge);

    if (purgeActive) {
      players
        .filter(p => (
          p.id !== myPlayer?.id
          && (p.status === "alive" || p.status === "safe")
          && p.latitude
          && p.longitude
        ))
        .forEach(p => {
          const type: PlayerPin["type"] = p.status === "safe"
            ? "safe"
            : p.id === myPlayer?.targetId || p.id === vendettaTarget?.id
              ? "target"
              : "purge_player";
          pins.push({
            id: p.id,
            label: resolvePlayerLabel(p),
            latitude: parseFloat(p.latitude!),
            longitude: parseFloat(p.longitude!),
            type,
          });
        });
    } else {
      if (myPlayer?.targetId) {
        const target = players.find(p => p.id === myPlayer.targetId);
        if (target?.latitude && target?.longitude) {
          const type: PlayerPin["type"] = target.status === "safe" ? "safe" : "target";
          pins.push({
            id: target.id,
            label: resolvePlayerLabel(target),
            latitude: parseFloat(target.latitude),
            longitude: parseFloat(target.longitude),
            type,
          });
        }
      }
      if (vendettaTarget && vendettaTarget.id !== myPlayer?.targetId) {
        const target = players.find(p => p.id === vendettaTarget.id);
        pins.push({
          id: vendettaTarget.id,
          label: target ? resolvePlayerLabel(target) : `Player #${vendettaTarget.userId}`,
          latitude: parseFloat(vendettaTarget.latitude),
          longitude: parseFloat(vendettaTarget.longitude),
          type: vendettaTarget.status === "safe" ? "safe" : "target",
        });
      }
    }

    mapPowerUps.filter(mp => !mp.claimedBy && (mp.isVisible || (mp as any).discovered) && mp.latitude && mp.longitude).forEach(mp => {
      pins.push({
        id: mp.id, label: "Power-Up",
        latitude: Number(mp.latitude), longitude: Number(mp.longitude),
        type: "powerup",
      });
    });

    return pins;
  };

  if (!activeGameId || !isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center">
          <Text className="text-2xl mb-2">🗺️</Text>
          <Text className="text-foreground text-lg font-bold">No Active Game</Text>
          <Text className="text-muted text-sm mt-1">Join a game to see the map</Text>
        </View>
      </ScreenContainer>
    );
  }

  const pins = buildPins();
  if (checkedTargetPin) {
    const existingIndex = pins.findIndex(p => p.id === checkedTargetPin.id);
    const pin: PlayerPin = { id: checkedTargetPin.id, label: checkedTargetPin.label, latitude: checkedTargetPin.latitude, longitude: checkedTargetPin.longitude, type: "target" };
    if (existingIndex >= 0) pins[existingIndex] = pin;
    else pins.push(pin);
  }
  const purgeActive = game?.purgeActive ?? false;
  const hiddenPowerUps = mapPowerUps.filter(mp => !mp.claimedBy && !mp.isVisible && !(mp as any).discovered);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>🗺️ Game Map</Text>
            <Text style={styles.subtitle}>Track targets and find power-ups</Text>
          </View>
          <View style={styles.locationStatus}>
            <View style={[styles.dot, { backgroundColor: locationEnabled && myLocation ? "#00FF88" : "#FF3333" }]} />
            <Text style={styles.locationStatusText}>
              {Platform.OS === "web" ? "Web" : locationEnabled ? (myLocation ? "Live" : "Acquiring...") : "Off"}
            </Text>
          </View>
        </View>

        {/* Location toggle */}
        {Platform.OS !== "web" && (
          <View style={styles.locationBar}>
            <View>
              <Text style={styles.locationBarTitle}>
                {locationEnabled ? "📡 Location Active" : "📵 Location Disabled"}
              </Text>
              <Text style={styles.locationBarCoords}>
                {myLocation
                  ? `${myLocation.latitude.toFixed(4)}, ${myLocation.longitude.toFixed(4)}`
                  : "Acquiring GPS..."}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.locationToggleBtn, { backgroundColor: locationEnabled ? "#330011" : "#003311" }]}
              onPress={() => {
                if (locationEnabled) {
                  Alert.alert("Disable Location?", "Admin will be notified. This may result in penalties.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Disable", style: "destructive",
                      onPress: () => {
                        disableLocationMutation.mutate({ gameId: activeGameId! });
                        stopBackgroundLocationTracking();
                      }
                    },
                  ]);
                } else {
                  setLocationEnabled(true);
                }
              }}
            >
              <Text style={{ color: locationEnabled ? "#FF3333" : "#00FF88", fontSize: 12, fontWeight: "700" }}>
                {locationEnabled ? "Disable" : "Enable"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Warmer/Colder Proximity Panel */}
        {proximityData.length > 0 && (
          <View style={styles.proximityPanel}>
            <Text style={styles.proxTitle}>🔍 Hidden Power-Up Radar</Text>
            {proximityData.map((item) => (
              <View key={item.id} style={styles.proxItem}>
                <View style={{ flex: 1 }}>
                  <View style={styles.proxRow}>
                    <Text style={styles.proxEmoji}>{item.temperature.emoji}</Text>
                    <Text style={[styles.proxLabel, { color: item.temperature.color }]}>
                      {item.temperature.label}
                    </Text>
                    <Text style={styles.proxDist}>~{item.distanceYards} yds</Text>
                  </View>
                  {item.clue ? (
                    <Text style={styles.proxClue}>Clue: "{item.clue}"</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={styles.guessBtn}
                  onPress={() => setGuessModal({
                    visible: true,
                    mapPowerUpId: item.id,
                    clue: item.clue || "",
                    guessLat: myLocation ? myLocation.latitude.toFixed(6) : "",
                    guessLon: myLocation ? myLocation.longitude.toFixed(6) : "",
                    result: null,
                  })}
                >
                  <Text style={styles.guessBtnText}>Guess</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Map Component */}
        <View style={styles.mapContainer}>
          <GameMap
            myLocation={myLocation}
            pins={pins}
            purgeActive={purgeActive}
            zones={safeZones}
            focusLocation={checkedTargetPin ? { latitude: checkedTargetPin.latitude, longitude: checkedTargetPin.longitude } : null}
            onMapPress={guessModal.visible ? (coords: { latitude: number; longitude: number }) => {
              setGuessModal(g => ({ ...g, guessLat: coords.latitude.toFixed(6), guessLon: coords.longitude.toFixed(6) }));
              if (Platform.OS !== "web") Haptics.selectionAsync();
            } : undefined}
          />
          {guessModal.visible && (
            <Text style={styles.mapTapHint}>📍 Tap the map above to set your guess location</Text>
          )}
        </View>

        {/* Check Location result -- inline so it's visible on web, where
            Alert.alert is unreliable. */}
        {locationCheckMessage && (
          <View
            style={[
              styles.checkLocationMessage,
              { borderColor: locationCheckMessage.kind === "success" ? "#00FF88" : "#FF3333" },
            ]}
          >
            <Text style={[styles.checkLocationMessageText, { color: locationCheckMessage.kind === "success" ? "#00FF88" : "#FF3333" }]}>
              {locationCheckMessage.text}
            </Text>
          </View>
        )}

        {/* Visible Power-Ups on the map */}
        {visibleUnclaimedPowerUps.length > 0 && (
          <View style={styles.cluesSection}>
            <Text style={styles.cluesSectionTitle}>⚡ Power-Ups Ready to Collect</Text>
            {visibleUnclaimedPowerUps.map((mp) => {
              const dist = myLocation
                ? distanceMeters(myLocation, { latitude: parseFloat(mp.latitude!), longitude: parseFloat(mp.longitude!) })
                : null;
              const inRange = dist != null && dist <= COLLECT_RADIUS_METERS;
              return (
                <View key={mp.id} style={styles.clueCard}>
                  <Text style={styles.clueText}>
                    ⚡ {dist != null ? `~${Math.round(dist)}m away` : "Distance unknown — enable location"}
                  </Text>
                  <TouchableOpacity
                    style={[styles.guessBtn, !inRange && { opacity: 0.4 }]}
                    disabled={!inRange || claimMutation.isPending}
                    onPress={() => claimMutation.mutate({ gameId: activeGameId!, mapPowerUpId: mp.id })}
                  >
                    <Text style={styles.guessBtnText}>{inRange ? "Collect" : "Get Closer"}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Hidden Power-Up Clues (no proximity data yet) */}
        {hiddenPowerUps.length > 0 && proximityData.length === 0 && (
          <View style={styles.cluesSection}>
            <Text style={styles.cluesSectionTitle}>🔍 Hidden Power-Up Clues</Text>
            {hiddenPowerUps.map((mp) => (
              <View key={mp.id} style={styles.clueCard}>
                <Text style={styles.clueText}>🔍 {mp.clue || "No clue provided"}</Text>
                <TouchableOpacity
                  style={styles.guessBtn}
                  onPress={() => setGuessModal({
                    visible: true,
                    mapPowerUpId: mp.id,
                    clue: mp.clue || "",
                    guessLat: myLocation ? myLocation.latitude.toFixed(6) : "",
                    guessLon: myLocation ? myLocation.longitude.toFixed(6) : "",
                    result: null,
                  })}
                >
                  <Text style={styles.guessBtnText}>Guess Location</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Legend</Text>
          <View style={styles.legendRow}>
            {[
              { color: "#9B59B6", emoji: "🎯", label: "You" },
              { color: "#00CC44", emoji: "💀", label: "Target" },
              { color: "#3498DB", emoji: "🛡️", label: "Safe" },
              { color: "#7B2FFF", emoji: "⚡", label: "Power-Up" },
              ...(safeZones.length ? [{ color: "#3498DB", emoji: "⛪", label: "Sanctuary Zone" }] : []),
              ...(purgeActive ? [{ color: "#FF69B4", emoji: "👤", label: "Purge Players" }] : []),
            ].map(item => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendText}>{item.emoji} {item.label}</Text>
              </View>
            ))}
          </View>
        </View>
        {/* Players list — tap to check location (only allowed for your target, or everyone during purge) */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>👥 Players in Game</Text>
          {players.filter(p => p.id !== myPlayer?.id && p.status !== "eliminated").map((p) => {
            const isMyTarget = p.id === myPlayer?.targetId || p.id === vendettaTarget?.id;
            const canCheck = isMyTarget || purgeActive;
            return (
              <TouchableOpacity
                key={p.id}
                style={styles.playerRow}
                disabled={!canCheck || checkLocationMutation.isPending}
                onPress={() => checkLocationMutation.mutate({ gameId: activeGameId!, targetPlayerId: p.id })}
              >
                <Text style={[styles.playerRowName, !canCheck && { opacity: 0.5 }]}>
                  {isMyTarget ? "💀 " : ""}{resolvePlayerLabel(p)} {(p as any).protectionBadge ? `🛡️ ${(p as any).protectionBadge.label}` : ""}
                </Text>
                <Text style={canCheck ? styles.playerRowCheck : styles.playerRowLocked}>
                  {canCheck ? "📍 Check Location" : "🔒 Not your target"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Location Guess Modal */}
      <Modal
        visible={guessModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setGuessModal(g => ({ ...g, visible: false, result: null }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>📍 Guess Power-Up Location</Text>
            {guessModal.clue ? (
              <View style={styles.modalClueBox}>
                <Text style={styles.modalClueLabel}>Clue:</Text>
                <Text style={styles.modalClueText}>"{guessModal.clue}"</Text>
              </View>
            ) : null}

            {!guessModal.result ? (
              <>
                <Text style={styles.modalHelper}>
                  Tap the map above, type an address, or enter coordinates directly. If you're within 100 meters, you'll get the exact location!
                </Text>
                <Text style={styles.modalLabel}>Search an address</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    style={[styles.modalInput, { flex: 1 }]}
                    value={addressQuery}
                    onChangeText={setAddressQuery}
                    placeholder="e.g. 123 Main St, Houston TX"
                    placeholderTextColor="#666"
                    returnKeyType="search"
                    onSubmitEditing={handleGeocodeAddress}
                  />
                  <TouchableOpacity
                    style={[styles.addressSearchBtn, geocoding && { opacity: 0.6 }]}
                    onPress={handleGeocodeAddress}
                    disabled={geocoding}
                  >
                    {geocoding ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.modalSubmitText}>Find</Text>}
                  </TouchableOpacity>
                </View>
                {addressError && <Text style={styles.addressErrorText}>{addressError}</Text>}
                <Text style={styles.attributionText}>{GEOCODING_ATTRIBUTION}</Text>
                <Text style={styles.modalLabel}>Latitude</Text>
                <TextInput
                  style={styles.modalInput}
                  value={guessModal.guessLat}
                  onChangeText={(v) => setGuessModal(g => ({ ...g, guessLat: v }))}
                  placeholder="e.g. 29.760427"
                  placeholderTextColor="#666"
                  keyboardType="decimal-pad"
                />
                <Text style={styles.modalLabel}>Longitude</Text>
                <TextInput
                  style={styles.modalInput}
                  value={guessModal.guessLon}
                  onChangeText={(v) => setGuessModal(g => ({ ...g, guessLon: v }))}
                  placeholder="e.g. -95.369804"
                  placeholderTextColor="#666"
                  keyboardType="decimal-pad"
                />
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setGuessModal(g => ({ ...g, visible: false, result: null }))}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalSubmitBtn, submitGuessMutation.isPending && { opacity: 0.6 }]}
                    onPress={() => {
                      if (!guessModal.mapPowerUpId || !guessModal.guessLat || !guessModal.guessLon) return;
                      submitGuessMutation.mutate({
                        gameId: activeGameId!,
                        mapPowerUpId: guessModal.mapPowerUpId,
                        guessLatitude: parseFloat(guessModal.guessLat),
                        guessLongitude: parseFloat(guessModal.guessLon),
                      });
                    }}
                    disabled={submitGuessMutation.isPending}
                  >
                    {submitGuessMutation.isPending
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={styles.modalSubmitText}>Submit Guess</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.resultBox, { borderColor: guessModal.result.correct ? "#00FF88" : "#FF3333" }]}>
                  <Text style={[styles.resultText, { color: guessModal.result.correct ? "#00FF88" : "#FF3333" }]}>
                    {guessModal.result.message}
                  </Text>
                  {guessModal.result.correct && guessModal.result.revealedLatitude && (
                    <View style={styles.revealBox}>
                      <Text style={styles.revealTitle}>📍 Exact Location:</Text>
                      <Text style={styles.revealCoords}>
                        {guessModal.result.revealedLatitude}, {guessModal.result.revealedLongitude}
                      </Text>
                      <Text style={styles.revealHelper}>Open Maps app and enter these coordinates to navigate there!</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.modalSubmitBtn}
                  onPress={() => setGuessModal(g => ({ ...g, visible: false, result: null }))}
                >
                  <Text style={styles.modalSubmitText}>
                    {guessModal.result.correct ? "Go Get It! 🏃" : "Try Again"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "800", color: "#fff" },
  subtitle: { fontSize: 12, color: "#888", marginTop: 2 },
  locationStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  locationStatusText: { fontSize: 12, color: "#888" },
  locationBar: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#333",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  locationBarTitle: { fontSize: 13, fontWeight: "600", color: "#fff" },
  locationBarCoords: { fontSize: 11, color: "#666", marginTop: 2 },
  locationToggleBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  proximityPanel: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: "#1a1a0a", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#FF9900",
  },
  proxTitle: { fontSize: 14, fontWeight: "700", color: "#FF9900", marginBottom: 10 },
  proxItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#2a2a1a",
  },
  proxRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  proxEmoji: { fontSize: 18 },
  proxLabel: { fontSize: 14, fontWeight: "800" },
  proxDist: { fontSize: 12, color: "#888" },
  proxClue: { fontSize: 12, color: "#aaa", fontStyle: "italic" },
  guessBtn: { backgroundColor: "#FF1493", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  guessBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  mapContainer: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: "hidden", minHeight: 320 },
  mapTapHint: { textAlign: "center", color: "#FF1493", fontSize: 12, fontWeight: "600", marginHorizontal: 16, marginTop: -8, marginBottom: 12 },
  checkLocationMessage: {
    marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1,
    padding: 12, backgroundColor: "#1a1a1a",
  },
  checkLocationMessageText: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  addressSearchBtn: { backgroundColor: "#FF1493", borderRadius: 10, paddingHorizontal: 18, justifyContent: "center", alignItems: "center" },
  addressErrorText: { color: "#FF3333", fontSize: 12, marginTop: 6 },
  attributionText: { color: "#666", fontSize: 10, marginTop: 6 },
  cluesSection: { marginHorizontal: 16, marginBottom: 12 },
  cluesSectionTitle: { fontSize: 15, fontWeight: "700", color: "#fff", marginBottom: 8 },
  clueCard: {
    backgroundColor: "#1a1a2a", borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: "#333",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  clueText: { fontSize: 13, color: "#FFD700", flex: 1, marginRight: 10 },
  legend: { marginHorizontal: 16, backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#333" },
  legendTitle: { fontSize: 13, fontWeight: "700", color: "#fff", marginBottom: 10 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: "#888" },
  playerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#222",
  },
  playerRowName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  playerRowCheck: { color: "#FF1493", fontSize: 12, fontWeight: "700" },
  playerRowLocked: { color: "#555", fontSize: 12, fontWeight: "600" },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#1a1a1a", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, borderTopWidth: 1, borderColor: "#FF1493",
  },
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 12 },
  modalClueBox: { backgroundColor: "#2a1a2a", borderRadius: 10, padding: 12, marginBottom: 12 },
  modalClueLabel: { fontSize: 11, color: "#FF69B4", fontWeight: "700", marginBottom: 4 },
  modalClueText: { fontSize: 14, color: "#ddd", fontStyle: "italic" },
  modalHelper: { fontSize: 13, color: "#888", lineHeight: 18, marginBottom: 16 },
  modalLabel: { fontSize: 12, color: "#aaa", fontWeight: "600", marginBottom: 6, marginTop: 10 },
  modalInput: {
    backgroundColor: "#2a2a2a", borderRadius: 10, padding: 12,
    color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#444",
  },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 20 },
  modalCancelBtn: { flex: 1, backgroundColor: "#2a2a2a", borderRadius: 10, padding: 14, alignItems: "center" },
  modalCancelText: { color: "#aaa", fontSize: 15, fontWeight: "600" },
  modalSubmitBtn: { flex: 2, backgroundColor: "#FF1493", borderRadius: 10, padding: 14, alignItems: "center" },
  modalSubmitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  resultBox: { borderWidth: 2, borderRadius: 12, padding: 16, marginBottom: 16 },
  resultText: { fontSize: 15, fontWeight: "700", lineHeight: 22 },
  revealBox: { marginTop: 12, backgroundColor: "#0a1a0a", borderRadius: 8, padding: 12 },
  revealTitle: { fontSize: 13, color: "#00FF88", fontWeight: "700", marginBottom: 6 },
  revealCoords: { fontSize: 16, color: "#fff", fontWeight: "800", fontFamily: "monospace" },
  revealHelper: { fontSize: 12, color: "#888", marginTop: 6, lineHeight: 16 },
});
