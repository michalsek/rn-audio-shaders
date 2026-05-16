import { AudioControls } from "@/components/AudioControls";
import { useAudioSession } from "@/hooks/useAudioSession";
import { createShaderEffect, type ShaderEffect } from "@/shaderEffects";
import { useConfigureContext, useFrame, useRoot } from "@typegpu/react";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas } from "react-native-wgpu";

const CANVAS_SIZE = 400;

export function Home() {
  const root = useRoot();
  const [selectedEffect, setSelectedEffect] =
    useState<ShaderEffect>("static gradient");

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
    shaderEffect.render(ctx, audioFrame, elapsedSeconds);

    // A react-native-wgpu requirement for flushing the rendered frame.
    ctx.present?.();
  });

  return (
    <View style={styles.screen}>
      <Canvas ref={ref} style={styles.canvas} transparent />
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
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    borderRadius: CANVAS_SIZE / 2,
    overflow: "hidden",
  },
});
