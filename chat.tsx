import { Text, View, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";

export default function ChatScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated, user } = useAuth();
  const [message, setMessage] = useState("");

  const chatQuery = trpc.chat.messages.useQuery(
    { gameId: activeGameId!, limit: 100 },
    { enabled: !!activeGameId && isAuthenticated, refetchInterval: 3000 }
  );
  const sendMutation = trpc.chat.send.useMutation({
    onSuccess: () => {
      setMessage("");
      chatQuery.refetch();
    },
  });

  const messages = (chatQuery.data || []).slice().reverse();

  const handleSend = () => {
    if (!message.trim() || !activeGameId) return;
    sendMutation.mutate({ gameId: activeGameId, message: message.trim() });
  };

  if (!activeGameId || !isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center">
          <Text className="text-4xl mb-2">💬</Text>
          <Text className="text-foreground text-lg font-bold">Game Chat</Text>
          <Text className="text-muted text-sm mt-1">Join a game to chat with players</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="flex-1">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
        keyboardVerticalOffset={90}
      >
        {/* Header */}
        <View className="px-4 py-3 border-b border-border">
          <Text className="text-lg font-bold text-foreground">💬 Game Chat</Text>
          <Text className="text-muted text-xs">{messages.length} messages</Text>
        </View>

        {/* Messages */}
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          inverted={false}
          renderItem={({ item }) => {
            const isMe = item.userId === user?.id;
            const isSystem = item.isSystem;

            if (isSystem) {
              return (
                <View className="items-center py-2">
                  <View className="bg-surface/80 border border-primary/30 rounded-full px-4 py-2 flex-row items-center gap-2">
                    {(item as any).powerUpIcon && (
                      <Text className="text-lg">{(item as any).powerUpIcon}</Text>
                    )}
                    <Text className="text-primary text-xs font-semibold">{item.message}</Text>
                  </View>
                </View>
              );
            }

            return (
              <View className={`flex-row ${isMe ? "justify-end" : "justify-start"}`}>
                <View className={`max-w-[75%] rounded-2xl px-4 py-2 ${isMe ? "bg-primary" : "bg-surface border border-border"}`}>
                  {!isMe && (
                    <Text className="text-xs text-muted font-semibold mb-1">{(item as any).user?.name || `Player #${item.userId}`}</Text>
                  )}
                  <Text className={`text-sm ${isMe ? "text-background" : "text-foreground"}`}>{item.message}</Text>
                  <Text className={`text-xs mt-1 ${isMe ? "text-background/60" : "text-muted"}`}>
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {/* Input */}
        <View className="flex-row items-center gap-2 px-4 py-3 border-t border-border bg-surface">
          <TextInput
            className="flex-1 bg-background rounded-full px-4 py-2 text-foreground text-sm border border-border"
            placeholder="Type a message..."
            placeholderTextColor="#8B8B9E"
            value={message}
            onChangeText={setMessage}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            className="bg-primary w-10 h-10 rounded-full items-center justify-center"
            onPress={handleSend}
            disabled={!message.trim()}
          >
            <Text className="text-background font-bold">↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
