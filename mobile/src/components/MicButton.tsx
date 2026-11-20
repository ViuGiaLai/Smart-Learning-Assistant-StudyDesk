/**
 * MicButton – nút micro với 3 trạng thái:
 *  idle      → icon microphone tĩnh
 *  listening → icon glow đỏ nhấp nháy + ripple animation
 *  processing→ spinner nhỏ
 */
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from "react-native";

import type { SpeechState } from "../hooks/useSpeechRecognition";
import { palette } from "../theme";

interface MicButtonProps {
  state: SpeechState;
  onPress: () => void;
  disabled?: boolean;
}

export function MicButton({ state, onPress, disabled }: MicButtonProps) {
  const ripple = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (state === "listening") {
      animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ripple, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(rippleOpacity, { toValue: 0.5, duration: 350, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ripple, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(rippleOpacity, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]),
        ]),
      );
      animation.start();
    } else {
      ripple.setValue(0);
      rippleOpacity.setValue(0);
    }
    return () => { if (animation) animation.stop(); };
  }, [state, ripple, rippleOpacity]);

  const scale = ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });

  const isListening = state === "listening";
  const isProcessing = state === "processing";
  const bgColor = isListening ? "#EF4444" : "#F1F5F9";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || isProcessing}
      style={({ pressed }) => [styles.wrapper, pressed && styles.pressed]}
      accessibilityLabel={isListening ? "Dừng nghe" : "Nhấn để nói"}
      accessibilityRole="button"
    >
      {/* Ripple glow khi đang nghe */}
      {isListening && (
        <Animated.View
          style={[
            styles.ripple,
            { transform: [{ scale }], opacity: rippleOpacity, backgroundColor: "#EF4444" },
          ]}
        />
      )}

      <View style={[styles.btn, { backgroundColor: bgColor }]}>
        {isProcessing ? (
          <ActivityIndicator size={16} color={palette.primary} />
        ) : (
          <MaterialCommunityIcons
            name={isListening ? "microphone" : "microphone"}
            size={18}
            color={isListening ? "#FFFFFF" : palette.muted}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  ripple: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: 17,
  },
});
