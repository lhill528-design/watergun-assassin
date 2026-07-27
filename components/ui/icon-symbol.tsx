import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  "house.fill": "home",
  "map.fill": "map",
  "cart.fill": "shopping-cart",
  "person.fill": "person",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "gearshape.fill": "settings",
  "shield.fill": "shield",
  "bolt.fill": "flash-on",
  "target": "gps-fixed",
  "trophy.fill": "emoji-events",
  "video.fill": "videocam",
  "checkmark.circle.fill": "check-circle",
  "xmark.circle.fill": "cancel",
  "plus.circle.fill": "add-circle",
  "arrow.clockwise": "refresh",
  "exclamationmark.triangle.fill": "warning",
  "star.fill": "star",
  "location.fill": "location-on",
  "clock.fill": "access-time",
  "lock.fill": "lock",
  "eye.fill": "visibility",
  "eye.slash.fill": "visibility-off",
  "heart.fill": "favorite",
  "flame.fill": "whatshot",
  "list.bullet": "list",
  "square.grid.2x2.fill": "grid-view",
  "dollarsign.circle.fill": "monetization-on",
  "person.2.fill": "people",
  "crown.fill": "workspace-premium",
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
