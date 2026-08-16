import React from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { buildMapHtml } from "./game-map-html";
import type { PlayerPin, SafeZone } from "./game-map-html";

interface GameMapProps {
  myLocation: { latitude: number; longitude: number } | null;
  pins: PlayerPin[];
  purgeActive?: boolean;
  onMapPress?: (coords: { latitude: number; longitude: number }) => void;
  zones?: SafeZone[];
}

export function GameMap({ myLocation, pins, purgeActive = false, onMapPress, zones = [] }: GameMapProps) {
  const html = buildMapHtml(myLocation, pins, purgeActive, zones);
  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        onError={(e) => console.warn("[GameMap] WebView error:", e.nativeEvent)}
        onMessage={(event) => {
          if (!onMapPress) return;
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (typeof data.latitude === "number" && typeof data.longitude === "number") {
              onMapPress({ latitude: data.latitude, longitude: data.longitude });
            }
          } catch {
            // ignore malformed messages
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, overflow: "hidden", minHeight: 320 },
  webview: { flex: 1, minHeight: 320 },
});
