import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useGame } from "@/lib/game-context";
import { useRouter } from "expo-router";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type StatusFilter = "all" | "pending" | "paid" | "waived";

export default function AdminFeesScreen() {
  const router = useRouter();
  const { activeGameId } = useGame();
  const [filter, setFilter] = useState<StatusFilter>("pending");

  const feesQuery = trpc.powerUp.pendingFees.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId, refetchInterval: 15000 }
  );
  const resolveFeeMutation = trpc.powerUp.resolveFee.useMutation({
    onSuccess: () => feesQuery.refetch(),
  });

  const allFees = feesQuery.data ?? [];
  const filtered = filter === "all" ? allFees : allFees.filter(f => f.status === filter);

  const pendingCount = allFees.filter(f => f.status === "pending").length;

  function handleResolve(feeId: number, status: "paid" | "waived") {
    const label = status === "paid" ? "Mark Paid" : "Waive Fee";
    Alert.alert(label, `${label} this fee?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: label,
        style: status === "waived" ? "destructive" : "default",
        onPress: () => resolveFeeMutation.mutate({ feeId, gameId: activeGameId!, status }),
      },
    ]);
  }

  function statusColor(status: string): string {
    switch (status) {
      case "pending": return "#FFD700";
      case "paid":    return "#00FF88";
      case "waived":  return "#9BA1A6";
      default:        return "#9BA1A6";
    }
  }

  function renderFee({ item }: { item: any }) {
    const isPending = item.status === "pending";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.playerName}>{item.playerName}</Text>
          <View style={[styles.badge, { borderColor: statusColor(item.status) }]}>
            <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.powerUpName}>🎮 {item.powerUpName}</Text>
        <Text style={styles.amount}>{formatCents(item.amountCents)}</Text>
        <Text style={styles.date}>Created: {formatDate(item.createdAt)}</Text>
        {item.resolvedAt && (
          <Text style={styles.date}>Resolved: {formatDate(item.resolvedAt)}</Text>
        )}
        {item.note ? <Text style={styles.note}>Note: {item.note}</Text> : null}

        {isPending && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.paidBtn]}
              onPress={() => handleResolve(item.id, "paid")}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnText}>✓ Mark Paid</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.waiveBtn]}
              onPress={() => handleResolve(item.id, "waived")}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnText}>✗ Waive</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          Fee Queue {pendingCount > 0 ? `(${pendingCount} pending)` : ""}
        </Text>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(["pending", "paid", "waived", "all"] as StatusFilter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!activeGameId ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyHeading}>No active game selected</Text>
        </View>
      ) : feesQuery.isLoading ? (
        <ActivityIndicator color="#FF2D78" size="large" style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💸</Text>
          <Text style={styles.emptyHeading}>
            {filter === "pending" ? "No pending fees" : `No ${filter} fees`}
          </Text>
          <Text style={styles.emptySubtext}>
            {filter === "pending"
              ? "When players activate power-ups with cash fees, they appear here."
              : "Nothing to show for this filter."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderFee}
          contentContainerStyle={styles.listContent}
        />
      )}
    </ScreenContainer>
  );
}

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
  headerTitle: { color: "#ECEDEE", fontSize: 18, fontWeight: "700", flex: 1 },

  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: "#0d0d0d",
    borderBottomWidth: 1,
    borderBottomColor: "#1e2022",
  },
  filterTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  filterTabActive: { backgroundColor: "#FF2D78", borderColor: "#FF2D78" },
  filterTabText: { color: "#9BA1A6", fontSize: 12, fontWeight: "600" },
  filterTabTextActive: { color: "#fff" },

  listContent: { padding: 16, gap: 12 },

  card: {
    backgroundColor: "#1e2022",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  playerName: { color: "#ECEDEE", fontSize: 16, fontWeight: "700" },
  badge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  powerUpName: { color: "#00E5FF", fontSize: 14, marginBottom: 4 },
  amount: { color: "#FF2D78", fontSize: 22, fontWeight: "700", marginBottom: 4 },
  date: { color: "#687076", fontSize: 12, marginBottom: 2 },
  note: { color: "#9BA1A6", fontSize: 12, marginTop: 4, fontStyle: "italic" },

  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  paidBtn: { backgroundColor: "#00FF88" },
  waiveBtn: { backgroundColor: "#334155" },
  actionBtnText: { color: "#0d0d0d", fontSize: 14, fontWeight: "700" },

  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyHeading: { color: "#ECEDEE", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptySubtext: { color: "#9BA1A6", fontSize: 13, textAlign: "center" },
});
