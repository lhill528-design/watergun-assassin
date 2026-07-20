import { View, ScrollView, TouchableOpacity, Text } from "react-native";

type MapProps = {
  alivePlayers: any[];
  unclaimedPowerUps: any[];
  showAllLocations: boolean;
  locationEnabled: boolean;
};

export function GameMap({ alivePlayers, unclaimedPowerUps, showAllLocations }: MapProps) {
  return (
    <ScrollView contentContainerStyle={{ paddingTop: 100, padding: 16, paddingBottom: 40 }}>
      <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
        <Text className="text-foreground font-bold mb-2">📍 Player Locations</Text>
        {alivePlayers.map((p: any) => (
          <View key={p.id} className="flex-row items-center justify-between py-3 border-b border-border">
            <View className="flex-row items-center gap-3">
              <View className={`w-4 h-4 rounded-full ${p.isTarget ? "bg-error" : "bg-primary"}`} />
              <View>
                <Text className="text-foreground font-semibold">
                  {p.isTarget ? "🎯 Your Target" : `Player #${p.userId}`}
                </Text>
                <Text className="text-muted text-xs">
                  {p.latitude && p.longitude
                    ? `${parseFloat(p.latitude).toFixed(4)}, ${parseFloat(p.longitude).toFixed(4)}`
                    : "Location unknown"}
                </Text>
              </View>
            </View>
            {p.isTarget && (
              <View className="bg-error/20 px-2 py-1 rounded">
                <Text className="text-error text-xs font-bold">TARGET</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Hidden Power-Ups */}
      <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
        <Text className="text-foreground font-bold mb-2">🎁 Hidden Power-Ups ({unclaimedPowerUps.length})</Text>
        {unclaimedPowerUps.length === 0 ? (
          <Text className="text-muted text-sm">No hidden power-ups on the map</Text>
        ) : (
          unclaimedPowerUps.map((mp: any) => (
            <View key={mp.id} className="flex-row items-center justify-between py-3 border-b border-border">
              <View className="flex-1">
                {mp.isVisible ? (
                  <View>
                    <Text className="text-foreground text-sm font-semibold">📍 Visible Location</Text>
                    <Text className="text-muted text-xs">{parseFloat(mp.latitude).toFixed(4)}, {parseFloat(mp.longitude).toFixed(4)}</Text>
                  </View>
                ) : (
                  <View>
                    <Text className="text-warning text-sm font-semibold">🔍 Clue Only</Text>
                    <Text className="text-muted text-xs">{mp.clue || "Hidden somewhere..."}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity className="bg-primary/20 px-3 py-2 rounded-lg">
                <Text className="text-primary text-xs font-bold">Claim</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Legend */}
      <View className="bg-surface rounded-xl p-4 border border-border">
        <Text className="text-sm font-bold text-foreground mb-2">Legend</Text>
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <View className="w-3 h-3 rounded-full bg-primary" />
            <Text className="text-muted text-xs">You</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="w-3 h-3 rounded-full bg-error" />
            <Text className="text-muted text-xs">Target</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="w-3 h-3 rounded-full" style={{ backgroundColor: "#7B2FFF" }} />
            <Text className="text-muted text-xs">Power-Up</Text>
          </View>
          {showAllLocations && (
            <View className="flex-row items-center gap-2">
              <View className="w-3 h-3 rounded-full bg-warning" />
              <Text className="text-muted text-xs">All Players (Purge)</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
