import { Text, View, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";

type SelectedVideo = { uri: string; fileName: string; mimeType: string; duration?: number | null };

type UploadSignature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
};

// Uploads straight to Cloudinary using a server-issued signature — the video
// never passes through our own API. On native, FormData can stream directly
// from the file URI instead of loading the whole video into JS memory.
async function uploadToCloudinary(video: SelectedVideo, signature: UploadSignature): Promise<string> {
  const formData = new FormData();
  if (Platform.OS === "web") {
    const response = await fetch(video.uri);
    if (!response.ok) throw new Error("Could not open the selected video");
    formData.append("file", await response.blob(), video.fileName);
  } else {
    formData.append("file", { uri: video.uri, name: video.fileName, type: video.mimeType } as any);
  }
  formData.append("api_key", signature.apiKey);
  formData.append("timestamp", String(signature.timestamp));
  formData.append("signature", signature.signature);
  formData.append("folder", signature.folder);

  const uploadResp = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/video/upload`, {
    method: "POST",
    body: formData,
  });
  if (!uploadResp.ok) {
    const errText = await uploadResp.text().catch(() => "");
    throw new Error(`Video upload failed${errText ? `: ${errText}` : ""}`);
  }
  const uploadJson = (await uploadResp.json()) as { secure_url?: string };
  if (!uploadJson.secure_url) throw new Error("Cloudinary did not return a video URL");
  return uploadJson.secure_url;
}

export default function EliminationUploadScreen() {
  const { activeGameId } = useGame();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const playerQuery = trpc.player.me.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId && isAuthenticated });
  const playersQuery = trpc.player.list.useQuery({ gameId: activeGameId! }, { enabled: !!activeGameId && isAuthenticated });
  const uploadSignatureMutation = trpc.storage.getEliminationUploadSignature.useMutation();
  const submitMutation = trpc.elimination.submit.useMutation({
    onSuccess: () => { setSubmitted(true); Alert.alert("Submitted!", "Your elimination video was uploaded and sent for admin review."); },
    onError: (error) => Alert.alert("Could not submit", error.message),
  });

  const player = playerQuery.data;
  const candidates = (playersQuery.data || []).filter(candidate => candidate.id !== player?.id && candidate.status === "alive");
  const label = (candidate: any) => candidate.user?.displayName?.trim() || candidate.user?.name?.trim() || `Player #${candidate.userId}`;

  const chooseVideo = async (record = false) => {
    const permission = record ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Permission needed", `Allow ${record ? "camera" : "photo library"} access to attach video evidence.`);
    const result = record
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], videoMaxDuration: 180, quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setVideo({ uri: asset.uri, fileName: asset.fileName || `elimination-${Date.now()}.mp4`, mimeType: asset.mimeType || "video/mp4", duration: asset.duration });
  };

  const submit = async () => {
    if (!activeGameId || !selectedPlayerId || !video) return;
    setUploading(true);
    try {
      const signature = await uploadSignatureMutation.mutateAsync({ gameId: activeGameId });
      const videoUrl = await uploadToCloudinary(video, signature);
      await submitMutation.mutateAsync({ gameId: activeGameId, eliminatedId: selectedPlayerId, videoUrl });
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View className="flex-row items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="mr-3"><Text className="text-primary text-lg">←</Text></TouchableOpacity>
          <View><Text className="text-xl font-bold text-foreground">🎬 Submit Elimination</Text><Text className="text-muted text-sm">Upload video evidence for admin review</Text></View>
        </View>
        {submitted ? (
          <View className="items-center py-12"><Text className="text-5xl mb-4">✅</Text><Text className="text-foreground text-xl font-bold">Submitted!</Text><TouchableOpacity className="bg-primary px-6 py-3 rounded-full mt-6" onPress={() => router.back()}><Text className="text-background font-bold">Back to Home</Text></TouchableOpacity></View>
        ) : (
          <>
            <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
              <Text className="text-xs text-error uppercase tracking-wider mb-2">Who was eliminated?</Text>
              {candidates.map(candidate => <TouchableOpacity key={candidate.id} onPress={() => setSelectedPlayerId(candidate.id)} className={`p-3 rounded-lg mb-2 border ${selectedPlayerId === candidate.id ? "border-error bg-error/10" : "border-border"}`}><Text className="text-foreground font-bold">{label(candidate)}</Text></TouchableOpacity>)}
              {!candidates.length && <Text className="text-muted">No eligible alive players are available.</Text>}
            </View>
            <View className="bg-surface rounded-xl p-6 mb-4 border border-border border-dashed items-center">
              <Text className="text-4xl mb-3">📹</Text>
              <Text className="text-foreground font-bold">{video ? video.fileName : "Attach Video Evidence"}</Text>
              {video?.duration != null && <Text className="text-muted mt-1">{Math.ceil(video.duration / 1000)} seconds</Text>}
              <View className="flex-row gap-3 mt-4"><TouchableOpacity className="bg-primary/20 border border-primary px-4 py-3 rounded-xl" onPress={() => chooseVideo(false)}><Text className="text-primary font-bold">Choose Video</Text></TouchableOpacity><TouchableOpacity className="bg-primary/20 border border-primary px-4 py-3 rounded-xl" onPress={() => chooseVideo(true)}><Text className="text-primary font-bold">Record Video</Text></TouchableOpacity></View>
            </View>
            <TouchableOpacity className={`py-4 rounded-xl items-center ${selectedPlayerId && video ? "bg-error" : "bg-surface border border-muted"}`} onPress={submit} disabled={!selectedPlayerId || !video || uploading}>
              {uploading ? <View className="flex-row gap-2"><ActivityIndicator color="#fff"/><Text className="text-background font-bold">Uploading video…</Text></View> : <Text className={selectedPlayerId && video ? "text-background font-bold" : "text-muted font-bold"}>Submit Elimination Claim</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
