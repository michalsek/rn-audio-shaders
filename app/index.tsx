import { AudioControls } from "@/components/AudioControls";
import { useAudioSession } from "@/hooks/useAudioSession";
import { createShaderEffect, type ShaderEffect } from "@/shaderEffects";
import { FABRIC_BALL_RUNTIME_CONTROL_DEFAULTS } from "@/shaderEffects/fabricBall";
import type { FabricBallRuntimeControls } from "@/shaderEffects/types";
import { useConfigureContext, useFrame, useRoot } from "@typegpu/react";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Canvas } from "react-native-wgpu";

const CANVAS_SIZE_OPTIONS = [
  { label: "250 x 250", value: "250" },
  { label: "350 x 350", value: "350" },
  { label: "400 x 400", value: "400" },
  { label: "Full screen", value: "full" },
] as const;

type CanvasSizeOption = (typeof CANVAS_SIZE_OPTIONS)[number]["value"];
type FabricBallControlKey = keyof FabricBallRuntimeControls;

const FABRIC_BALL_CONTROL_OPTIONS = [
  { key: "radius", label: "Radius", min: 0.62, max: 1.08, step: 0.02 },
  { key: "amplitude", label: "Relief", min: 0, max: 0.03, step: 0.001 },
  { key: "foldCount", label: "Folds", min: 60, max: 100, step: 1 },
  { key: "foldWidth", label: "Width", min: 0.004, max: 0.014, step: 0.001 },
  {
    key: "travelSpeed",
    label: "Travel",
    min: -0.12,
    max: 0.14,
    step: 0.005,
  },
  { key: "bend", label: "Bend", min: 0.24, max: 0.9, step: 0.02 },
  { key: "twist", label: "Twist", min: -0.1, max: 0.42, step: 0.02 },
  { key: "contraction", label: "Pinch", min: 0, max: 0.08, step: 0.004 },
  { key: "softness", label: "Softness", min: 0.08, max: 0.22, step: 0.01 },
  { key: "glow", label: "Glow", min: 0.2, max: 1, step: 0.02 },
] satisfies {
  key: FabricBallControlKey;
  label: string;
  min: number;
  max: number;
  step: number;
}[];

const formatControlValue = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");

export function Home() {
  const root = useRoot();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [selectedEffect, setSelectedEffect] =
    useState<ShaderEffect>("static gradient");
  const [selectedCanvasSize, setSelectedCanvasSize] =
    useState<CanvasSizeOption>("400");
  const [isCanvasSizeSelectOpen, setIsCanvasSizeSelectOpen] = useState(false);
  const [isFabricControlsOpen, setIsFabricControlsOpen] = useState(false);
  const [fabricBallControls, setFabricBallControls] =
    useState<FabricBallRuntimeControls>(FABRIC_BALL_RUNTIME_CONTROL_DEFAULTS);

  const {
    audioSource,
    micStatus,
    micMessage,
    isListening,
    selectSource,
    startActiveSource,
    stopActiveSource,
    readAudioFrame,
  } = useAudioSession();

  const shaderEffect = useMemo(
    () => createShaderEffect(selectedEffect, root),
    [root, selectedEffect],
  );
  const contextOptions = useMemo(
    () => ({ alphaMode: "premultiplied" as const }),
    [],
  );
  const { ref, ctxRef } = useConfigureContext(contextOptions);
  const selectedCanvasSizeLabel =
    CANVAS_SIZE_OPTIONS.find((option) => option.value === selectedCanvasSize)
      ?.label ?? "400 x 400";
  const isFullScreenCanvas = selectedCanvasSize === "full";
  const canvasDimensions = isFullScreenCanvas
    ? { width: screenWidth, height: screenHeight }
    : {
        width: Number(selectedCanvasSize),
        height: Number(selectedCanvasSize),
      };
  const canvasKey = `${canvasDimensions.width}x${canvasDimensions.height}`;
  const runtimeControls = useMemo(
    () =>
      selectedEffect === "fabric ball"
        ? { fabricBall: fabricBallControls }
        : undefined,
    [fabricBallControls, selectedEffect],
  );

  useEffect(() => {
    return () => {
      shaderEffect.dispose?.();
    };
  }, [shaderEffect]);

  useEffect(() => {
    if (selectedEffect !== "fabric ball") {
      setIsFabricControlsOpen(false);
    }
  }, [selectedEffect]);

  const updateFabricBallControl = (
    key: FabricBallControlKey,
    delta: number,
    min: number,
    max: number,
  ) => {
    setFabricBallControls((previousControls) => {
      const nextValue = Math.min(
        max,
        Math.max(min, previousControls[key] + delta),
      );

      return {
        ...previousControls,
        [key]: Number(nextValue.toFixed(3)),
      };
    });
  };

  useFrame(({ elapsedSeconds }) => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    const audioFrame = readAudioFrame(shaderEffect.audioAnalyserReadIntervalMs);
    shaderEffect.render(
      ctx,
      audioFrame,
      elapsedSeconds,
      canvasDimensions,
      runtimeControls,
    );

    // A react-native-wgpu requirement for flushing the rendered frame.
    ctx.present?.();
  });

  return (
    <View style={styles.screen}>
      <Canvas
        key={canvasKey}
        ref={ref}
        style={[
          styles.canvas,
          canvasDimensions,
          !isFullScreenCanvas && {
            borderRadius: canvasDimensions.width / 2,
          },
        ]}
        transparent
      />
      <View style={styles.canvasSizeSelect}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: isCanvasSizeSelectOpen }}
          onPress={() => setIsCanvasSizeSelectOpen((isOpen) => !isOpen)}
          style={({ pressed }) => [
            styles.selectButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.selectButtonText}>
            Canvas: {selectedCanvasSizeLabel}
          </Text>
          <Text style={styles.selectChevron}>v</Text>
        </Pressable>
        {isCanvasSizeSelectOpen ? (
          <View style={styles.selectMenu}>
            {CANVAS_SIZE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                onPress={() => {
                  setSelectedCanvasSize(option.value);
                  setIsCanvasSizeSelectOpen(false);
                }}
                style={[
                  styles.selectOption,
                  selectedCanvasSize === option.value &&
                    styles.selectOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    selectedCanvasSize === option.value &&
                      styles.selectOptionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {selectedEffect === "fabric ball" ? (
        <View style={styles.fabricControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: isFabricControlsOpen }}
            onPress={() => setIsFabricControlsOpen((isOpen) => !isOpen)}
            style={({ pressed }) => [
              styles.fabricControlsHeader,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.fabricControlsTitle}>Folds</Text>
            <Text style={styles.selectChevron}>
              {isFabricControlsOpen ? "^" : "v"}
            </Text>
          </Pressable>
          {isFabricControlsOpen ? (
            <ScrollView
              style={styles.fabricControlsList}
              contentContainerStyle={styles.fabricControlsListContent}
            >
              {FABRIC_BALL_CONTROL_OPTIONS.map((control) => (
                <View key={control.key} style={styles.fabricControlRow}>
                  <Text style={styles.fabricControlLabel}>{control.label}</Text>
                  <Pressable
                    accessibilityLabel={`Decrease ${control.label}`}
                    accessibilityRole="button"
                    onPress={() =>
                      updateFabricBallControl(
                        control.key,
                        -control.step,
                        control.min,
                        control.max,
                      )
                    }
                    style={({ pressed }) => [
                      styles.stepperButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.stepperButtonText}>-</Text>
                  </Pressable>
                  <Text style={styles.fabricControlValue}>
                    {formatControlValue(fabricBallControls[control.key])}
                  </Text>
                  <Pressable
                    accessibilityLabel={`Increase ${control.label}`}
                    accessibilityRole="button"
                    onPress={() =>
                      updateFabricBallControl(
                        control.key,
                        control.step,
                        control.min,
                        control.max,
                      )
                    }
                    style={({ pressed }) => [
                      styles.stepperButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.stepperButtonText}>+</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      <AudioControls
        selectedEffect={selectedEffect}
        audioSource={audioSource}
        micStatus={micStatus}
        micMessage={micMessage}
        isListening={isListening}
        selectEffect={setSelectedEffect}
        selectSource={selectSource}
        startActiveSource={startActiveSource}
        stopActiveSource={stopActiveSource}
      />
    </View>
  );
}

export default Home;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#11181c",
  },
  canvas: {
    overflow: "hidden",
  },
  canvasSizeSelect: {
    position: "absolute",
    top: 56,
    alignSelf: "center",
    zIndex: 3,
  },
  selectButton: {
    minWidth: 178,
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
    top: 44,
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
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  fabricControls: {
    position: "absolute",
    top: 108,
    alignSelf: "center",
    width: "88%",
    maxWidth: 340,
    zIndex: 2,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(25, 34, 39, 0.94)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  fabricControlsHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  fabricControlsTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  fabricControlsList: {
    maxHeight: 320,
  },
  fabricControlsListContent: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 6,
  },
  fabricControlRow: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fabricControlLabel: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.82)",
    fontSize: 12,
    fontWeight: "700",
  },
  fabricControlValue: {
    minWidth: 48,
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  stepperButton: {
    width: 30,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderColor: "rgba(255, 255, 255, 0.24)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepperButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
