import { Text, View, FlatList, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";

export default function NotificationsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const notifQuery = trpc.notification.list.useQuery(undefined, { enabled: isAuthenticated });
  const markAllMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => notifQuery.refetch(),
  });
  const markOneMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => notifQuery.refetch(),
  });

  const notifications = notifQuery.data || [];
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const getIcon = (type: string) => {
    switch (type) {
      case "new_target": return "🎯";
      case "purge_start": return "⚠️";
      case "elimination_approved": return "💀";
      case "elimination_denied": return "❌";
      case "elimination_result": return "☠️";
      case "elimination_pending": return "📹";
      case "bounty": return "💰";
      case "location_disabled": return "📍";
      default: return "🔔";
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
            <Text className="text-primary text-base">← Back</Text>
          </TouchableOpacity>
          <Text className="text-foreground text-xl font-bold ml-2">🔔 Notifications</Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAllMutation.mutate()} style={{ padding: 8 }}>
            <Text className="text-primary text-sm">Mark All Read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-4xl mb-2">🔕</Text>
            <Text className="text-muted text-base">No notifications yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            className={`rounded-xl p-4 mb-2 flex-row gap-3 ${item.isRead ? "bg-surface" : "bg-primary/10 border border-primary/20"}`}
            onPress={() => { if (!item.isRead) markOneMutation.mutate({ id: item.id }); }}
          >
            <Text className="text-2xl">{getIcon(item.type)}</Text>
            <View className="flex-1">
              <Text className={`font-bold text-sm ${item.isRead ? "text-muted" : "text-foreground"}`}>{item.title}</Text>
              <Text className="text-muted text-xs mt-1">{item.body}</Text>
              <Text className="text-muted text-xs mt-1 opacity-50">
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </View>
            {!item.isRead && (
              <View className="w-2 h-2 rounded-full bg-primary mt-2" />
            )}
          </TouchableOpacity>
        )}
      />
    </ScreenContainer>
  );
}
