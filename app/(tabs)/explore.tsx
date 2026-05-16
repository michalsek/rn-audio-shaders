import { useConfigureContext, useFrame, useRoot } from "@typegpu/react";
import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "react-native-wgpu";
import { d, std, tgpu } from "typegpu";

const positions = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(-1, 1),
  d.vec2f(-1, 1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
]);

export function Home() {
  const root = useRoot();

  const pipeline = useMemo(() => {
    return root.createRenderPipeline({
      vertex: ({ $vertexIndex: vid }) => {
        "use gpu";

        const position = positions.$[vid];
        const uv = position.mul(0.5).add(d.vec2f(0.5));

        return {
          $position: d.vec4f(position, 0, 1),
          uv,
        };
      },
      fragment: ({ uv }) => {
        "use gpu";

        const bottomLeft = d.vec3f(1, 0.12, 0.36);
        const bottomRight = d.vec3f(1, 0.72, 0.08);
        const topLeft = d.vec3f(0.04, 0.82, 1);
        const topRight = d.vec3f(0.56, 0.2, 1);
        const bottom = std.mix(bottomLeft, bottomRight, uv.x);
        const top = std.mix(topLeft, topRight, uv.x);
        const color = std.mix(bottom, top, uv.y);

        return d.vec4f(color, 1);
      },
    });
  }, [root]);

  const { ref, ctxRef } = useConfigureContext({ alphaMode: "premultiplied" });

  useFrame(() => {
    const ctx = ctxRef.current;

    if (!ctx) {
      return;
    }

    pipeline.withColorAttachment({ view: ctx }).draw(6);

    // A react-native-wgpu requirement for flushing the rendered effect
    ctx.present?.();
  });

  const insets = useSafeAreaInsets();

  return (
    <Canvas
      ref={ref}
      style={{
        width: "100%",
        aspectRatio: 1,
        marginTop: insets.top,
        marginBottom: insets.bottom,
        marginLeft: insets.left,
        marginRight: insets.right,
      }}
      transparent
    />
  );
}

export default Home;
