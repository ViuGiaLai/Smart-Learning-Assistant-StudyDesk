import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

/**
 * Bóng đèn phát sáng khi bật:
 *  - Vòng hào quang (glow ring) lớn dần rồi mờ dần lặp đi lặp lại
 *  - Icon sáng (lightbulb-on) + màu vàng-cam ấm khi bật
 *  - Icon tắt (lightbulb-outline) + xám khi tắt
 */
export function LightIcon({
  on,
  size = 24,
  color,
}: {
  on: boolean;
  size?: number;
  color?: string;
}) {
  const glowScale = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (on) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glowScale, {
              toValue: 2.4,
              duration: 900,
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacity, {
              toValue: 0.45,
              duration: 450,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(glowScale, {
              toValue: 2.4,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacity, {
              toValue: 0,
              duration: 450,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
      animation.start();
    } else {
      glowScale.setValue(1);
      glowOpacity.setValue(0);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [on, glowScale, glowOpacity]);

  const glowColor = "#F59E0B"; // amber / vàng ấm

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Vòng hào quang phát sáng */}
      {on && (
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: glowColor,
            transform: [{ scale: glowScale }],
            opacity: glowOpacity,
          }}
        />
      )}
      {/* Icon bóng đèn */}
      <MaterialCommunityIcons
        name={on ? "lightbulb-on" : "lightbulb-outline"}
        size={size}
        color={color}
      />
    </View>
  );
}
