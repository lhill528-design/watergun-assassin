// Pure HTML-string builder for the native map's WebView (see
// game-map.native.tsx). Kept dependency-free (no react-native imports) so
// it can be unit tested directly without mocking RN/WebView.

export interface PlayerPin {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  type: "self" | "target" | "safe" | "player" | "purge_player" | "powerup";
}

export interface SafeZone {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label?: string;
}

export const PIN_COLORS: Record<PlayerPin["type"], string> = {
  self: "#9B59B6",
  target: "#00CC44",
  safe: "#3498DB",
  player: "#FF69B4",
  purge_player: "#FF69B4",
  powerup: "#7B2FFF",
};

export const PIN_EMOJIS: Record<PlayerPin["type"], string> = {
  self: "🎯",
  target: "💀",
  safe: "🛡️",
  player: "👤",
  purge_player: "👤",
  powerup: "⚡",
};

// Player labels (display name, or a Sanctuary zone's label) are untrusted
// player-supplied strings that end up inside the WebView's HTML via
// bindPopup(). Escaping only quotes (the previous behavior) still let
// `<img onerror=...>` or `</script>` through unescaped -- this escapes
// every HTML metacharacter before the string is treated as markup at all.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildMapHtml(
  center: { latitude: number; longitude: number } | null,
  pins: PlayerPin[],
  purgeActive: boolean,
  zones: SafeZone[],
  // A coordinate to focus on (e.g. a just-checked target), taking
  // priority over `center` (the device's own GPS). Rebuilding this HTML
  // with a different focusLocation is the native "re-focus" mechanism --
  // the WebView reloads positioned at the new spot.
  focusLocation?: { latitude: number; longitude: number } | null,
): string {
  const validPins = pins.filter((pin) => isFiniteCoordinate(pin.latitude) && isFiniteCoordinate(pin.longitude));
  const focus = focusLocation && isFiniteCoordinate(focusLocation.latitude) && isFiniteCoordinate(focusLocation.longitude) ? focusLocation : null;
  const anchor = focus ?? center;
  const lat = anchor?.latitude ?? validPins[0]?.latitude ?? 37.7749;
  const lng = anchor?.longitude ?? validPins[0]?.longitude ?? -122.4194;
  const zoom = anchor ? (focus ? 15 : 14) : 10;
  // With no device GPS and no explicit focus but at least one valid pin
  // (e.g. on web with no browser location granted), fit the map to those
  // pins instead of sitting on the San Francisco default.
  const fitBoundsJs = !anchor && validPins.length > 0
    ? `map.fitBounds(L.latLngBounds(${JSON.stringify(validPins.map((pin) => [pin.latitude, pin.longitude]))}), { padding: [40, 40], maxZoom: 14 });`
    : "";

  const markersJs = validPins
    .map((pin) => {
      const color = PIN_COLORS[pin.type] ?? "#FFFFFF";
      const emoji = PIN_EMOJIS[pin.type] ?? "📍";
      const popupHtml = `<b>${escapeHtml(pin.label)}</b>`;
      // JSON.stringify produces a JS string literal with every quote,
      // backslash, and control character already correctly escaped for
      // this exact position in the generated <script> source -- safer
      // than hand-rolling per-character replace() calls, and it's the
      // popup HTML (already escaped above) that gets embedded, not the
      // raw label.
      return `L.marker([${pin.latitude}, ${pin.longitude}], { icon: L.divIcon({ html: '<div style="background:${color};color:#000;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${emoji}</div>', iconSize: [32,32], iconAnchor: [16,16], className: '' }) }).addTo(map).bindPopup(${JSON.stringify(popupHtml)});`;
    })
    .join("\n");

  const selfMarker = center
    ? `L.marker([${center.latitude}, ${center.longitude}], { icon: L.divIcon({ html: '<div style="background:#9B59B6;color:#000;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.7)">🎯</div>', iconSize: [36,36], iconAnchor: [18,18], className: '' }) }).addTo(map).bindPopup('<b>You</b>');`
    : "";

  const clickHandlerJs = `map.on('click', function(e){ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: e.latlng.lat, longitude: e.latlng.lng })); } });`;

  const zonesJs = zones
    .map((zone) => {
      const popupHtml = `<b>⛪ ${escapeHtml(zone.label || "Sanctuary")}</b><br/>Safe zone — hunters should not enter`;
      return `L.circle([${zone.latitude}, ${zone.longitude}], { radius: ${zone.radiusMeters}, color: '#3498DB', weight: 2, fillColor: '#3498DB', fillOpacity: 0.2 }).addTo(map).bindPopup(${JSON.stringify(popupHtml)});`;
    })
    .join("\n");

  // OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/)
  // requires the single tile.openstreetmap.org host (no {s} subdomain
  // sharding) and a visible, linked attribution -- both required, not
  // optional, to keep using their tile server.
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></scr` + `ipt><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#1a1a2e}#map{width:100%;height:100%}${purgeActive ? ".purge-banner{position:absolute;top:0;left:0;right:0;background:rgba(255,0,102,0.85);color:#fff;text-align:center;padding:8px;font-weight:bold;font-size:13px;z-index:1000}" : ""}</style></head><body>${purgeActive ? '<div class="purge-banner">⚠️ PURGE ACTIVE — ALL LOCATIONS VISIBLE</div>' : ""}<div id="map"></div><script>var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([${lat},${lng}],${zoom});L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'}).addTo(map);${fitBoundsJs}${zonesJs}${selfMarker}${markersJs}${clickHandlerJs}</scr` + `ipt></body></html>`;
}
