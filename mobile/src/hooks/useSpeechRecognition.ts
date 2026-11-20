/**
 * useSpeechRecognition – wrapper thống nhất cho expo-speech-recognition.
 * Dùng ExpoSpeechRecognitionModule trực tiếp, tương thích cả Android/iOS native
 * và Expo Go web preview.
 */
import { useCallback, useRef, useState } from "react";

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

export type SpeechState = "idle" | "listening" | "processing";

interface UseSpeechRecognitionResult {
  state: SpeechState;
  transcript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  reset: () => void;
  supported: boolean;
}

export function useSpeechRecognition(
  onFinalResult: (text: string) => void,
): UseSpeechRecognitionResult {
  const [state, setState] = useState<SpeechState>("idle");
  const [transcript, setTranscript] = useState("");
  const partialRef = useRef("");

  // Event: nhận kết quả (partial + final)
  useSpeechRecognitionEvent("result", (event) => {
    const best = event.results[0]?.transcript ?? "";
    partialRef.current = best;
    setTranscript(best);
    if (event.isFinal) {
      setState("processing");
      onFinalResult(best);
    }
  });

  // Event: lỗi (hết giờ, bị từ chối quyền, v.v.)
  useSpeechRecognitionEvent("error", (event) => {
    console.warn("[Speech] error:", event.error, event.message);
    setState("idle");
    setTranscript("");
  });

  // Event: kết thúc phiên (end được gọi sau final hoặc sau abort)
  useSpeechRecognitionEvent("end", () => {
    setState((prev) => (prev === "listening" ? "idle" : prev));
  });

  const startListening = useCallback(async () => {
    // Xin quyền mic
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      console.warn("[Speech] Microphone permission denied");
      return;
    }
    setTranscript("");
    partialRef.current = "";
    setState("listening");
    ExpoSpeechRecognitionModule.start({
      lang: "vi-VN",
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
    });
  }, []);

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setState("idle");
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setTranscript("");
    partialRef.current = "";
  }, []);

  return {
    state,
    transcript,
    startListening,
    stopListening,
    reset,
    supported: true,
  };
}
