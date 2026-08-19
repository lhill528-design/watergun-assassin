import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Switch,
  StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import { useGame } from "@/lib/game-context";
import * as Location from "expo-location";

interface MapPowerUpForm {
  powerUpId: number | null;
  latitude: string;
  longitude: string;
  isVisible: boolean;
  clue: string;
  address: string; // Human-readable address for admin reference
}

const DEFAULT_FORM: MapPowerUpForm = {
  powerUpId: null,
  latitude: "",
  longitude: "",
  isVisible: false,
  clue: "",
  address: "",
};

function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export default function AdminMapPowerUpsScreen() {
  const router = useRouter();
  const { activeGameId } = useGame();
  const [form, setForm] = useState<MapPowerUpForm>(DEFAULT_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [addressSearch, setAddressSearch] = useState("");
  const [searchingAddress, setSearchingAddress] = useState(false);
  // All validation, geocoding, backend, and success messages surface
  // through this instead of Alert.alert -- on web, a failed mutation
  // previously showed nothing at all (the Alert.alert calls the client
  // relied on to report both success and failure).
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  // A ref (not just createMutation.isPending, which only flips after
  // react-query's own async state update) so a rapid second submit can't
  // slip through before the first request's disabled state has rendered.
  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const gameId = activeGameId ?? 0;
  const utils = trpc.useUtils();

  const { data: mapPowerUps } = trpc.mapPowerUp.list.useQuery(
    { gameId },
    { enabled: gameId > 0 }
  );

  const { data: powerUps } = trpc.powerUp.list.useQuery(
    { gameId },
    { enabled: gameId > 0 }
  );

  const createMutation = trpc.mapPowerUp.create.useMutation();

  const handleUseCurrentLocation = async () => {
    setFormError(null);
    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setFormError("Location permission is required to place power-ups.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm((f) => ({
        ...f,
        latitude: loc.coords.latitude.toFixed(6),
        longitude: loc.coords.longitude.toFixed(6),
      }));
      // Reverse geocode to get address
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo) {
        const addr = [geo.streetNumber, geo.street, geo.city, geo.region].filter(Boolean).join(", ");
        setForm((f) => ({ ...f, address: addr }));
      }
    } catch {
      setFormError("Could not get current location.");
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleFindAddress = async () => {
    if (!addressSearch.trim()) return;
    setFormError(null);
    setSearchingAddress(true);
    try {
      const results = await Location.geocodeAsync(addressSearch.trim());
      if (!results.length) {
        setFormError("Couldn't find that address. Try being more specific.");
        return;
      }
      const { latitude, longitude } = results[0];
      setForm((f) => ({ ...f, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6), address: addressSearch.trim() }));
    } catch {
      setFormError("Couldn't look up that address right now.");
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    setFormError(null);
    setFormSuccess(null);

    if (!form.powerUpId) {
      setFormError("Please select a power-up.");
      return;
    }
    if (!form.latitude || !form.longitude) {
      setFormError("Please set a location for this power-up.");
      return;
    }
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!isValidLatitude(latitude)) {
      setFormError("Latitude must be a number between -90 and 90.");
      return;
    }
    if (!isValidLongitude(longitude)) {
      setFormError("Longitude must be a number between -180 and 180.");
      return;
    }
    if (!form.isVisible && !form.clue.trim()) {
      setFormError("Hidden power-ups must have a clue for players.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        gameId,
        powerUpId: form.powerUpId,
        latitude: form.latitude,
        longitude: form.longitude,
        isVisible: form.isVisible,
        clue: form.clue.trim() || undefined,
      });
      utils.mapPowerUp.list.invalidate({ gameId });
      // Reset only after the mutation is confirmed successful -- resetting
      // eagerly (the old onSuccess-only path) would be fine, but doing it
      // here keeps the reset strictly tied to a real success, not a
      // request that's merely been sent.
      setForm(DEFAULT_FORM);
      setShowForm(false);
      setFormSuccess("Map power-up placed successfully!");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not place the power-up.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const selectedPowerUp = powerUps?.find((p) => p.id === form.powerUpId);

  return (
    <ScreenContainer>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>🗺️ Map Power-Ups</Text>
          <Text style={styles.subtitle}>
            Place power-ups on the map for players to find. Hidden ones require players to solve a clue or guess the location.
          </Text>
        </View>

        {formSuccess && !showForm && (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerText}>✅ {formSuccess}</Text>
          </View>
        )}

        {/* Place New Button */}
        {!showForm && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => { setFormSuccess(null); setFormError(null); setShowForm(true); }}
          >
            <Text style={styles.addBtnText}>+ Place New Power-Up</Text>
          </TouchableOpacity>
        )}

        {/* Placement Form */}
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>New Map Power-Up</Text>

            {formError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{formError}</Text>
              </View>
            )}

            {/* Power-Up Selector */}
            <Text style={styles.label}>Select Power-Up *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.powerUpScroll}>
              {powerUps?.filter(p => p.isEnabled).map((pu) => (
                <TouchableOpacity
                  key={pu.id}
                  style={[
                    styles.powerUpChip,
                    form.powerUpId === pu.id && styles.powerUpChipSelected,
                  ]}
                  onPress={() => setForm((f) => ({ ...f, powerUpId: pu.id }))}
                >
                  <Text style={styles.powerUpChipEmoji}>{pu.emoji}</Text>
                  <Text style={[
                    styles.powerUpChipText,
                    form.powerUpId === pu.id && styles.powerUpChipTextSelected,
                  ]}>{pu.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {selectedPowerUp && (
              <View style={styles.selectedPUInfo}>
                <Text style={styles.selectedPUText}>
                  {selectedPowerUp.emoji} {selectedPowerUp.name} — {selectedPowerUp.effect}
                </Text>
              </View>
            )}

            {/* Visibility Toggle */}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Visible on Map</Text>
                <Text style={styles.helperText}>
                  {form.isVisible
                    ? "Players will see the exact pin on the map."
                    : "Players only see a clue — no pin shown. Proximity alerts will guide them."}
                </Text>
              </View>
              <Switch
                value={form.isVisible}
                onValueChange={(v) => setForm((f) => ({ ...f, isVisible: v }))}
                trackColor={{ false: "#333", true: "#FF1493" }}
                thumbColor="#fff"
              />
            </View>

            {/* Clue Field */}
            <Text style={styles.label}>
              Clue {form.isVisible ? "(Optional)" : "(Required for hidden power-ups)"}
            </Text>
            <TextInput
              style={styles.input}
              value={form.clue}
              onChangeText={(v) => setForm((f) => ({ ...f, clue: v }))}
              placeholder={
                form.isVisible
                  ? "Optional hint for players (e.g. 'Near the fountain')"
                  : "Clue players must solve to find this power-up..."
              }
              placeholderTextColor="#666"
              multiline
              numberOfLines={3}
            />

            {/* Location */}
            <Text style={styles.label}>Location *</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[styles.coordInput, { flex: 1 }]}
                value={addressSearch}
                onChangeText={setAddressSearch}
                placeholder="Type an address, e.g. 123 Main St, Houston TX"
                placeholderTextColor="#666"
                returnKeyType="search"
                onSubmitEditing={handleFindAddress}
              />
              <TouchableOpacity
                style={[styles.findAddressBtn, searchingAddress && { opacity: 0.6 }]}
                onPress={handleFindAddress}
                disabled={searchingAddress}
              >
                {searchingAddress ? <ActivityIndicator color="#000" size="small" /> : <Text style={styles.submitBtnText}>Find</Text>}
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.locationBtn}
              onPress={handleUseCurrentLocation}
              disabled={loadingLocation}
            >
              {loadingLocation ? (
                <ActivityIndicator color="#FF1493" size="small" />
              ) : (
                <Text style={styles.locationBtnText}>📍 Or Use My Current Location</Text>
              )}
            </TouchableOpacity>

            <View style={styles.coordRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <TextInput
                  style={styles.coordInput}
                  value={form.latitude}
                  onChangeText={(v) => setForm((f) => ({ ...f, latitude: v }))}
                  placeholder="e.g. 29.760427"
                  placeholderTextColor="#666"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <TextInput
                  style={styles.coordInput}
                  value={form.longitude}
                  onChangeText={(v) => setForm((f) => ({ ...f, longitude: v }))}
                  placeholder="e.g. -95.369804"
                  placeholderTextColor="#666"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {form.address ? (
              <Text style={styles.addressText}>📍 {form.address}</Text>
            ) : null}

            <View style={styles.formBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setForm(DEFAULT_FORM); setShowForm(false); setFormError(null); }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Place Power-Up</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Existing Map Power-Ups */}
        <Text style={styles.sectionTitle}>
          Placed Power-Ups ({mapPowerUps?.length ?? 0})
        </Text>

        {mapPowerUps?.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No power-ups placed on the map yet.</Text>
            <Text style={styles.emptySubtext}>
              Place power-ups at real-world locations for players to hunt down.
            </Text>
          </View>
        )}

        {mapPowerUps?.map((mp) => {
          const pu = powerUps?.find((p) => p.id === mp.powerUpId);
          const isClaimed = !!mp.claimedBy;
          return (
            <View key={mp.id} style={[styles.mapPUCard, isClaimed && styles.mapPUCardClaimed]}>
              <View style={styles.mapPUHeader}>
                <Text style={styles.mapPUEmoji}>{pu?.emoji ?? "🎁"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mapPUName}>{pu?.name ?? "Unknown Power-Up"}</Text>
                  <Text style={styles.mapPUStatus}>
                    {isClaimed ? "✅ Claimed" : mp.isVisible ? "👁️ Visible on map" : "🔒 Hidden — clue only"}
                  </Text>
                </View>
              </View>
              {mp.clue ? (
                <View style={styles.clueBox}>
                  <Text style={styles.clueLabel}>Clue:</Text>
                  <Text style={styles.clueText}>"{mp.clue}"</Text>
                </View>
              ) : null}
              <Text style={styles.coordsText}>
                📍 {mp.latitude}, {mp.longitude}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: { padding: 20, paddingTop: 16 },
  backBtn: { marginBottom: 12 },
  backBtnText: { color: "#FF1493", fontSize: 16, fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "800", color: "#fff", marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#888", lineHeight: 18 },
  successBanner: {
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: "#0f2a1a", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#00FF88",
  },
  successBannerText: { color: "#00FF88", fontSize: 13, fontWeight: "600" },
  errorBanner: {
    backgroundColor: "#2a0f14", borderRadius: 10, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "#FF3333",
  },
  errorBannerText: { color: "#FF6B6B", fontSize: 13, fontWeight: "600" },
  addBtn: {
    marginHorizontal: 20, marginBottom: 16,
    backgroundColor: "#FF1493", borderRadius: 12, padding: 14,
    alignItems: "center",
  },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  formCard: {
    marginHorizontal: 16, marginBottom: 20,
    backgroundColor: "#1a1a1a", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#FF1493",
  },
  formTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", color: "#aaa", marginBottom: 6, marginTop: 12 },
  helperText: { fontSize: 12, color: "#666", marginTop: 2, lineHeight: 16 },
  powerUpScroll: { marginBottom: 8 },
  powerUpChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#2a2a2a", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    marginRight: 8, borderWidth: 1, borderColor: "#333",
  },
  powerUpChipSelected: { backgroundColor: "#FF1493", borderColor: "#FF1493" },
  powerUpChipEmoji: { fontSize: 16 },
  powerUpChipText: { fontSize: 13, color: "#aaa", fontWeight: "600" },
  powerUpChipTextSelected: { color: "#fff" },
  selectedPUInfo: {
    backgroundColor: "#2a1a2a", borderRadius: 8, padding: 10, marginBottom: 8,
  },
  selectedPUText: { fontSize: 12, color: "#FF69B4", lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  input: {
    backgroundColor: "#2a2a2a", borderRadius: 10, padding: 12,
    color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#333",
    minHeight: 80, textAlignVertical: "top",
  },
  locationBtn: {
    backgroundColor: "#1a2a1a", borderRadius: 10, padding: 12,
    alignItems: "center", borderWidth: 1, borderColor: "#00FF88",
  },
  locationBtnText: { color: "#00FF88", fontSize: 14, fontWeight: "600" },
  findAddressBtn: { backgroundColor: "#FF1493", borderRadius: 10, paddingHorizontal: 18, justifyContent: "center", alignItems: "center" },
  coordRow: { flexDirection: "row", marginTop: 10 },
  coordLabel: { fontSize: 12, color: "#888", marginBottom: 4 },
  coordInput: {
    backgroundColor: "#2a2a2a", borderRadius: 8, padding: 10,
    color: "#fff", fontSize: 13, borderWidth: 1, borderColor: "#333",
  },
  addressText: { fontSize: 12, color: "#888", marginTop: 8, fontStyle: "italic" },
  formBtns: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1, backgroundColor: "#2a2a2a", borderRadius: 10, padding: 14, alignItems: "center",
  },
  cancelBtnText: { color: "#aaa", fontSize: 15, fontWeight: "600" },
  submitBtn: {
    flex: 2, backgroundColor: "#FF1493", borderRadius: 10, padding: 14, alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionTitle: {
    fontSize: 16, fontWeight: "700", color: "#fff",
    marginHorizontal: 20, marginBottom: 12, marginTop: 4,
  },
  emptyCard: {
    marginHorizontal: 16, backgroundColor: "#1a1a1a", borderRadius: 12,
    padding: 24, alignItems: "center",
  },
  emptyText: { color: "#aaa", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptySubtext: { color: "#666", fontSize: 13, textAlign: "center", lineHeight: 18 },
  mapPUCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#333",
  },
  mapPUCardClaimed: { borderColor: "#00FF88", opacity: 0.7 },
  mapPUHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  mapPUEmoji: { fontSize: 28 },
  mapPUName: { fontSize: 15, fontWeight: "700", color: "#fff" },
  mapPUStatus: { fontSize: 12, color: "#888", marginTop: 2 },
  clueBox: {
    backgroundColor: "#2a1a2a", borderRadius: 8, padding: 10, marginBottom: 8,
  },
  clueLabel: { fontSize: 11, color: "#FF69B4", fontWeight: "700", marginBottom: 2 },
  clueText: { fontSize: 13, color: "#ddd", fontStyle: "italic", lineHeight: 18 },
  coordsText: { fontSize: 11, color: "#555" },
});
