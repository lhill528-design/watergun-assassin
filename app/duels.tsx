import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { playerLabel } from "@/lib/player-label";

export default function DuelsScreen() {
  const router = useRouter();
  const { activeGameId } = useGame();
  const [witnesses, setWitnesses] = useState<Record<number, string>>({});
  const [winners, setWinners] = useState<Record<number, number>>({});
  const meQuery = trpc.player.me.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const playersQuery = trpc.player.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const inventoryQuery = trpc.powerUp.inventory.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId });
  const duelsQuery = trpc.duel.mine.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId, refetchInterval: 15000 });
  const chooseStake = trpc.duel.chooseStake.useMutation({ onSuccess: () => duelsQuery.refetch(), onError: error => Alert.alert("Could not lock stake", error.message) });
  const submitResult = trpc.duel.submitResult.useMutation({ onSuccess: () => { duelsQuery.refetch(); Alert.alert("Result submitted", "The admin will approve or reject the proposed winner."); }, onError: error => Alert.alert("Could not submit", error.message) });
  const me = meQuery.data;
  const inventory = inventoryQuery.data || [];
  const players = playersQuery.data || [];
  // challengerId/opponentId are gamePlayers.id (used to find the right
  // row here); the *displayed* fallback must be the found player's
  // userId, never that gamePlayers.id itself -- playerLabel handles this.
  const name = (id: number) => playerLabel(players.find(candidate => candidate.id === id));
  return <ScreenContainer edges={["top", "left", "right", "bottom"]}><ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
    <TouchableOpacity onPress={() => router.back()}><Text className="text-primary text-lg mb-5">← Back</Text></TouchableOpacity><Text className="text-foreground text-2xl font-bold mb-4">🎯 Sniper's Duels</Text>
    {(duelsQuery.data || []).map(duel => {
      const isOpponent = duel.opponentId === me?.id;
      const minimum = (duel as any).challengerStake?.powerUp?.cost || 0;
      return <View key={duel.id} className="bg-surface border border-warning rounded-xl p-4 mb-4"><Text className="text-foreground font-bold mb-1">{name(duel.challengerId)} vs {name(duel.opponentId)}</Text><Text className="text-muted text-xs mb-3">Status: {duel.status.replace(/_/g, " ")}</Text>
        {isOpponent && duel.status === "awaiting_opponent_stake" && <><Text className="text-muted mb-2">Choose an unused stake worth at least {minimum} points:</Text><View className="gap-2">{inventory.filter(item => item.status === "inventory" && !item.lockedForDuelId && item.powerUp?.name !== "Sniper's Duel" && (item.powerUp?.cost || 0) >= minimum).map(item => <TouchableOpacity key={item.id} className="border border-primary rounded-lg p-3" onPress={() => chooseStake.mutate({ gameId: activeGameId!, duelId: duel.id, inventoryId: item.id })}><Text className="text-primary font-bold">Lock {item.powerUp?.name} ({item.powerUp?.cost} pts)</Text></TouchableOpacity>)}</View></>}
        {!isOpponent && duel.status === "awaiting_result" && <><Text className="text-muted mb-2">Select the real-world winner:</Text><View className="flex-row gap-2 mb-3">{[duel.challengerId, duel.opponentId].map(id => <TouchableOpacity key={id} className={`flex-1 p-3 rounded-lg border ${winners[duel.id] === id ? "bg-primary border-primary" : "border-border"}`} onPress={() => setWinners(current => ({ ...current, [duel.id]: id }))}><Text className="text-foreground font-bold">{name(id)}</Text></TouchableOpacity>)}</View><TextInput className="bg-background border border-border rounded-lg p-3 text-foreground mb-3" placeholder="Witness name (or upload duel video through admin workflow)" placeholderTextColor="#777" value={witnesses[duel.id] || ""} onChangeText={value => setWitnesses(current => ({ ...current, [duel.id]: value }))}/><TouchableOpacity className="bg-primary rounded-lg p-3 items-center" onPress={() => submitResult.mutate({ gameId: activeGameId!, duelId: duel.id, proposedWinnerId: winners[duel.id], witnessName: witnesses[duel.id] })} disabled={!winners[duel.id] || !witnesses[duel.id]?.trim()}><Text className="text-background font-bold">Submit Winner for Admin Review</Text></TouchableOpacity></>}
        {duel.status === "pending_review" && <Text className="text-warning">Waiting for admin review.</Text>}{duel.status === "resolved" && <Text className="text-success">Winner: {name(duel.winnerId!)}</Text>}{duel.status === "rejected" && <Text className="text-error">Result rejected; both stakes were unlocked.</Text>}
      </View>;
    })}
    {!duelsQuery.data?.length && <Text className="text-muted text-center py-12">No duels yet.</Text>}
  </ScrollView></ScreenContainer>;
}
