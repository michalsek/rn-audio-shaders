import type { AudioSource, MicStatus } from "@/audio/types";
import { SHADER_EFFECT_OPTIONS, type ShaderEffect } from "@/shaderEffects";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type AudioControlsProps = {
  selectedEffect: ShaderEffect;
  audioSource: AudioSource;
  micStatus: MicStatus;
  micMessage: string;
  isListening: boolean;
  selectEffect: (nextEffect: ShaderEffect) => void;
  selectSource: (nextSource: AudioSource) => Promise<void>;
  startActiveSource: () => Promise<void>;
  stopActiveSource: () => Promise<void>;
};

export function AudioControls({
  selectedEffect,
  audioSource,
  micStatus,
  micMessage,
  isListening,
  selectEffect,
  selectSource,
  startActiveSource,
  stopActiveSource,
}: AudioControlsProps) {
  const [isEffectSelectOpen, setIsEffectSelectOpen] = useState(false);
  const selectedEffectLabel =
    SHADER_EFFECT_OPTIONS.find((effect) => effect.value === selectedEffect)
      ?.label ?? selectedEffect;
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
      <View style={styles.effectSelect}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: isEffectSelectOpen }}
          onPress={() => setIsEffectSelectOpen((isOpen) => !isOpen)}
          style={({ pressed }) => [
            styles.selectButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.selectButtonText}>
            Effect: {selectedEffectLabel}
          </Text>
          <Text style={styles.selectChevron}>v</Text>
        </Pressable>
        {isEffectSelectOpen ? (
          <View style={styles.selectMenu}>
            {SHADER_EFFECT_OPTIONS.map((effect) => (
              <Pressable
                key={effect.value}
                accessibilityRole="button"
                onPress={() => {
                  selectEffect(effect.value);
                  setIsEffectSelectOpen(false);
                }}
                style={[
                  styles.selectOption,
                  selectedEffect === effect.value && styles.selectOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    selectedEffect === effect.value &&
                      styles.selectOptionTextActive,
                  ]}
                >
                  {effect.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.segmentedControl}>
        <Pressable
          accessibilityRole="button"
          disabled={micStatus === "starting"}
          onPress={() => selectSource("microphone")}
          style={[
            styles.segmentedButton,
            audioSource === "microphone" && styles.segmentedButtonActive,
          ]}
        >
          <Text
            style={[
              styles.segmentedButtonText,
              audioSource === "microphone" && styles.segmentedButtonTextActive,
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
            styles.segmentedButton,
            audioSource === "voiceSample" && styles.segmentedButtonActive,
          ]}
        >
          <Text
            style={[
              styles.segmentedButtonText,
              audioSource === "voiceSample" &&
                styles.segmentedButtonTextActive,
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
  effectSelect: {
    position: "relative",
    zIndex: 2,
  },
  selectButton: {
    minWidth: 218,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  selectButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  selectChevron: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 12,
  },
  selectMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 44,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(25, 34, 39, 0.98)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectOption: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  selectOptionActive: {
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  selectOptionText: {
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 14,
    fontWeight: "700",
  },
  selectOptionTextActive: {
    color: "#11181c",
  },
  segmentedControl: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segmentedButton: {
    minWidth: 68,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    paddingHorizontal: 10,
  },
  segmentedButtonActive: {
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  segmentedButtonText: {
    color: "rgba(255, 255, 255, 0.76)",
    fontSize: 13,
    fontWeight: "700",
  },
  segmentedButtonTextActive: {
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
