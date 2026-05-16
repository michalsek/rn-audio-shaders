import tgpu, { d, std } from "typegpu";

import type { ShaderEffectFactory } from "./types";

const SIM_SIZE = 512;
const WORKGROUP_SIZE = 16;
const MAX_DROPLETS = 1;
const AUDIO_ANALYSER_READ_INTERVAL_MS = 150;
const DROPLET_POINT_RADIUS = 2.5 / SIM_SIZE;
const WAVE_SPEED = 0.14;
const ENABLE_AUDIO_BACKGROUND_RIPPLE = false;

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

const DropletParams = d.struct({
  position: d.vec2f,
  radius: d.f32,
  strength: d.f32,
  phase: d.f32,
});

const LiquidParams = d.struct({
  droplets: d.arrayOf(DropletParams, MAX_DROPLETS),
  dropCount: d.u32,
  time: d.f32,
  audioLevel: d.f32,
  brightness: d.f32,
  damping: d.f32,
});

type LiquidParamsValue = d.InferInput<typeof LiquidParams>;
type DropletParamsValue = LiquidParamsValue["droplets"][number];

const simulationLayout = tgpu.bindGroupLayout({
  current: { texture: d.texture2d(d.f32) },
  next: { storageTexture: d.textureStorage2d("rgba16float", "write-only") },
  params: { uniform: LiquidParams },
});

const renderLayout = tgpu.bindGroupLayout({
  field: { texture: d.texture2d(d.f32) },
  params: { uniform: LiquidParams },
  linearSampler: { sampler: "filtering" },
});

const emptyDroplet = (): DropletParamsValue => ({
  position: d.vec2f(0, 0),
  radius: 0,
  strength: 0,
  phase: 0,
});

const createEmptyDroplets = (): LiquidParamsValue["droplets"] =>
  [
    ...Array.from({ length: MAX_DROPLETS }, emptyDroplet),
  ] as LiquidParamsValue["droplets"];

const createParams = (
  droplets: LiquidParamsValue["droplets"],
  dropCount: number,
  time: number,
  audioLevel: number,
  brightness: number,
): LiquidParamsValue => ({
  droplets,
  dropCount,
  time,
  audioLevel,
  brightness,
  damping: 0.996,
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const advanceFn = tgpu.computeFn({
  workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
  in: { gid: d.builtin.globalInvocationId },
})((input) => {
  "use gpu";

  const pixelPos = input.gid.xy;
  const texSize = std.textureDimensions(simulationLayout.$.current);

  if (pixelPos.x >= texSize.x || pixelPos.y >= texSize.y) {
    return;
  }

  const coord = d.vec2i(pixelPos);
  const maxCoord = std.sub(d.vec2i(texSize), d.vec2i(1));
  const leftCoord = std.clamp(
    std.add(coord, d.vec2i(-1, 0)),
    d.vec2i(),
    maxCoord,
  );
  const rightCoord = std.clamp(
    std.add(coord, d.vec2i(1, 0)),
    d.vec2i(),
    maxCoord,
  );
  const upCoord = std.clamp(
    std.add(coord, d.vec2i(0, -1)),
    d.vec2i(),
    maxCoord,
  );
  const downCoord = std.clamp(
    std.add(coord, d.vec2i(0, 1)),
    d.vec2i(),
    maxCoord,
  );
  const upLeftCoord = std.clamp(
    std.add(coord, d.vec2i(-1, -1)),
    d.vec2i(),
    maxCoord,
  );
  const upRightCoord = std.clamp(
    std.add(coord, d.vec2i(1, -1)),
    d.vec2i(),
    maxCoord,
  );
  const downLeftCoord = std.clamp(
    std.add(coord, d.vec2i(-1, 1)),
    d.vec2i(),
    maxCoord,
  );
  const downRightCoord = std.clamp(
    std.add(coord, d.vec2i(1, 1)),
    d.vec2i(),
    maxCoord,
  );

  const center = std.textureLoad(simulationLayout.$.current, coord, 0);
  const left = std.textureLoad(simulationLayout.$.current, leftCoord, 0);
  const right = std.textureLoad(simulationLayout.$.current, rightCoord, 0);
  const up = std.textureLoad(simulationLayout.$.current, upCoord, 0);
  const down = std.textureLoad(simulationLayout.$.current, downCoord, 0);
  const upLeft = std.textureLoad(simulationLayout.$.current, upLeftCoord, 0);
  const upRight = std.textureLoad(simulationLayout.$.current, upRightCoord, 0);
  const downLeft = std.textureLoad(
    simulationLayout.$.current,
    downLeftCoord,
    0,
  );
  const downRight = std.textureLoad(
    simulationLayout.$.current,
    downRightCoord,
    0,
  );

  const h = center.x;
  const fourWayLap = left.x + right.x + up.x + down.x - 4 * h;
  const diagonalLap =
    0.5 * (upLeft.x + upRight.x + downLeft.x + downRight.x) - 2 * h;
  const slope = d.vec2f(right.x - left.x, down.x - up.x);
  const collision =
    (fourWayLap - diagonalLap) * std.clamp(std.length(slope) * 18, 0, 1);
  const neighborAverage =
    (left.x + right.x + up.x + down.x + 0.5 * diagonalLap + 2 * h) / 6.5;

  const uv = std.div(
    std.add(d.vec2f(pixelPos), d.vec2f(0.5)),
    d.vec2f(texSize),
  );
  let impulse = d.f32(0);
  let activity = center.z * 0.94;

  for (const i of tgpu.unroll(std.range(MAX_DROPLETS))) {
    if (simulationLayout.$.params.dropCount > d.u32(i)) {
      const droplet = simulationLayout.$.params.droplets[i];
      const delta = std.sub(uv, droplet.position);
      const distance = std.length(delta);
      const radius = std.max(d.f32(1.1 / SIM_SIZE), droplet.radius);
      const coreRatio = distance / radius;
      const core = std.exp(-(coreRatio * coreRatio));
      const splash = droplet.strength * core;

      impulse += splash;
      activity += core * std.abs(droplet.strength) * 0.42;
    }
  }

  let audioRipple = d.f32(0);

  if (ENABLE_AUDIO_BACKGROUND_RIPPLE) {
    audioRipple =
      std.sin(uv.x * 23 + simulationLayout.$.params.time * 0.9) *
      std.cos(uv.y * 19 - simulationLayout.$.params.time * 1.1) *
      simulationLayout.$.params.brightness *
      simulationLayout.$.params.audioLevel *
      0.00075;
  }
  const waveSpeed = d.f32(WAVE_SPEED);
  const waveEnergy = std.max(std.abs(h), std.abs(center.y));
  const initialDissolve = std.smoothstep(0.05, 0.2, waveEnergy);
  const finalDissolve = 1 - std.smoothstep(0.006, 0.026, waveEnergy);
  const shapedDamping =
    simulationLayout.$.params.damping - initialDissolve * 0.018 - finalDissolve * 0.012;
  const heightDamping = 0.99975 - initialDissolve * 0.0008 - finalDissolve * 0.0045;
  let velocity =
    center.y * shapedDamping +
    (fourWayLap * 0.8 + diagonalLap * 0.2 + collision * 0.13) * waveSpeed +
    impulse +
    audioRipple;

  velocity = std.clamp(velocity, -0.26, 0.26);

  const nextHeight = std.mix(h + velocity, neighborAverage, 0.0035);
  const nextActivity = std.clamp(activity + std.abs(velocity) * 0.025, 0, 1);

  std.textureStore(
    simulationLayout.$.next,
    pixelPos,
    d.vec4f(nextHeight * heightDamping, velocity, nextActivity, 1),
  );
});

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

  const uv = std.clamp(input.uv, d.vec2f(0), d.vec2f(1));
  const texSize = std.textureDimensions(renderLayout.$.field);
  const texel = std.div(d.vec2f(1), d.vec2f(texSize));
  const center = std.textureSampleLevel(
    renderLayout.$.field,
    renderLayout.$.linearSampler,
    uv,
    0,
  );
  const left = std.textureSampleLevel(
    renderLayout.$.field,
    renderLayout.$.linearSampler,
    std.sub(uv, d.vec2f(texel.x, 0)),
    0,
  ).x;
  const right = std.textureSampleLevel(
    renderLayout.$.field,
    renderLayout.$.linearSampler,
    std.add(uv, d.vec2f(texel.x, 0)),
    0,
  ).x;
  const up = std.textureSampleLevel(
    renderLayout.$.field,
    renderLayout.$.linearSampler,
    std.sub(uv, d.vec2f(0, texel.y)),
    0,
  ).x;
  const down = std.textureSampleLevel(
    renderLayout.$.field,
    renderLayout.$.linearSampler,
    std.add(uv, d.vec2f(0, texel.y)),
    0,
  ).x;

  const gradient = d.vec2f(right - left, down - up);
  const normal = std.normalize(d.vec3f(-gradient.x * 11, -gradient.y * 11, 1));
  const light = std.normalize(d.vec3f(-0.22, 0.36, 0.91));
  const view = d.vec3f(0, 0, 1);
  const diffuse = std.clamp(std.dot(normal, light), 0, 1);
  const reflection = std.reflect(std.sub(d.vec3f(0), light), normal);
  const specular = std.pow(std.clamp(std.dot(reflection, view), 0, 1), 64);
  const refractedUv = std.add(uv, std.mul(gradient, 0.038 + center.z * 0.012));
  const caustic =
    std.sin(
      (refractedUv.x + center.x * 0.18) * 18 +
        renderLayout.$.params.time * 0.45,
    ) *
    std.sin(
      (refractedUv.y - center.x * 0.12) * 16 -
        renderLayout.$.params.time * 0.38,
    );
  const heightGlow = std.smoothstep(0.018, 0.16, std.abs(center.x));
  const foam = std.smoothstep(0.16, 0.9, center.z);
  const freshWave = std.smoothstep(0.012, 0.08, std.abs(center.y)) *
    std.smoothstep(0.05, 0.5, center.z);
  const deep = d.vec3f(0.098, 0.698, 0.82);
  const glass = d.vec3f(0.08, 0.28, 0.31);
  const highlight = d.vec3f(0.72, 0.9, 0.92);
  const shadow = d.vec3f(0.173, 0.82, 0.949);
  let color = std.mix(deep, glass, 0.42 + diffuse * 0.3);

  color = std.mix(color, shadow, std.clamp(-center.x * 0.9, 0, 0.34));
  color = std.add(
    color,
    std.mul(
      highlight,
      specular * (0.22 + renderLayout.$.params.audioLevel * 0.22),
    ),
  );
  color = std.add(
    color,
    std.mul(
      d.vec3f(0.09, 0.22, 0.2),
      (caustic * 0.5 + 0.5) * heightGlow * 0.35,
    ),
  );
  color = std.mix(color, highlight, foam * 0.12);
  color = std.mix(color, highlight, freshWave * 0.1);

  const vignette =
    1 - std.smoothstep(0.58, 0.98, std.distance(uv, d.vec2f(0.5))) * 0.34;

  return d.vec4f(
    std.clamp(std.mul(color, vignette), d.vec3f(0), d.vec3f(1)),
    1,
  );
});

export const createLiquidEffect: ShaderEffectFactory = (root) => {
  const paramsBuffer = root
    .createBuffer(LiquidParams, createParams(createEmptyDroplets(), 0, 0, 0, 0))
    .$usage("uniform");
  const fields = [0, 1].map((index) =>
    root
      .createTexture({ size: [SIM_SIZE, SIM_SIZE], format: "rgba16float" })
      .$usage("storage", "sampled")
      .$name(`liquid-field-${index}`),
  );
  const linearSampler = root.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });
  const advancePipeline = root.createComputePipeline({ compute: advanceFn });
  const renderPipeline = root.createRenderPipeline({
    vertex: renderFn,
    fragment: fragmentFn,
  });
  const simulationBindGroups = [0, 1].map((sourceIndex) =>
    root.createBindGroup(simulationLayout, {
      current: fields[sourceIndex].createView(d.texture2d(d.f32)),
      next: fields[1 - sourceIndex].createView(
        d.textureStorage2d("rgba16float", "write-only"),
      ),
      params: paramsBuffer,
    }),
  );
  const renderBindGroups = [0, 1].map((index) =>
    root.createBindGroup(renderLayout, {
      field: fields[index].createView(d.texture2d(d.f32)),
      params: paramsBuffer,
      linearSampler,
    }),
  );
  const dispatchCount = Math.ceil(SIM_SIZE / WORKGROUP_SIZE);

  let currentFieldIndex = 0;
  let previousPeak = 0;
  let dropletCharge = 0;
  let lastProcessedAudioReadId = 0;
  let rngState = 0x6d2b79f5;

  const random = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };

  const buildDroplets = (
    count: number,
    audioLevel: number,
    peak: number,
    brightness: number,
  ) => {
    const droplets = createEmptyDroplets();
    const baseAngle = random() * Math.PI * 2;
    const clusterRadius = 0.08 + random() * 0.28;
    const centerX = 0.5 + Math.cos(baseAngle) * clusterRadius;
    const centerY = 0.5 + Math.sin(baseAngle) * clusterRadius;

    for (let i = 0; i < count; i++) {
      const scatterAngle = random() * Math.PI * 2;
      const scatter = (0.018 + random() * 0.12) * (i === 0 ? 0 : 1);
      const polarity = random() > 0.84 ? -0.7 : 1;
      droplets[i] = {
        position: d.vec2f(
          Math.max(
            0.08,
            Math.min(0.92, centerX + Math.cos(scatterAngle) * scatter),
          ),
          Math.max(
            0.08,
            Math.min(0.92, centerY + Math.sin(scatterAngle) * scatter),
          ),
        ),
        radius: DROPLET_POINT_RADIUS,
        strength:
          polarity *
          (0.08 + peak * 0.16 + audioLevel * 0.085 + brightness * 0.02) *
          (0.92 + random() * 0.16),
        phase: random() * Math.PI * 2,
      };
    }

    return droplets;
  };

  return {
    audioAnalyserReadIntervalMs: AUDIO_ANALYSER_READ_INTERVAL_MS,
    render: (ctx, audioFrame, elapsedSeconds) => {
      const audioLevel = clamp01(
        audioFrame.level * 0.42 +
          audioFrame.smoothedLevel * 0.78 +
          audioFrame.smoothedPeak * 0.28,
      );
      const peak = clamp01(audioFrame.peak);
      const brightness = clamp01(audioFrame.brightness);
      let dropCount = 0;
      const hasNewAudioRead = audioFrame.readId !== lastProcessedAudioReadId;

      if (hasNewAudioRead) {
        lastProcessedAudioReadId = audioFrame.readId;

        const peakRise = Math.max(0, peak - previousPeak * 0.72);

        previousPeak = Math.max(peak, previousPeak * 0.88);
        dropletCharge = Math.min(
          3.2,
          dropletCharge +
            audioLevel * 0.18 +
            peakRise * 1.8 +
            brightness * audioLevel * 0.12,
        );

        if (
          audioFrame.readId > 0 &&
          audioLevel > 0.018 &&
          (peakRise > 0.02 || dropletCharge > 0.62)
        ) {
          dropCount = Math.min(
            MAX_DROPLETS,
            Math.max(
              1,
              Math.floor(1 + audioLevel * 1.5 + peakRise * 7 + brightness),
            ),
          );
          dropletCharge = Math.max(0, dropletCharge - dropCount * 0.58);
        }
      }

      const droplets = buildDroplets(dropCount, audioLevel, peak, brightness);
      paramsBuffer.write(
        createParams(
          droplets,
          dropCount,
          elapsedSeconds,
          audioLevel,
          brightness,
        ),
      );

      advancePipeline
        .with(simulationBindGroups[currentFieldIndex])
        .dispatchWorkgroups(dispatchCount, dispatchCount);
      currentFieldIndex = 1 - currentFieldIndex;

      renderPipeline
        .withColorAttachment({ view: ctx })
        .with(renderBindGroups[currentFieldIndex])
        .draw(3);
    },
    dispose: () => {
      paramsBuffer.destroy();
      fields.forEach((field) => {
        field.destroy();
      });
    },
  };
};
