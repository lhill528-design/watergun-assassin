import React from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

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

const PIN_COLORS: Record<PlayerPin["type"], string> = {
  self: "#9B59B6",
  target: "#00CC44",
  safe: "#3498DB",
  player: "#FF69B4",
  purge_player: "#FF69B4",
  powerup: "#7B2FFF",
};

const PIN_EMOJIS: Record<PlayerPin["type"], string> = {
  self: "🎯",
  target: "💀",
  safe: "🛡️",
  player: "👤",
  purge_player: "👤",
  powerup: "⚡",
};

function buildMapHtml(
  center: { latitude: number; longitude: number } | null,
  pins: PlayerPin[],
  purgeActive: boolean,
  zones: SafeZone[],
): string {
  const lat = center?.latitude ?? 37.7749;
  const lng = center?.longitude ?? -122.4194;
  const zoom = center ? 14 : 10;

  const markersJs = pins
    .map((pin) => {
      const color = PIN_COLORS[pin.type] ?? "#FFFFFF";
      const emoji = PIN_EMOJIS[pin.type] ?? "📍";
      const safeLabel = pin.label.replace(/'/g, "\\'").replace(/"/g, '\\"');
      return `L.marker([${pin.latitude}, ${pin.longitude}], { icon: L.divIcon({ html: '<div style="background:${color};color:#000;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${emoji}</div>', iconSize: [32,32], iconAnchor: [16,16], className: '' }) }).addTo(map).bindPopup('<b>${safeLabel}</b>');`;
    })
    .join("\n");

  const selfMarker = center
    ? `L.marker([${lat}, ${lng}], { icon: L.divIcon({ html: '<div style="background:#9B59B6;color:#000;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.7)">🎯</div>', iconSize: [36,36], iconAnchor: [18,18], className: '' }) }).addTo(map).bindPopup('<b>You</b>');`
    : "";

  const clickHandlerJs = `map.on('click', function(e){ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: e.latlng.lat, longitude: e.latlng.lng })); } });`;

  const zonesJs = zones
    .map((zone) => {
      const safeLabel = (zone.label || "Sanctuary").replace(/'/g, "\\'").replace(/"/g, '\\"');
      return `L.circle([${zone.latitude}, ${zone.longitude}], { radius: ${zone.radiusMeters}, color: '#3498DB', weight: 2, fillColor: '#3498DB', fillOpacity: 0.2 }).addTo(map).bindPopup('<b>⛪ ${safeLabel}</b><br/>Safe zone — hunters should not enter');`;
    })
    .join("\n");

  // OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/)
  // requires the single tile.openstreetmap.org host (no {s} subdomain
  // sharding) and a visible, linked attribution -- both required, not
  // optional, to keep using their tile server.
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></scr` + `ipt><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#1a1a2e}#map{width:100%;height:100%}${purgeActive ? ".purge-banner{position:absolute;top:0;left:0;right:0;background:rgba(255,0,102,0.85);color:#fff;text-align:center;padding:8px;font-weight:bold;font-size:13px;z-index:1000}" : ""}</style></head><body>${purgeActive ? '<div class="purge-banner">⚠️ PURGE ACTIVE — ALL LOCATIONS VISIBLE</div>' : ""}<div id="map"></div><script>var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([${lat},${lng}],${zoom});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'}).addTo(map);${zonesJs}${selfMarker}${markersJs}${clickHandlerJs}</scr` + `ipt></body></html>`;
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
