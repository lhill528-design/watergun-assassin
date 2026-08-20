import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { buildMapHtml } from "./game-map-html";
import type { PlayerPin, SafeZone } from "./game-map-html";

interface GameMapProps {
  myLocation: { latitude: number; longitude: number } | null;
  pins: PlayerPin[];
  purgeActive?: boolean;
  onMapPress?: (coords: { latitude: number; longitude: number }) => void;
  zones?: SafeZone[];
  focusLocation?: { latitude: number; longitude: number } | null;
}

export function GameMap({ myLocation, pins, purgeActive = false, onMapPress, zones = [], focusLocation }: GameMapProps) {
  const html = buildMapHtml(myLocation, pins, purgeActive, zones, focusLocation);
  const [hasError, setHasError] = useState(false);
  // Changing the WebView's key forces a fresh mount/reload -- the retry
  // action for when the page failed to load (e.g. the Leaflet CDN script).
  const [retryCount, setRetryCount] = useState(0);

  return (
    <View style={styles.container}>
      <WebView
        key={retryCount}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        onLoadStart={() => setHasError(false)}
        onError={(e) => {
          console.warn("[GameMap] WebView error:", e.nativeEvent);
          setHasError(true);
        }}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            // WebView's own onError doesn't fire for a failed leaflet.js/
            // leaflet.css subresource inside the generated HTML (only for
            // the main document) -- game-map-html.ts's error reporter
            // catches that itself and posts this message instead.
            if (data?.type === "map_error") {
              console.warn("[GameMap] map_error from WebView content:", data.source);
              setHasError(true);
              return;
            }
            if (onMapPress && typeof data.latitude === "number" && typeof data.longitude === "number") {
              onMapPress({ latitude: data.latitude, longitude: data.longitude });
            }
          } catch {
            // ignore malformed messages
          }
        }}
      />
      {hasError && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Map unavailable — check your connection</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => { setHasError(false); setRetryCount((count) => count + 1); }}
            accessibilityRole="button"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, overflow: "hidden", minHeight: 320, position: "relative" },
  webview: { flex: 1, minHeight: 320 },
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a2e",
  },
  overlayText: { color: "#888", fontSize: 13, fontWeight: "600" },
  retryButton: {
    marginTop: 12, backgroundColor: "#FF1493", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
  },
  retryButtonText: { color: "#FFF", fontWeight: "bold", fontSize: 13 },
});
