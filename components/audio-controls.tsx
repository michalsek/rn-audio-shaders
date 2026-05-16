import type { AudioSource, MicStatus } from "@/audio/types";
import { Pressable, StyleSheet, Text, View } from "react-native";

type AudioControlsProps = {
  audioSource: AudioSource;
  micStatus: MicStatus;
  micMessage: string;
  isListening: boolean;
  selectSource: (nextSource: AudioSource) => Promise<void>;
  startActiveSource: () => Promise<void>;
  stopActiveSource: () => Promise<void>;
};

export function AudioControls({
  audioSource,
  micStatus,
  micMessage,
  isListening,
  selectSource,
  startActiveSource,
  stopActiveSource,
}: AudioControlsProps) {
  const buttonLabel =
    micStatus === "listening"
      ? audioSource === "microphone"
        ? "Stop mic"
        : "Stop sample"
      : micStatus === "starting"
        ? "Starting"
        : audioSource === "microphone"
          ? "Start mic"
          : "Play sample";

  return (
    <View style={styles.controls}>
      <View style={styles.sourceToggle}>
        <Pressable
          accessibilityRole="button"
          disabled={micStatus === "starting"}
          onPress={() => selectSource("microphone")}
          style={[
            styles.sourceButton,
            audioSource === "microphone" && styles.sourceButtonActive,
          ]}
        >
          <Text
            style={[
              styles.sourceButtonText,
              audioSource === "microphone" && styles.sourceButtonTextActive,
            ]}
          >
            Mic
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={micStatus === "starting"}
          onPress={() => selectSource("voiceSample")}
          style={[
            styles.sourceButton,
            audioSource === "voiceSample" && styles.sourceButtonActive,
          ]}
        >
          <Text
            style={[
              styles.sourceButtonText,
              audioSource === "voiceSample" && styles.sourceButtonTextActive,
            ]}
          >
            Sample
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={micStatus === "starting"}
        onPress={isListening ? stopActiveSource : startActiveSource}
        style={({ pressed }) => [
          styles.button,
          isListening && styles.buttonActive,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
      {micMessage ? <Text style={styles.statusText}>{micMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 28,
    alignItems: "center",
    gap: 10,
  },
  sourceToggle: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  sourceButton: {
    minWidth: 68,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    paddingHorizontal: 10,
  },
  sourceButtonActive: {
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  sourceButtonText: {
    color: "rgba(255, 255, 255, 0.76)",
    fontSize: 13,
    fontWeight: "700",
  },
  sourceButtonTextActive: {
    color: "#11181c",
  },
  button: {
    minWidth: 112,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderColor: "rgba(255, 255, 255, 0.32)",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
  },
  buttonActive: {
    backgroundColor: "rgba(255, 114, 64, 0.72)",
    borderColor: "rgba(255, 202, 160, 0.9)",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  statusText: {
    color: "rgba(255, 255, 255, 0.84)",
    fontSize: 13,
  },
});
