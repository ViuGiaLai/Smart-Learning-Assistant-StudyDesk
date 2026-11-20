import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef } from "react";
import { Animated } from "react-native";

export function FanIcon({
  spinning,
  size = 24,
  color,
}: {
  spinning: boolean;
  size?: number;
  color?: string;
}) {
  const spinRef = useRef(new Animated.Value(0));
  const spin = spinRef.current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (spinning) {
      animation = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: false,
        }),
      );
      animation.start();
    } else {
      spin.setValue(0);
    }
    return () => {
      if (animation) animation.stop();
    };
  }, [spinning, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <MaterialCommunityIcons
        name={spinning ? "fan" : "fan-off"}
        size={size}
        color={color}
      />
    </Animated.View>
  );
}
