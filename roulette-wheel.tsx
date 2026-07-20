import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, Easing, Dimensions } from "react-native";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const WHEEL_SIZE = Math.min(SCREEN_WIDTH - 80, 300);

interface RouletteOutcome {
  id: number;
  name: string;
  emoji: string;
  type: string;
  value: number | null;
  weight: number;
  description: string | null;
}

interface RouletteWheelProps {
  outcomes: RouletteOutcome[];
  onSpinComplete: (outcome: RouletteOutcome) => void;
  spinning: boolean;
  result: RouletteOutcome | null;
}

const SEGMENT_COLORS = [
  "#FF1493", "#00D4FF", "#FFD700", "#00FF88",
  "#FF6B35", "#9B59B6", "#E74C3C", "#3498DB",
  "#2ECC71", "#F39C12", "#1ABC9C", "#E91E63",
];

export function RouletteWheel({ outcomes, onSpinComplete, spinning, result }: RouletteWheelProps) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [finalDegree, setFinalDegree] = useState(0);
  const [hasSpun, setHasSpun] = useState(false);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (spinning && result) {
      setHasSpun(true);
      setShowResult(false);
      const winIndex = outcomes.findIndex(o => o.id === result.id);
      const segmentAngle = 360 / outcomes.length;
      // Spin 5 full rotations + land on the winning segment
      const targetAngle = 360 * 5 + (360 - (winIndex * segmentAngle + segmentAngle / 2));
      setFinalDegree(targetAngle);

      spinAnim.setValue(0);
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 4000,
        easing: Easing.bezier(0.2, 0.8, 0.3, 1),
        useNativeDriver: true,
      }).start(() => {
        setShowResult(true);
        onSpinComplete(result);
      });
    }
  }, [spinning, result]);

  const rotation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", `${finalDegree}deg`],
  });

  if (outcomes.length === 0) {
    return (
      <View className="items-center justify-center p-8">
        <Text className="text-muted text-center">No roulette outcomes configured for this game.</Text>
      </View>
    );
  }

  const segmentAngle = 360 / outcomes.length;

  return (
    <View className="items-center">
      {/* Pointer */}
      <View style={{ zIndex: 10, marginBottom: -12 }}>
        <Text style={{ fontSize: 28, color: "#FF1493" }}>▼</Text>
      </View>

      {/* Wheel */}
      <Animated.View
        style={{
          width: WHEEL_SIZE,
          height: WHEEL_SIZE,
          borderRadius: WHEEL_SIZE / 2,
          transform: [{ rotate: rotation }],
          overflow: "hidden",
          borderWidth: 4,
          borderColor: "#FF1493",
          backgroundColor: "#1a1a2e",
        }}
      >
        {/* Segment labels positioned radially */}
        {outcomes.map((outcome, index) => {
          const angle = index * segmentAngle;
          const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

          return (
            <View
              key={outcome.id}
              style={{
                position: "absolute",
                width: WHEEL_SIZE,
                height: WHEEL_SIZE,
                justifyContent: "flex-start",
                alignItems: "center",
                transform: [{ rotate: `${angle + segmentAngle / 2}deg` }],
              }}
            >
              <View style={{ paddingTop: 14, alignItems: "center", width: 50 }}>
                <Text style={{ fontSize: 16 }}>{outcome.emoji}</Text>
                <Text
                  style={{
                    fontSize: 7,
                    fontWeight: "bold",
                    color: "#fff",
                    textAlign: "center",
                    textShadowColor: "rgba(0,0,0,0.9)",
                    textShadowOffset: { width: 1, height: 1 },
                    textShadowRadius: 3,
                  }}
                  numberOfLines={1}
                >
                  {outcome.name}
                </Text>
              </View>
            </View>
          );
        })}

        {/* Colored segment backgrounds */}
        {outcomes.map((_, index) => {
          const startAngle = index * segmentAngle;
          const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
          return (
            <View
              key={`seg-${index}`}
              style={{
                position: "absolute",
                top: 0,
                left: WHEEL_SIZE / 2 - 1,
                width: WHEEL_SIZE / 2,
                height: WHEEL_SIZE / 2,
                backgroundColor: color,
                transformOrigin: "bottom left",
                transform: [{ rotate: `${startAngle}deg` }, { skewY: `${segmentAngle - 90}deg` }],
                opacity: 0.8,
                zIndex: -1,
              }}
            />
          );
        })}

        {/* Center circle */}
        <View
          style={{
            position: "absolute",
            top: WHEEL_SIZE / 2 - 25,
            left: WHEEL_SIZE / 2 - 25,
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: "#1a1a2e",
            borderWidth: 3,
            borderColor: "#FF1493",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 10,
          }}
        >
          <Text style={{ fontSize: 20 }}>🎰</Text>
        </View>
      </Animated.View>

      {/* Result Display */}
      {hasSpun && showResult && result && (
        <View className="mt-4 bg-surface rounded-xl p-4 border border-primary items-center w-full">
          <Text style={{ fontSize: 40 }}>{result.emoji}</Text>
          <Text className="text-foreground text-xl font-bold mt-2">{result.name}</Text>
          {result.description && (
            <Text className="text-muted text-sm text-center mt-1">{result.description}</Text>
          )}
          {result.type === "points_bonus" && result.value && (
            <Text className="text-success font-bold mt-1">+{result.value} points!</Text>
          )}
          {result.type === "points_penalty" && result.value && (
            <Text className="text-error font-bold mt-1">-{result.value} points!</Text>
          )}
          {result.type === "discount_coupon" && result.value && (
            <Text className="text-warning font-bold mt-1">{result.value}% off next purchase!</Text>
          )}
        </View>
      )}
    </View>
  );
}
