import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

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
  // A coordinate to pan/zoom to on demand (e.g. a just-checked target),
  // distinct from the one-time initial centering below. Passing a new
  // {latitude, longitude} value re-focuses the map; the same values
  // passed again are a no-op.
  focusLocation?: { latitude: number; longitude: number } | null;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

const DEFAULT_CENTER: [number, number] = [37.7749, -122.4194];

const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

// Same unpkg Leaflet build the native WebView map loads -- on web we're
// already inside a real browser, so this talks to the DOM directly instead
// of wrapping a whole second browser context in a WebView for no reason.
// Cached at module scope so navigating between screens doesn't re-fetch it.
let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const existing = (window as any).L;
  if (existing) return Promise.resolve(existing);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[data-leaflet-css]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS_URL;
      link.setAttribute("data-leaflet-css", "true");
      document.head.appendChild(link);
    }
    const existingScript = document.querySelector(`script[data-leaflet-js]`) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve((window as any).L));
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Leaflet")));
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS_URL;
    script.async = true;
    script.setAttribute("data-leaflet-js", "true");
    script.onload = () => resolve((window as any).L);
    script.onerror = () => {
      // Remove the failed tag so a later mount finds no `data-leaflet-js`
      // element and issues a fresh request, instead of every future map
      // seeing this dead script and waiting on a load event that will
      // never fire.
      script.remove();
      leafletPromise = null;
      reject(new Error("Failed to load Leaflet"));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pinDivIcon(L: any, color: string, emoji: string, size: number) {
  return L.divIcon({
    html: `<div style="background:${color};color:#000;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.5)}px;border:${size > 32 ? 3 : 2}px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5)">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    className: "",
  });
}

// Real interactive Leaflet map for web (the native platforms get the same
// Leaflet/OpenStreetMap combo via a WebView -- see game-map.native.tsx).
// Tapping the map reports coords through onMapPress, same as native, so the
// map-power-up location-guess flow works identically on both platforms.
export function GameMap({ myLocation, pins, purgeActive = false, onMapPress, zones = [], focusLocation }: GameMapProps) {
  const containerRef = useRef<View>(null);
  const mapRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const zonesLayerRef = useRef<any>(null);
  const hasCenteredRef = useRef(false);
  const lastFocusKeyRef = useRef<string | null>(null);
  const onMapPressRef = useRef(onMapPress);
  onMapPressRef.current = onMapPress;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Bumping this re-runs the mount/load effect below -- the retry action
  // for when the Leaflet script failed to load the first time.
  const [retryCount, setRetryCount] = useState(0);

  const validPins = pins.filter((pin) => isFiniteCoordinate(pin.latitude) && isFiniteCoordinate(pin.longitude));

  // Create the map once per mount/retry.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    loadLeaflet()
      .then((L) => {
        if (cancelled) return;
        const node = containerRef.current as unknown as HTMLElement | null;
        if (!node) return;

        const map = L.map(node, { zoomControl: true, attributionControl: true }).setView(
          myLocation ? [myLocation.latitude, myLocation.longitude] : DEFAULT_CENTER,
          myLocation ? 14 : 10,
        );
        // OSM's tile usage policy (https://operations.osmfoundation.org/policies/tiles/)
        // requires the single tile.openstreetmap.org host (no {s} subdomain
        // sharding) and a visible, linked attribution -- both required, not
        // optional, to keep using their tile server.
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        markersLayerRef.current = L.layerGroup().addTo(map);
        zonesLayerRef.current = L.layerGroup().addTo(map);

        map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
          onMapPressRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng });
        });

        mapRef.current = map;
        hasCenteredRef.current = Boolean(myLocation);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Map is created once per mount, or again when retryCount changes (the
    // Retry button); prop-driven updates happen in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // Redraw markers/zones whenever the underlying data changes.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current) return;
    const L = (window as any).L;
    const markersLayer = markersLayerRef.current;
    const zonesLayer = zonesLayerRef.current;
    if (!L || !markersLayer || !zonesLayer) return;

    markersLayer.clearLayers();
    zonesLayer.clearLayers();

    zones.forEach((zone) => {
      L.circle([zone.latitude, zone.longitude], {
        radius: zone.radiusMeters,
        color: "#3498DB",
        weight: 2,
        fillColor: "#3498DB",
        fillOpacity: 0.2,
      })
        .addTo(zonesLayer)
        .bindPopup(`<b>⛪ ${escapeHtml(zone.label || "Sanctuary")}</b><br/>Safe zone — hunters should not enter`);
    });

    if (myLocation) {
      L.marker([myLocation.latitude, myLocation.longitude], {
        icon: pinDivIcon(L, "#9B59B6", "🎯", 36),
      })
        .addTo(markersLayer)
        .bindPopup("<b>You</b>");
    }

    validPins.forEach((pin) => {
      const color = PIN_COLORS[pin.type] ?? "#FFFFFF";
      const emoji = PIN_EMOJIS[pin.type] ?? "📍";
      L.marker([pin.latitude, pin.longitude], { icon: pinDivIcon(L, color, emoji, 32) })
        .addTo(markersLayer)
        .bindPopup(`<b>${escapeHtml(pin.label)}</b>`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, validPins, zones, myLocation]);

  // Center once, the first time we have something to center on: the
  // player's own GPS location if available, otherwise the bounds of
  // whatever valid pins already exist (instead of the San Francisco
  // default) -- e.g. on web, where there's usually no device GPS at all.
  // Doesn't fight the user's pan/zoom after that first center.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || hasCenteredRef.current) return;
    if (myLocation) {
      mapRef.current.setView([myLocation.latitude, myLocation.longitude], 14);
      hasCenteredRef.current = true;
      return;
    }
    if (validPins.length === 0) return;
    const L = (window as any).L;
    if (!L) return;
    const bounds = L.latLngBounds(validPins.map((pin) => [pin.latitude, pin.longitude]));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    hasCenteredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, myLocation, validPins]);

  // Pan/zoom to an explicitly focused location (e.g. a just-checked
  // target) on demand -- distinct from the one-time initial centering
  // above, and a no-op if the same coordinate is focused again.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !focusLocation) return;
    if (!isFiniteCoordinate(focusLocation.latitude) || !isFiniteCoordinate(focusLocation.longitude)) return;
    const key = `${focusLocation.latitude},${focusLocation.longitude}`;
    if (lastFocusKeyRef.current === key) return;
    lastFocusKeyRef.current = key;
    hasCenteredRef.current = true;
    mapRef.current.setView([focusLocation.latitude, focusLocation.longitude], 15);
  }, [status, focusLocation]);

  return (
    <View style={styles.container}>
      {purgeActive && (
        <View style={styles.purgeBanner}>
          <Text style={styles.purgeText}>⚠️ PURGE ACTIVE — ALL LOCATIONS VISIBLE</Text>
        </View>
      )}
      <View style={styles.mapWrapper}>
        <View ref={containerRef} style={styles.mapView} />
        {status !== "ready" && (
          <View style={styles.overlay} pointerEvents={status === "error" ? "auto" : "none"}>
            <Text style={styles.overlayText}>
              {status === "loading" ? "Loading map…" : "Map unavailable — check your connection"}
            </Text>
            {status === "error" && (
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => setRetryCount((count) => count + 1)}
                accessibilityRole="button"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#1a1a2e", borderRadius: 16, overflow: "hidden", minHeight: 320 },
  purgeBanner: {
    backgroundColor: "rgba(255,0,102,0.85)", padding: 10, alignItems: "center",
  },
  purgeText: { color: "#FFF", fontWeight: "bold", fontSize: 12 },
  mapWrapper: { flex: 1, minHeight: 320, position: "relative" },
  mapView: { flex: 1, minHeight: 320 },
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
