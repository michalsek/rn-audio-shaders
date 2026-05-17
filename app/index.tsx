import { AudioControls } from "@/components/AudioControls";
import { useAudioSession } from "@/hooks/useAudioSession";
import { createShaderEffect, type ShaderEffect } from "@/shaderEffects";
import { useConfigureContext, useFrame, useRoot } from "@typegpu/react";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
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

export function Home() {
  const root = useRoot();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [selectedEffect, setSelectedEffect] =
    useState<ShaderEffect>("static gradient");
  const [selectedCanvasSize, setSelectedCanvasSize] =
    useState<CanvasSizeOption>("400");
  const [isCanvasSizeSelectOpen, setIsCanvasSizeSelectOpen] = useState(false);

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

  useEffect(() => {
    return () => {
      shaderEffect.dispose?.();
    };
  }, [shaderEffect]);

  useFrame(({ elapsedSeconds }) => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    const audioFrame = readAudioFrame(shaderEffect.audioAnalyserReadIntervalMs);
    shaderEffect.render(ctx, audioFrame, elapsedSeconds, canvasDimensions);

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
});
