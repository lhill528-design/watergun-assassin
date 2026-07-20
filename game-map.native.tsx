import { View, TouchableOpacity, Text } from "react-native";
import MapView, { Marker, Circle } from "react-native-maps";
import { useRef } from "react";

type MapProps = {
  alivePlayers: any[];
  unclaimedPowerUps: any[];
  showAllLocations: boolean;
  locationEnabled: boolean;
};

export function GameMap({ alivePlayers, unclaimedPowerUps, showAllLocations, locationEnabled }: MapProps) {
  const mapRef = useRef<MapView>(null);

  const initialRegion = {
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.015,
    longitudeDelta: 0.015,
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation={locationEnabled}
        showsMyLocationButton={true}
        mapType="standard"
      >
        {/* Target marker */}
        {alivePlayers.filter((p: any) => p.isTarget && p.latitude && p.longitude).map((p: any) => (
          <Marker
            key={`target-${p.id}`}
            coordinate={{
              latitude: parseFloat(p.latitude),
              longitude: parseFloat(p.longitude),
            }}
            title="🎯 Your Target"
            description="Eliminate them!"
            pinColor="red"
          />
        ))}

        {/* All players during purge */}
        {showAllLocations && alivePlayers.filter((p: any) => p.latitude && p.longitude && !p.isTarget).map((p: any) => (
          <Marker
            key={`player-${p.id}`}
            coordinate={{
              latitude: parseFloat(p.latitude),
              longitude: parseFloat(p.longitude),
            }}
            title={`Player #${p.userId}`}
            pinColor="orange"
          />
        ))}

        {/* Power-up markers */}
        {unclaimedPowerUps.filter((mp: any) => mp.isVisible).map((mp: any) => (
          <Marker
            key={`pu-${mp.id}`}
            coordinate={{
              latitude: parseFloat(mp.latitude),
              longitude: parseFloat(mp.longitude),
            }}
            title="⚡ Power-Up"
            description="Go claim it!"
            pinColor="purple"
          />
        ))}

        {/* Radius circle around user */}
        <Circle
          center={{ latitude: 37.7749, longitude: -122.4194 }}
          radius={200}
          strokeColor="rgba(255,20,147,0.3)"
          fillColor="rgba(255,20,147,0.05)"
        />
      </MapView>

      {/* Bottom info panel */}
      <View style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
        <View className="bg-background/95 rounded-xl p-3 border border-border">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-foreground font-bold text-sm">
                {unclaimedPowerUps.length} power-ups hidden
              </Text>
              <Text className="text-muted text-xs">
                {unclaimedPowerUps.filter((mp: any) => !mp.isVisible).length} clue-only
              </Text>
            </View>
            <TouchableOpacity
              className="bg-primary px-4 py-2 rounded-lg"
              onPress={() => {
                mapRef.current?.animateToRegion(initialRegion, 500);
              }}
            >
              <Text className="text-background font-bold text-xs">Re-center</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
