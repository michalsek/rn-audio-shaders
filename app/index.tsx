import { AudioControls } from "@/components/audio-controls";
import { useAudioSession } from "@/hooks/use-audio-session";
import { useConfigureContext, useFrame, useRoot } from "@typegpu/react";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas } from "react-native-wgpu";
import { d, std, tgpu } from "typegpu";

const CANVAS_SIZE = 250;

const positions = tgpu.const(d.arrayOf(d.vec2f, 3), [
  d.vec2f(-1, -1),
  d.vec2f(3, -1),
  d.vec2f(-1, 3),
]);

const texCoords = tgpu.const(d.arrayOf(d.vec2f, 3), [
  d.vec2f(0, 0),
  d.vec2f(2, 0),
  d.vec2f(0, 2),
]);

const sampleGradient = (uv: d.v2f) => {
  "use gpu";

  const clampedUv = std.clamp(uv, d.vec2f(0), d.vec2f(1));
  const bottomLeft = d.vec3f(1, 0.12, 0.36);
  const bottomRight = d.vec3f(1, 0.72, 0.08);
  const topLeft = d.vec3f(0.04, 0.82, 1);
  const topRight = d.vec3f(0.56, 0.2, 1);
  const bottom = std.mix(bottomLeft, bottomRight, clampedUv.x);
  const top = std.mix(topLeft, topRight, clampedUv.x);

  return std.mix(bottom, top, clampedUv.y);
};

export function Home() {
  const root = useRoot();
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

  const gradientPipeline = useMemo(
    () =>
      root.createRenderPipeline({
        vertex: ({ $vertexIndex: vid }) => {
          "use gpu";

          const position = positions.$[vid];

          return {
            $position: d.vec4f(position, 0, 1),
            uv: texCoords.$[vid],
          };
        },
        fragment: ({ uv }) => {
          "use gpu";

          return d.vec4f(sampleGradient(uv), 1);
        },
      }),
    [root],
  );
  const contextOptions = useMemo(
    () => ({ alphaMode: "premultiplied" as const }),
    [],
  );
  const { ref, ctxRef } = useConfigureContext(contextOptions);

  useFrame(() => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    readAudioFrame();
    gradientPipeline.withColorAttachment({ view: ctx }).draw(3);

    // A react-native-wgpu requirement for flushing the rendered frame.
    ctx.present?.();
  });

  return (
    <View style={styles.screen}>
      <Canvas ref={ref} style={styles.canvas} transparent />
      <AudioControls
        audioSource={audioSource}
        micStatus={micStatus}
        micMessage={micMessage}
        isListening={isListening}
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
