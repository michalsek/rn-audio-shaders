import {
  useConfigureContext,
  useFrame,
  useRoot,
  useUniform,
} from "@typegpu/react";
import { useEffect, useMemo } from "react";
import {
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { Canvas } from "react-native-wgpu";
import { d, tgpu } from "typegpu";

const positions = tgpu.const(d.arrayOf(d.vec2f, 3), [
  d.vec2f(0, 0.5),
  d.vec2f(-0.5, -0.5),
  d.vec2f(0.5, -0.5),
]);

export function Home() {
  const topCX = useSharedValue(0);
  const topCY = useSharedValue(0);

  const root = useRoot();
  const topCornerOffset = useUniform(d.vec2f);

  const pipeline = useMemo(() => {
    return root.createRenderPipeline({
      vertex: ({ $vertexIndex: vid }) => {
        "use gpu";

        let offset = d.vec2f(0, 0);

        if (vid === 0) {
          offset = d.vec2f(topCornerOffset.$);
        }

        return {
          $position: d.vec4f(positions.$[vid].add(offset), 0, 1),
        };
      },
      fragment: () => {
        "use gpu";
        return d.vec4f(0.114, 0.447, 0.941, 1);
      },
    });
  }, [root, topCornerOffset]);

  const { ref, ctxRef } = useConfigureContext({ alphaMode: "premultiplied" });

  useEffect(() => {
    topCX.value = withRepeat(
      withSequence(
        withTiming(-0.5, { duration: 1000 }),
        withTiming(0.25, { duration: 1000 }),
        withTiming(0.5, { duration: 1000 }),
        withTiming(0.25, { duration: 1000 }),
        withTiming(-0.5, { duration: 1000 }),
      ),
      -1,
    );

    topCY.value = withRepeat(
      withSequence(
        withTiming(-0.5, { duration: 1000 }),
        withTiming(-0.25, { duration: 1000 }),
        withTiming(-0.5, { duration: 1000 }),
      ),
      -1,
    );
  }, [topCX, topCY]);

  useFrame(() => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    topCornerOffset.write(d.vec2f(topCX.value, topCY.value));
    pipeline.withColorAttachment({ view: ctx }).draw(3);

    // A react-native-wgpu requirement for flushing the rendered effect
    ctx.present?.();
  });

  return <Canvas ref={ref} style={{ aspectRatio: 1 }} transparent />;
}

export default Home;
