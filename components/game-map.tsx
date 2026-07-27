import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";

interface PlayerPin {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  type: "self" | "target" | "safe" | "player" | "purge_player" | "powerup";
}

interface SafeZone {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label?: string;
}

interface GameMapProps {
  myLocation: { latitude: number; longitude: number } | null;
  pins: PlayerPin[];
  purgeActive?: boolean;
  onMapPress?: (coords: { latitude: number; longitude: number }) => void;
  zones?: SafeZone[];
}

// Web fallback — react-native-maps is native-only. No tap-to-pick here since
// this is a plain list, not an interactive map; use the address search instead.
export function GameMap({ myLocation, pins, purgeActive, zones = [] }: GameMapProps) {
  const getPinEmoji = (type: PlayerPin["type"]) => {
    switch (type) {
      case "self": return "🎯";
      case "target": return "💀";
      case "safe": return "🛡️";
      case "player":
      case "purge_player": return "👤";
      case "powerup": return "⚡";
      default: return "📍";
    }
  };

  const getPinLabel = (type: PlayerPin["type"]) => {
    switch (type) {
      case "self": return "You";
      case "target": return "Target";
      case "safe": return "Safe";
      case "player": return "Player";
      case "purge_player": return "Purge Player";
      case "powerup": return "Power-Up";
      default: return "Unknown";
    }
  };

  const getPinColor = (type: PlayerPin["type"]) => {
    switch (type) {
      case "self": return "#9B59B6";
      case "target": return "#00CC44";
      case "safe": return "#3498DB";
      case "player":
      case "purge_player": return "#FF69B4";
      case "powerup": return "#7B2FFF";
      default: return "#FFFFFF";
    }
  };

  return (
    <View style={styles.container}>
      {purgeActive && (
        <View style={styles.purgeBanner}>
          <Text style={styles.purgeText}>⚠️ PURGE ACTIVE — ALL LOCATIONS VISIBLE</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.headerText}>📍 Location Tracker</Text>
        <Text style={styles.subText}>Live map available on iOS/Android</Text>
      </View>

      {zones.map((zone, i) => (
        <View key={`zone-${i}`} style={[styles.pinRow, { borderLeftColor: "#3498DB" }]}>
          <Text style={styles.pinEmoji}>⛪</Text>
          <View style={styles.pinInfo}>
            <Text style={styles.pinLabel}>{zone.label || "Sanctuary Safe Zone"}</Text>
            <Text style={styles.pinCoords}>
              {zone.latitude.toFixed(5)}, {zone.longitude.toFixed(5)} · ~{zone.radiusMeters}m radius
            </Text>
          </View>
        </View>
      ))}

      {myLocation && (
        <View style={[styles.pinRow, { borderLeftColor: "#9B59B6" }]}>
          <Text style={styles.pinEmoji}>🎯</Text>
          <View style={styles.pinInfo}>
            <Text style={styles.pinLabel}>Your Location</Text>
            <Text style={styles.pinCoords}>
              {myLocation.latitude.toFixed(5)}, {myLocation.longitude.toFixed(5)}
            </Text>
          </View>
          <View style={[styles.typeBadge, { backgroundColor: "#9B59B620" }]}>
            <Text style={[styles.typeBadgeText, { color: "#9B59B6" }]}>YOU</Text>
          </View>
        </View>
      )}

      <ScrollView style={styles.pinList} showsVerticalScrollIndicator={false}>
        {pins.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No visible locations</Text>
            <Text style={styles.emptySubText}>Your target's location will appear here when available</Text>
          </View>
        ) : (
          pins.map((pin) => (
            <View key={`${pin.id}-${pin.type}`} style={[styles.pinRow, { borderLeftColor: getPinColor(pin.type) }]}>
              <Text style={styles.pinEmoji}>{getPinEmoji(pin.type)}</Text>
              <View style={styles.pinInfo}>
                <Text style={styles.pinLabel}>{pin.label}</Text>
                <Text style={styles.pinCoords}>
                  {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                </Text>
              </View>
              <View style={[styles.typeBadge, { backgroundColor: getPinColor(pin.type) + "20" }]}>
                <Text style={[styles.typeBadgeText, { color: getPinColor(pin.type) }]}>
                  {getPinLabel(pin.type).toUpperCase()}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#1a1a2e", borderRadius: 16, overflow: "hidden", minHeight: 300 },
  purgeBanner: {
    backgroundColor: "rgba(255,0,102,0.85)", padding: 10, alignItems: "center",
  },
  purgeText: { color: "#FFF", fontWeight: "bold", fontSize: 12 },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: "#333" },
  headerText: { color: "#FFF", fontWeight: "bold", fontSize: 16 },
  subText: { color: "#888", fontSize: 12, marginTop: 2 },
  pinList: { maxHeight: 250 },
  pinRow: {
    flexDirection: "row", alignItems: "center", padding: 12,
    borderBottomWidth: 1, borderBottomColor: "#222",
    borderLeftWidth: 3,
  },
  pinEmoji: { fontSize: 20, marginRight: 12 },
  pinInfo: { flex: 1 },
  pinLabel: { color: "#FFF", fontWeight: "600", fontSize: 14 },
  pinCoords: { color: "#888", fontSize: 11, marginTop: 2 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "bold" },
  emptyState: { padding: 24, alignItems: "center" },
  emptyText: { color: "#888", fontSize: 14, fontWeight: "600" },
  emptySubText: { color: "#555", fontSize: 12, marginTop: 4, textAlign: "center" },
});
