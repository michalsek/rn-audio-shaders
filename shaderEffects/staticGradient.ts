import tgpu, { d, std } from "typegpu";

import type { ShaderEffectFactory } from "./types";

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

export const createStaticGradientEffect: ShaderEffectFactory = (root) => {
  const pipeline = root.createRenderPipeline({
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
  });

  return {
    render: (ctx) => {
      pipeline.withColorAttachment({ view: ctx }).draw(3);
    },
  };
};
