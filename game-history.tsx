import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "Unknown date";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function gameTypeLabel(type: string): string {
  switch (type) {
    case "last_man_standing": return "Last Man Standing";
    case "highest_points":   return "Highest Points";
    case "most_eliminations": return "Most Eliminations";
    case "teams":            return "Teams";
    default:                 return type;
  }
}

function statusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case "alive":      return { label: "Survived", color: "#00FF88" };
    case "eliminated": return { label: "Eliminated", color: "#FF4444" };
    case "safe":       return { label: "Safe", color: "#FFD700" };
    default:           return { label: status, color: "#9BA1A6" };
  }
}

// ─── Detail Modal ────────────────────────────────────────────────────────────

function HistoryDetailModal({
  gameId,
  visible,
  onClose,
}: {
  gameId: number | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = trpc.game.historyDetail.useQuery(
    { gameId: gameId! },
    { enabled: visible && gameId !== null }
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {data?.game?.name ?? "Game Details"}
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color="#FF2D78" size="large" style={{ marginTop: 40 }} />
        ) : !data ? (
          <Text style={styles.emptyText}>Could not load game details.</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.modalContent}>
            {/* Game info */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📋 Game Info</Text>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Type: </Text>
                {gameTypeLabel(data.game?.gameType ?? "")}
              </Text>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Completed: </Text>
                {formatDate(data.game?.updatedAt)}
              </Text>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Round: </Text>
                {data.game?.currentRound ?? 0}
              </Text>
            </View>

            {/* My stats */}
            {data.myPlayer && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>🎯 Your Stats</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{data.myPlayer.kills ?? 0}</Text>
                    <Text style={styles.statLabel}>Kills</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{data.myPlayer.deaths ?? 0}</Text>
                    <Text style={styles.statLabel}>Deaths</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{data.myPlayer.points ?? 0}</Text>
                    <Text style={styles.statLabel}>Points</Text>
                  </View>
                </View>
                {(() => {
                  const badge = statusBadge(data.myPlayer.status ?? "");
                  return (
                    <View style={[styles.statusBadge, { borderColor: badge.color }]}>
                      <Text style={[styles.statusBadgeText, { color: badge.color }]}>
                        {badge.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
            )}

            {/* Leaderboard */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🏆 Final Leaderboard</Text>
              {(data.leaderboard ?? []).slice(0, 10).map((p: any, i: number) => (
                <View key={p.id} style={styles.leaderRow}>
                  <Text style={styles.rankText}>#{i + 1}</Text>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {p.user?.name ?? "Unknown"}
                  </Text>
                  <View style={styles.leaderStats}>
                    <Text style={styles.leaderStat}>💀 {p.kills ?? 0}</Text>
                    <Text style={styles.leaderStat}>⭐ {p.points ?? 0}</Text>
                  </View>
                </View>
              ))}
              {(data.leaderboard ?? []).length === 0 && (
                <Text style={styles.emptyText}>No player data.</Text>
              )}
            </View>

            {/* Kill Feed highlights */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>📰 Kill Feed Highlights</Text>
              {(data.killFeed ?? []).slice(0, 15).map((event: any) => (
                <View key={event.id} style={styles.feedRow}>
                  <Text style={styles.feedText}>{event.message}</Text>
                  <Text style={styles.feedTime}>{formatDate(event.createdAt)}</Text>
                </View>
              ))}
              {(data.killFeed ?? []).length === 0 && (
                <Text style={styles.emptyText}>No events recorded.</Text>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function GameHistoryScreen() {
  const router = useRouter();
  const { data: games, isLoading } = trpc.game.history.useQuery();
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  function openDetail(gameId: number) {
    setSelectedGameId(gameId);
    setModalVisible(true);
  }

  function renderGame({ item }: { item: any }) {
    const myPlayer = item.myPlayer;
    const badge = myPlayer ? statusBadge(myPlayer.status ?? "") : null;

    return (
      <TouchableOpacity
        style={styles.gameCard}
        onPress={() => openDetail(item.id)}
        activeOpacity={0.75}
      >
        {/* Title row */}
        <View style={styles.gameCardHeader}>
          <Text style={styles.gameName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.gameDate}>{formatDate(item.updatedAt)}</Text>
        </View>

        {/* Type + round */}
        <Text style={styles.gameType}>{gameTypeLabel(item.gameType)}</Text>

        {/* Player stats row */}
        {myPlayer ? (
          <View style={styles.playerStatsRow}>
            <Text style={styles.playerStat}>💀 {myPlayer.kills ?? 0} kills</Text>
            <Text style={styles.playerStat}>⭐ {myPlayer.points ?? 0} pts</Text>
            <Text style={styles.playerStat}>☠️ {myPlayer.deaths ?? 0} deaths</Text>
            {badge && (
              <View style={[styles.inlineBadge, { borderColor: badge.color }]}>
                <Text style={[styles.inlineBadgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.adminNote}>Admin only</Text>
        )}

        <Text style={styles.tapHint}>Tap for details →</Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Game History</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#FF2D78" size="large" style={{ marginTop: 40 }} />
      ) : !games || games.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏁</Text>
          <Text style={styles.emptyHeading}>No completed games yet</Text>
          <Text style={styles.emptySubtext}>
            Finished games will appear here once they end.
          </Text>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderGame}
          contentContainerStyle={styles.listContent}
        />
      )}

      <HistoryDetailModal
        gameId={selectedGameId}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </ScreenContainer>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e2022",
    backgroundColor: "#0d0d0d",
  },
  backBtn: { marginRight: 12 },
  backBtnText: { color: "#FF2D78", fontSize: 15, fontWeight: "600" },
  headerTitle: { color: "#ECEDEE", fontSize: 20, fontWeight: "700" },

  listContent: { padding: 16, gap: 12 },

  gameCard: {
    backgroundColor: "#1e2022",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 12,
  },
  gameCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  gameName: { color: "#ECEDEE", fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  gameDate: { color: "#9BA1A6", fontSize: 12 },
  gameType: { color: "#00E5FF", fontSize: 13, marginBottom: 8 },
  playerStatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  playerStat: { color: "#9BA1A6", fontSize: 13 },
  inlineBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inlineBadgeText: { fontSize: 11, fontWeight: "600" },
  adminNote: { color: "#687076", fontSize: 12, marginBottom: 8 },
  tapHint: { color: "#FF2D78", fontSize: 12, textAlign: "right" },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyHeading: { color: "#ECEDEE", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptySubtext: { color: "#9BA1A6", fontSize: 14, textAlign: "center" },
  emptyText: { color: "#9BA1A6", fontSize: 13, textAlign: "center", marginTop: 8 },

  // Modal
  modalContainer: { flex: 1, backgroundColor: "#0d0d0d" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e2022",
    backgroundColor: "#0d0d0d",
  },
  closeBtn: { marginRight: 12 },
  closeBtnText: { color: "#FF2D78", fontSize: 15, fontWeight: "600" },
  modalTitle: { color: "#ECEDEE", fontSize: 18, fontWeight: "700", flex: 1 },
  modalContent: { padding: 16, gap: 16 },

  card: {
    backgroundColor: "#1e2022",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  cardTitle: { color: "#FF2D78", fontSize: 15, fontWeight: "700", marginBottom: 12 },
  detailRow: { color: "#9BA1A6", fontSize: 13, marginBottom: 4 },
  detailLabel: { color: "#ECEDEE", fontWeight: "600" },

  statsRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 12 },
  statBox: { alignItems: "center" },
  statValue: { color: "#FF2D78", fontSize: 24, fontWeight: "700" },
  statLabel: { color: "#9BA1A6", fontSize: 12, marginTop: 2 },

  statusBadge: {
    alignSelf: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginTop: 4,
  },
  statusBadgeText: { fontSize: 13, fontWeight: "700" },

  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  rankText: { color: "#FFD700", fontSize: 14, fontWeight: "700", width: 32 },
  playerName: { color: "#ECEDEE", fontSize: 14, flex: 1 },
  leaderStats: { flexDirection: "row", gap: 10 },
  leaderStat: { color: "#9BA1A6", fontSize: 13 },

  feedRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#1e2022",
  },
  feedText: { color: "#ECEDEE", fontSize: 13 },
  feedTime: { color: "#687076", fontSize: 11, marginTop: 2 },
});
