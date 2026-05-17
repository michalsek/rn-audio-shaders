import tgpu, { d, std } from "typegpu";

import type { ShaderEffectCanvasSize, ShaderEffectFactory } from "./types";

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

const VoiceOrbParams = d.struct({
  time: d.f32,
  resolution: d.vec2f,
  color: d.vec3f,
  amplitude: d.f32,
  speed: d.f32,
  radius: d.f32,
  glow: d.f32,
  brightness: d.f32,
  pulse: d.f32,
});

type VoiceOrbParamsValue = d.InferInput<typeof VoiceOrbParams>;

const orbLayout = tgpu.bindGroupLayout({
  params: { uniform: VoiceOrbParams },
});

const LEVEL_ATTACK_SECONDS = 0.28;
const LEVEL_RELEASE_SECONDS = 0.62;
const PULSE_ATTACK_SECONDS = 0.08;
const PULSE_RELEASE_SECONDS = 0.2;
const BRIGHTNESS_SMOOTH_SECONDS = 0.4;
const MAX_FRAME_DELTA_SECONDS = 1 / 20;
const FLOW_TIME_WRAP_SECONDS = 900;

type HexColor = `#${string}`;

const brandColors = {
  primaryBlue: "#001A72",

  yellow100: "#FFD61E",
  yellow80: "#FFE04B",
  yellow60: "#FFE780",
  yellow40: "#FFF1B2",
  yellow20: "#FFFAE1",

  blue100: "#38ACDD",
  blue80: "#5BB9E0",
  blue60: "#87CCE8",
  blue40: "#B5E1F1",
  blue20: "#E1F3FA",

  red100: "#FF6259",
  red80: "#FA7F7C",
  red60: "#FFA3A1",
  red40: "#FFD2D7",
  red20: "#FFEDF0",

  green100: "#57B495",
  green80: "#82CAB2",
  green60: "#B1DFD0",
  green40: "#DFF2EC",
  green20: "#EBFCF7",
} as const;

const VOICE_ORB_LIQUID_COLORS_HEX = {
  base: brandColors.blue100,
  highlight: brandColors.red100,
  accent: brandColors.yellow100,
  softAccent: brandColors.green40,
  shadow: brandColors.primaryBlue,
} satisfies Record<string, HexColor>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const approach = (current: number, target: number, factor: number) =>
  current + (target - current) * factor;

const smoothingFactor = (deltaSeconds: number, timeConstantSeconds: number) =>
  1 - Math.exp(-deltaSeconds / timeConstantSeconds);

const createColor = (hex: HexColor) =>
  d.vec3f(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );

const liquidBaseColor = tgpu.const(
  d.vec3f,
  createColor(VOICE_ORB_LIQUID_COLORS_HEX.base),
);
const liquidHighlightColor = tgpu.const(
  d.vec3f,
  createColor(VOICE_ORB_LIQUID_COLORS_HEX.highlight),
);
const liquidAccentColor = tgpu.const(
  d.vec3f,
  createColor(VOICE_ORB_LIQUID_COLORS_HEX.accent),
);
const liquidSoftAccentColor = tgpu.const(
  d.vec3f,
  createColor(VOICE_ORB_LIQUID_COLORS_HEX.softAccent),
);
const liquidShadowColor = tgpu.const(
  d.vec3f,
  createColor(VOICE_ORB_LIQUID_COLORS_HEX.shadow),
);

const getResolution = ({ width, height }: ShaderEffectCanvasSize) =>
  d.vec2f(Math.max(1, width), Math.max(1, height));

const createParams = (
  time: number,
  resolution: d.v2f,
  audioLevel: number,
  brightness: number,
  pulse: number,
): VoiceOrbParamsValue => {
  const amplitude = 0.18 + audioLevel * 1.7;
  const speed = 0.75 + audioLevel * 0.5;
  const radius = Math.min(0.9, 0.76 + audioLevel * 0.11);
  const glow = Math.min(0.58, 0.08 + audioLevel * 0.7);

  return {
    time,
    resolution,
    color: createColor(VOICE_ORB_LIQUID_COLORS_HEX.base),
    amplitude,
    speed,
    radius,
    glow,
    brightness,
    pulse,
  };
};

const renderFn = tgpu.vertexFn({
  in: { idx: d.builtin.vertexIndex },
  out: { pos: d.builtin.position, uv: d.vec2f },
})((input) => {
  "use gpu";

  return {
    pos: d.vec4f(positions.$[input.idx], 0, 1),
    uv: texCoords.$[input.idx],
  };
});

const fragmentFn = tgpu.fragmentFn({
  in: { uv: d.vec2f },
  out: d.vec4f,
})((input) => {
  "use gpu";

  const resolution = orbLayout.$.params.resolution;
  const minResolution = std.max(1, std.min(resolution.x, resolution.y));
  const centeredUv = std.mul(
    std.sub(std.mul(input.uv, 2), d.vec2f(1)),
    std.div(resolution, d.vec2f(minResolution)),
  );
  const distanceFromCenter = std.length(centeredUv);
  const radius = orbLayout.$.params.radius;
  const mask =
    1 - std.smoothstep(radius - 0.012, radius + 0.018, distanceFromCenter);
  const inner = 1 - std.smoothstep(radius * 0.32, radius, distanceFromCenter);
  const edgeGlow =
    (1 - std.smoothstep(radius, radius + 0.18, distanceFromCenter)) *
    std.smoothstep(radius * 0.48, radius, distanceFromCenter);
  const amplitude = orbLayout.$.params.amplitude;
  const activity = std.clamp((amplitude - 0.18) / 1.7, 0, 1);
  const liquidActivity = std.smoothstep(0.04, 0.48, activity);
  const voicePulse = orbLayout.$.params.pulse * liquidActivity;
  const breathe = std.sin(orbLayout.$.params.time);
  const voiceRipple =
    std.sin(
      orbLayout.$.params.time * 1.8 +
        distanceFromCenter * 7.5 +
        liquidActivity * 0.9 +
        voicePulse * 1.2,
    ) *
    (liquidActivity * 0.72 + voicePulse * 0.38);
  const baseOrbUv = std.mul(
    centeredUv,
    (1 +
      amplitude * 0.028 +
      breathe * amplitude * 0.009 +
      voiceRipple * (0.036 + voicePulse * 0.034)) *
      std.mix(1.14, 0.84, inner),
  );
  const voiceDrift = std.mul(
    d.vec2f(
      std.sin(centeredUv.y * 4.4 + orbLayout.$.params.time * 1.35),
      std.cos(centeredUv.x * 4.1 - orbLayout.$.params.time * 1.18),
    ),
    inner * (liquidActivity * 0.048 + voicePulse * 0.078),
  );
  const orbUv = std.add(baseOrbUv, voiceDrift);

  let phase =
    -orbLayout.$.params.time * 0.5 - liquidActivity * 0.32 - voicePulse * 0.24;
  let wave = liquidActivity * 0.48 + voicePulse * 0.44;

  for (const i of tgpu.unroll(std.range(8))) {
    wave += std.cos(
      d.f32(i) -
        phase -
        wave * orbUv.x -
        voiceRipple * (0.26 + voicePulse * 0.22),
    );
    phase += std.sin(
      orbUv.y * d.f32(i) + wave + liquidActivity * 0.42 + voicePulse * 0.52,
    );
  }

  const baseColor = d.vec3f(
    std.cos(orbUv.x * 2.6 + phase) * 0.52 + 0.48,
    std.cos(orbUv.y * 2.4 + wave * 0.34 - phase * 0.22) * 0.52 + 0.48,
    std.cos((orbUv.x + orbUv.y) * 1.8 + wave * 0.28 + phase * 0.18) * 0.5 + 0.5,
  );
  const brandYellow = liquidBaseColor.$;
  const softYellow = liquidHighlightColor.$;
  const brandRed = liquidAccentColor.$;
  const softRed = liquidSoftAccentColor.$;
  const darkRed = liquidShadowColor.$;
  const flowA = std.smoothstep(0.18, 0.9, baseColor.r);
  const flowB = std.smoothstep(0.22, 0.88, baseColor.g);
  const warmAccent = std.mix(
    brandRed,
    brandYellow,
    std.smoothstep(0.25, 0.88, baseColor.r),
  );

  let color = std.mix(brandYellow, softRed, flowB * 0.46);
  color = std.mix(color, softYellow, inner * flowA * 0.18);
  color = std.mix(color, darkRed, (1 - inner) * 0.16 + baseColor.b * 0.025);
  color = std.add(
    color,
    std.mul(warmAccent, inner * (liquidActivity * 0.04 + voicePulse * 0.065)),
  );
  color = std.add(
    color,
    std.mul(
      brandRed,
      flowB * inner * (0.02 + liquidActivity * 0.014 + voicePulse * 0.032),
    ),
  );
  color = std.add(
    color,
    std.mul(darkRed, edgeGlow * orbLayout.$.params.glow * 0.16),
  );
  color = std.add(color, std.mul(brandYellow, std.pow(inner, 3) * 0.035));
  color = std.mul(
    color,
    0.68 +
      orbLayout.$.params.brightness * 0.22 +
      mask * 0.2 +
      liquidActivity * 0.03 +
      voicePulse * 0.045,
  );

  const alpha = std.clamp(
    mask + edgeGlow * 0.18 * orbLayout.$.params.glow,
    0,
    1,
  );
  const premultipliedColor = std.mul(
    std.clamp(color, d.vec3f(0), d.vec3f(1)),
    alpha,
  );

  return d.vec4f(premultipliedColor, alpha);
});

export const createVoiceOrbEffect: ShaderEffectFactory = (root) => {
  const paramsBuffer = root
    .createBuffer(VoiceOrbParams, createParams(0, d.vec2f(1, 1), 0, 0, 0))
    .$usage("uniform");
  const bindGroup = root.createBindGroup(orbLayout, { params: paramsBuffer });
  const pipeline = root.createRenderPipeline({
    vertex: renderFn,
    fragment: fragmentFn,
  });
  let visualAudioLevel = 0;
  let visualBrightness = 0;
  let visualPulse = 0;
  let flowTime = 0;
  let previousElapsedSeconds: number | null = null;

  return {
    render: (ctx, audioFrame, elapsedSeconds, canvasSize) => {
      const rawAudioLevel = clamp01(
        audioFrame.level * 0.45 +
          audioFrame.smoothedLevel * 1.2 +
          audioFrame.smoothedPeak * 0.25,
      );
      const rawPulse = clamp01(
        audioFrame.level * 0.78 +
          audioFrame.peak * 0.44 +
          Math.max(0, rawAudioLevel - visualAudioLevel) * 1.4,
      );
      const rawBrightness = clamp01(audioFrame.brightness);
      const rawDeltaSeconds =
        previousElapsedSeconds === null
          ? 1 / 60
          : elapsedSeconds - previousElapsedSeconds;
      const deltaSeconds = Math.max(
        0,
        Math.min(MAX_FRAME_DELTA_SECONDS, rawDeltaSeconds),
      );
      const levelTimeConstant =
        rawAudioLevel > visualAudioLevel
          ? LEVEL_ATTACK_SECONDS
          : LEVEL_RELEASE_SECONDS;
      const pulseTimeConstant =
        rawPulse > visualPulse ? PULSE_ATTACK_SECONDS : PULSE_RELEASE_SECONDS;

      previousElapsedSeconds = elapsedSeconds;
      visualAudioLevel = approach(
        visualAudioLevel,
        rawAudioLevel,
        smoothingFactor(deltaSeconds, levelTimeConstant),
      );
      visualBrightness = approach(
        visualBrightness,
        rawBrightness,
        smoothingFactor(deltaSeconds, BRIGHTNESS_SMOOTH_SECONDS),
      );
      visualPulse = approach(
        visualPulse,
        rawPulse,
        smoothingFactor(deltaSeconds, pulseTimeConstant),
      );

      const visualSpeed = 0.75 + visualAudioLevel * 0.18 + visualPulse * 0.08;

      flowTime += deltaSeconds * visualSpeed;
      if (flowTime > FLOW_TIME_WRAP_SECONDS) {
        flowTime -= FLOW_TIME_WRAP_SECONDS;
      }

      paramsBuffer.write(
        createParams(
          flowTime,
          getResolution(canvasSize),
          visualAudioLevel,
          visualBrightness,
          visualPulse,
        ),
      );

      pipeline.withColorAttachment({ view: ctx }).with(bindGroup).draw(3);
    },
    dispose: () => {
      paramsBuffer.destroy();
    },
  };
};
