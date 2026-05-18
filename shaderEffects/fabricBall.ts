import tgpu, { d, std } from "typegpu";
import { mat4 } from "wgpu-matrix";

import type {
  FabricBallRuntimeControls,
  ShaderEffectCanvasSize,
  ShaderEffectFactory,
  ShaderEffectRuntimeControls,
} from "./types";

const ICOSPHERE_SUBDIVISIONS = 6;
const VERTEX_COUNT = 10 * 4 ** ICOSPHERE_SUBDIVISIONS + 2;
const INDEX_COUNT = 20 * 4 ** ICOSPHERE_SUBDIVISIONS * 3;

const VertexData = d.struct({
  position: d.vec3f,
  normal: d.vec3f,
});

const vertexLayout = tgpu.vertexLayout(d.arrayOf(VertexData));
const VertexDataArray = vertexLayout.schemaForCount(VERTEX_COUNT);
const IndexDataArray = d.arrayOf(d.u16, INDEX_COUNT);

const FabricBallParams = d.struct({
  mvp: d.mat4x4f,
  model: d.mat4x4f,
  normalModel: d.mat4x4f,
  time: d.f32,
  resolution: d.vec2f,
  radius: d.f32,
  amplitude: d.f32,
  foldCount: d.f32,
  foldWidth: d.f32,
  travelSpeed: d.f32,
  bend: d.f32,
  twist: d.f32,
  contraction: d.f32,
  softness: d.f32,
  glow: d.f32,
  baseColor: d.vec3f,
  highlightColor: d.vec3f,
  waveColor: d.vec3f,
  shadowColor: d.vec3f,
});

type FabricBallParamsValue = d.InferInput<typeof FabricBallParams>;
type VertexDataValue = d.InferInput<typeof VertexData>;

const renderLayout = tgpu.bindGroupLayout({
  params: { uniform: FabricBallParams, visibility: ["vertex", "fragment"] },
});

type HexColor = `#${string}`;

export const FABRIC_BALL_RUNTIME_CONTROL_DEFAULTS = {
  radius: 0.84,
  amplitude: 0.016,
  foldCount: 94,
  foldWidth: 0.005,
  travelSpeed: 0.09,
  bend: 0.66,
  twist: 0.18,
  contraction: 0.01,
  softness: 0.14,
  glow: 0.96,
} satisfies FabricBallRuntimeControls;

const FABRIC_BALL_COLORS_HEX = {
  base: "#969EFF",
  highlight: "#F7D6FF",
  wave: "#F4A5FF",
  shadow: "#736FE9",
} satisfies Record<string, HexColor>;

const createColor = (hex: HexColor) =>
  d.vec3f(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );

const getResolution = ({ width, height }: ShaderEffectCanvasSize) =>
  d.vec2f(Math.max(1, width), Math.max(1, height));

type Vec3 = [number, number, number];
type Triangle = [number, number, number];

const normalizeVec3 = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z);

  return [x / length, y / length, z / length];
};

const createSphereMesh = () => {
  const vertices: VertexDataValue[] = [];
  const directions: Vec3[] = [];
  let faces: Triangle[] = [];
  const midpointCache = new Map<string, number>();

  const addVertex = (point: Vec3) => {
    const direction = normalizeVec3(point);
    const normal = d.vec3f(direction[0], direction[1], direction[2]);
    const index = vertices.length;

    vertices.push({
      position: normal,
      normal,
    });
    directions.push(direction);

    return index;
  };

  const getMidpointIndex = (a: number, b: number) => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    const cachedIndex = midpointCache.get(key);

    if (cachedIndex !== undefined) {
      return cachedIndex;
    }

    const first = directions[low];
    const second = directions[high];
    const midpointIndex = addVertex([
      first[0] + second[0],
      first[1] + second[1],
      first[2] + second[2],
    ]);

    midpointCache.set(key, midpointIndex);

    return midpointIndex;
  };

  const t = (1 + Math.sqrt(5)) / 2;
  const initialVertices: Vec3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];

  initialVertices.forEach(addVertex);
  faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let subdivision = 0; subdivision < ICOSPHERE_SUBDIVISIONS; subdivision++) {
    const nextFaces: Triangle[] = [];

    for (const [a, b, c] of faces) {
      const ab = getMidpointIndex(a, b);
      const bc = getMidpointIndex(b, c);
      const ca = getMidpointIndex(c, a);

      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }

    faces = nextFaces;
  }

  if (vertices.length > 65535) {
    throw new Error(
      `Fabric ball icosphere has ${vertices.length} vertices, exceeding u16 indices.`,
    );
  }

  const indices = faces.flat();

  return {
    vertices: vertices as d.InferInput<typeof VertexDataArray>,
    indices: indices as d.InferInput<typeof IndexDataArray>,
  };
};

const createParams = (
  mvp: Float32Array,
  model: Float32Array,
  normalModel: Float32Array,
  time: number,
  resolution: d.v2f,
  controls: FabricBallRuntimeControls = FABRIC_BALL_RUNTIME_CONTROL_DEFAULTS,
): FabricBallParamsValue => ({
  mvp,
  model,
  normalModel,
  time,
  resolution,
  radius: controls.radius,
  amplitude: controls.amplitude,
  foldCount: controls.foldCount,
  foldWidth: controls.foldWidth,
  travelSpeed: controls.travelSpeed,
  bend: controls.bend,
  twist: controls.twist,
  contraction: controls.contraction,
  softness: controls.softness,
  glow: controls.glow,
  baseColor: createColor(FABRIC_BALL_COLORS_HEX.base),
  highlightColor: createColor(FABRIC_BALL_COLORS_HEX.highlight),
  waveColor: createColor(FABRIC_BALL_COLORS_HEX.wave),
  shadowColor: createColor(FABRIC_BALL_COLORS_HEX.shadow),
});

const sampleFoldProgress = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const source = std.normalize(d.vec3f(-0.62, 0.18, 0.76));
  const sourceDot = std.clamp(std.dot(source, dir), -0.999, 0.999);

  return std.acos(sourceDot) / 3.14159265;
});

const sampleFoldRingBias = tgpu.fn([d.vec3f], d.vec3f)((dir) => {
  "use gpu";

  const progress = sampleFoldProgress(dir);
  const rightCenter =
    std.smoothstep(-0.1, 0.78, dir.x) *
    (1 - std.smoothstep(0.9, 1.08, dir.x)) *
    std.smoothstep(-0.7, 0.26, dir.z);
  const sinkPack = std.smoothstep(0.46, 0.98, progress);
  const lowerFine =
    std.smoothstep(0.08, 0.72, -dir.y) *
    (1 - std.smoothstep(0.82, 1, -dir.y)) *
    std.smoothstep(-0.58, 0.3, dir.z);

  return d.vec3f(progress, rightCenter, sinkPack + lowerFine * 0.52);
});

const sampleFoldPhase = tgpu.fn(
  [d.vec3f, d.f32, d.f32, d.f32],
  d.f32,
)((dir, densityScale, timeScale, offset) => {
  "use gpu";

  const params = renderLayout.$.params;
  const source = std.normalize(d.vec3f(-0.62, 0.18, 0.76));
  const sourceEast = std.normalize(std.cross(d.vec3f(0, 1, 0), source));
  const sourceNorth = std.normalize(std.cross(source, sourceEast));
  const bias = sampleFoldRingBias(dir);
  const progress = bias.x;
  const aroundX = std.dot(dir, sourceEast);
  const aroundY = std.dot(dir, sourceNorth);
  const azimuthWarp =
    aroundX * (0.034 + params.twist * 0.032) +
    aroundX * aroundY * (0.065 + params.bend * 0.035) -
    aroundY * aroundY * 0.018;
  const sinkCurl =
    (bias.y * 0.028 + bias.z * 0.018) *
    std.sin((aroundX - aroundY * 0.45 + offset) * 5.2);
  const curvedProgress =
    progress +
    azimuthWarp * (0.52 + bias.y * 0.38) +
    sinkCurl +
    offset;
  const densityBias = 1 + bias.y * 0.42 + bias.z * 0.22;

  return (
    curvedProgress * params.foldCount * densityScale * densityBias +
    params.time * params.travelSpeed * timeScale
  );
});

const sampleSphereTopFoldMasks = tgpu.fn([d.vec3f], d.vec4f)((dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const sideFade =
    std.smoothstep(-1.02, -0.9, dir.x) *
    (1 - std.smoothstep(0.88, 1.03, dir.x));
  const projectedInterior =
    1 - std.smoothstep(0.94, 1.08, std.length(dir.xy));
  const upperHalf =
    std.smoothstep(-0.24, 0.2, dir.y) *
    (1 - std.smoothstep(0.94, 1.1, dir.y + dir.x * 0.05));
  const frontWrap = std.smoothstep(-0.9, -0.32, dir.z) * 0.34 + 0.66;
  const upperFace =
    upperHalf *
    projectedInterior *
    frontWrap *
    sideFade *
    1.06;
  const phase = sampleFoldPhase(dir, 2.32, 1.14, -0.012);
  const crestWave = std.sin(phase);
  const shadowWave = std.sin(phase - 0.72);
  const height = crestWave * 0.5 + 0.5;
  const shadowHeight = shadowWave * 0.5 + 0.5;
  const slope = std.cos(phase);
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.018);
  const widthGain = std.smoothstep(0.004, 0.018, foldWidth);
  const edgeCrestFade =
    (0.44 + (1 - std.smoothstep(0.68, 0.94, std.abs(dir.x))) * 0.56) *
    (0.6 + projectedInterior * 0.4);
  const crest =
    std.smoothstep(0.9992 - widthGain * 0.0007, 1, height) *
    upperFace *
    edgeCrestFade *
    0.58;
  const body =
    std.smoothstep(0.945 - widthGain * 0.013, 0.99, height) *
    (1 - std.smoothstep(0.995, 1, height) * 0.52) *
    upperFace *
    0.22;
  const shadow =
    std.smoothstep(0.74 - widthGain * 0.032, 0.95, shadowHeight) *
    std.smoothstep(0.1, 0.9, -slope) *
    upperFace *
    (1 - crest * 0.14) *
    0.96;
  const trough =
    std.smoothstep(0.74 - widthGain * 0.032, 0.95, 1 - height) *
    std.smoothstep(-0.02, 0.74, -slope) *
    upperFace *
    0.98;

  return d.vec4f(
    std.clamp(crest, 0, 1),
    std.clamp(body, 0, 1),
    std.clamp(shadow, 0, 1),
    std.clamp(trough, 0, 1),
  );
});

const sampleScreenTopFoldMasks = tgpu.fn(
  [d.vec2f, d.vec3f, d.vec3f],
  d.vec4f,
)((screenPosition, normal, dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const interiorEnvelope =
    1 - std.smoothstep(0.96, 1.09, std.length(screenPosition));
  const sideEnvelope =
    std.smoothstep(-1.08, -0.92, screenPosition.x) *
    (1 - std.smoothstep(0.9, 1.06, screenPosition.x));
  const topCoverage =
    std.smoothstep(-0.28, 0.12, screenPosition.y) *
    (1 - std.smoothstep(0.94, 1.12, screenPosition.y + screenPosition.x * 0.06));
  const upperLeftLift =
    1 +
    (1 - std.smoothstep(-0.82, 0.16, screenPosition.x)) *
      std.smoothstep(-0.16, 0.72, screenPosition.y) *
      0.28;
  const crownFade =
    1 - std.smoothstep(0.9, 1.13, screenPosition.y + screenPosition.x * 0.07);
  const topCenterLift =
    1 +
    std.exp(
      -(
        (screenPosition.x * screenPosition.x) / 0.58 +
        ((screenPosition.y - 0.54) * (screenPosition.y - 0.54)) / 0.22
      ),
    ) *
      0.38;
  const topEnvelope =
    topCoverage *
    sideEnvelope *
    interiorEnvelope *
    (0.72 + std.smoothstep(-0.7, 0.34, normal.z) * 0.28) *
    (0.78 + std.smoothstep(-0.88, 0.22, dir.z) * 0.22) *
    upperLeftLift *
    topCenterLift *
    (0.66 + crownFade * 0.34);
  const ringDir = std.normalize(
    d.vec3f(
      dir.x + screenPosition.x * 0.08,
      dir.y + screenPosition.y * 0.04,
      dir.z,
    ),
  );
  const phase = sampleFoldPhase(ringDir, 2.42, 1.22, 0.006);
  const crestWave = std.sin(phase);
  const shadowWave = std.sin(phase - 0.72);
  const height = crestWave * 0.5 + 0.5;
  const shadowHeight = shadowWave * 0.5 + 0.5;
  const slope = std.cos(phase);
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.018);
  const widthGain = std.smoothstep(0.004, 0.018, foldWidth);
  const edgeCrestFade =
    (0.42 +
      (1 - std.smoothstep(0.66, 0.92, std.abs(screenPosition.x))) * 0.58) *
    (0.56 + interiorEnvelope * 0.44);
  const crest =
    std.smoothstep(0.9992 - widthGain * 0.0007, 1, height) *
    topEnvelope *
    (0.84 + std.smoothstep(0.0, 0.82, -slope) * 0.16) *
    edgeCrestFade *
    0.54;
  const body =
    std.smoothstep(0.946 - widthGain * 0.013, 0.99, height) *
    (1 - std.smoothstep(0.995, 1, height) * 0.52) *
    topEnvelope *
    0.2;
  const shadow =
    std.smoothstep(0.74 - widthGain * 0.032, 0.95, shadowHeight) *
    std.smoothstep(0.1, 0.9, -slope) *
    topEnvelope *
    (1 - crest * 0.14) *
    0.96;
  const trough =
    std.smoothstep(0.74 - widthGain * 0.032, 0.95, 1 - height) *
    std.smoothstep(-0.02, 0.74, -slope) *
    topEnvelope *
    0.98;

  return d.vec4f(
    std.clamp(crest, 0, 1),
    std.clamp(body, 0, 1),
    std.clamp(shadow, 0, 1),
    std.clamp(trough, 0, 1),
  );
});

const sampleScreenTopSheetRidgeMask = tgpu.fn(
  [d.vec2f, d.vec3f],
  d.vec2f,
)((screenPosition, normal) => {
  "use gpu";

  const params = renderLayout.$.params;
  const foldMasks = sampleScreenTopFoldMasks(
    screenPosition,
    normal,
    std.normalize(d.vec3f(screenPosition, 0.64)),
  );

  return d.vec2f(
    std.clamp(foldMasks.x * 0.52 + foldMasks.y * 0.16, 0, 1),
    std.clamp(foldMasks.w * 0.46 + foldMasks.y * params.glow * 0.08, 0, 1),
  );
});

const sampleTopRidgeMask = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const foldMasks = sampleSphereTopFoldMasks(dir);

  return std.clamp(
    std.max(foldMasks.x, foldMasks.y * 0.36) + foldMasks.z * 0.16,
    0,
    1,
  );
});

const sampleSphereCentralFoldMasks = tgpu.fn([d.vec3f], d.vec4f)((dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const projectedInterior =
    1 - std.smoothstep(0.92, 1.08, std.length(dir.xy));
  const sideFade =
    std.smoothstep(-1.02, -0.86, dir.x) *
    (1 - std.smoothstep(0.92, 1.06, dir.x));
  const verticalCoverage =
    std.smoothstep(-0.78, -0.6, dir.y) *
    (1 - std.smoothstep(0.58, 0.78, dir.y));
  const frontWrap = std.smoothstep(-0.64, 0.18, dir.z);
  const rightSideLift = 1 + std.smoothstep(0.22, 0.9, dir.x) * 0.36;
  const lowerCenterLift = 1 + std.smoothstep(0.02, 0.56, -dir.y) * 0.18;
  const lowerCenterFill =
    projectedInterior *
    sideFade *
    std.smoothstep(-0.96, -0.78, dir.y) *
    (1 - std.smoothstep(-0.16, 0.08, dir.y)) *
    (1 - std.smoothstep(0.5, 0.86, std.abs(dir.x - dir.y * 0.08))) *
    std.smoothstep(-0.56, 0.18, dir.z) *
    0.2;
  const rightSideFill =
    (1 - std.smoothstep(0.94, 1.1, std.length(dir.xy))) *
    std.smoothstep(0.34, 0.78, dir.x) *
    (1 - std.smoothstep(0.98, 1.08, dir.x)) *
    std.smoothstep(-0.9, -0.66, dir.y) *
    (1 - std.smoothstep(0.68, 0.86, dir.y)) *
    std.smoothstep(-0.68, 0.2, dir.z) *
    0.34;
  const centralFace =
    projectedInterior *
    sideFade *
    verticalCoverage *
    frontWrap *
    rightSideLift *
    lowerCenterLift *
    0.92;
  const phase = sampleFoldPhase(dir, 2.62, 1.42, 0.026);
  const crestWave = std.sin(phase);
  const shadowWave = std.sin(phase - 0.72);
  const height = crestWave * 0.5 + 0.5;
  const shadowHeight = shadowWave * 0.5 + 0.5;
  const slope = std.cos(phase);
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.018);
  const widthGain = std.smoothstep(0.004, 0.018, foldWidth);
  const lowerPhase = sampleFoldPhase(dir, 3.32, 1.6, 0.108);
  const lowerCrestWave = std.sin(lowerPhase);
  const lowerShadowWave = std.sin(lowerPhase - 0.72);
  const lowerHeight = lowerCrestWave * 0.5 + 0.5;
  const lowerShadowHeight = lowerShadowWave * 0.5 + 0.5;
  const lowerSlope = std.cos(lowerPhase);
  const fineLowerFill =
    projectedInterior *
    sideFade *
    std.smoothstep(0.16, 0.64, -dir.y) *
    (1 - std.smoothstep(0.84, 0.98, -dir.y)) *
    (1 - std.smoothstep(0.34, 0.7, std.abs(dir.x + dir.y * 0.06))) *
    std.smoothstep(-0.56, 0.22, dir.z) *
    0.36;
  const fineLowerPhase = sampleFoldPhase(dir, 4.16, 1.78, 0.184);
  const fineLowerHeight = std.sin(fineLowerPhase) * 0.5 + 0.5;
  const fineLowerShadowHeight = std.sin(fineLowerPhase - 0.72) * 0.5 + 0.5;
  const fineLowerSlope = std.cos(fineLowerPhase);
  const microLowerPhase = sampleFoldPhase(dir, 5.04, 1.96, 0.252);
  const microLowerHeight = std.sin(microLowerPhase) * 0.5 + 0.5;
  const microLowerShadowHeight = std.sin(microLowerPhase - 0.72) * 0.5 + 0.5;
  const microLowerSlope = std.cos(microLowerPhase);
  const microLowerFill =
    projectedInterior *
    sideFade *
    std.smoothstep(0.28, 0.72, -dir.y) *
    (1 - std.smoothstep(0.86, 1, -dir.y)) *
    (1 - std.smoothstep(0.3, 0.66, std.abs(dir.x + dir.y * 0.04))) *
    std.smoothstep(-0.5, 0.24, dir.z) *
    0.3;
  const lowerCrest =
    std.smoothstep(0.9991 - widthGain * 0.0007, 1, lowerHeight) *
    lowerCenterFill *
    0.32;
  const lowerBody =
    std.smoothstep(0.954 - widthGain * 0.012, 0.991, lowerHeight) *
    (1 - std.smoothstep(0.995, 1, lowerHeight) * 0.52) *
    lowerCenterFill *
    0.16;
  const lowerShadow =
    std.smoothstep(0.76 - widthGain * 0.028, 0.952, lowerShadowHeight) *
    std.smoothstep(0.1, 0.9, -lowerSlope) *
    lowerCenterFill *
    (1 - lowerCrest * 0.14) *
    0.78;
  const lowerTrough =
    std.smoothstep(0.76 - widthGain * 0.028, 0.952, 1 - lowerHeight) *
    std.smoothstep(-0.02, 0.74, -lowerSlope) *
    lowerCenterFill *
    0.7;
  const fineLowerCrest =
    std.smoothstep(0.9992 - widthGain * 0.0006, 1, fineLowerHeight) *
    fineLowerFill *
    0.48;
  const fineLowerBody =
    std.smoothstep(0.96 - widthGain * 0.01, 0.992, fineLowerHeight) *
    (1 - std.smoothstep(0.996, 1, fineLowerHeight) * 0.58) *
    fineLowerFill *
    0.11;
  const fineLowerShadow =
    std.smoothstep(0.78 - widthGain * 0.024, 0.956, fineLowerShadowHeight) *
    std.smoothstep(0.1, 0.9, -fineLowerSlope) *
    fineLowerFill *
    0.52;
  const fineLowerTrough =
    std.smoothstep(0.78 - widthGain * 0.024, 0.956, 1 - fineLowerHeight) *
    std.smoothstep(-0.02, 0.74, -fineLowerSlope) *
    fineLowerFill *
    0.5;
  const microLowerCrest =
    std.smoothstep(0.9993 - widthGain * 0.00055, 1, microLowerHeight) *
    microLowerFill *
    0.42;
  const microLowerBody =
    std.smoothstep(0.964 - widthGain * 0.009, 0.993, microLowerHeight) *
    (1 - std.smoothstep(0.996, 1, microLowerHeight) * 0.6) *
    microLowerFill *
    0.08;
  const microLowerShadow =
    std.smoothstep(0.76 - widthGain * 0.028, 0.95, microLowerShadowHeight) *
    std.smoothstep(0.1, 0.9, -microLowerSlope) *
    microLowerFill *
    0.42;
  const microLowerTrough =
    std.smoothstep(0.76 - widthGain * 0.028, 0.95, 1 - microLowerHeight) *
    std.smoothstep(-0.02, 0.74, -microLowerSlope) *
    microLowerFill *
    0.4;
  const sidePhase = sampleFoldPhase(dir, 3.78, 1.66, -0.042);
  const sideCrestWave = std.sin(sidePhase);
  const sideShadowWave = std.sin(sidePhase - 0.72);
  const sideHeight = sideCrestWave * 0.5 + 0.5;
  const sideShadowHeight = sideShadowWave * 0.5 + 0.5;
  const sideSlope = std.cos(sidePhase);
  const sideCrest =
    std.smoothstep(0.9991 - widthGain * 0.00065, 1, sideHeight) *
    rightSideFill *
    0.5;
  const sideBody =
    std.smoothstep(0.956 - widthGain * 0.011, 0.991, sideHeight) *
    (1 - std.smoothstep(0.995, 1, sideHeight) * 0.56) *
    rightSideFill *
    0.13;
  const sideShadow =
    std.smoothstep(0.76 - widthGain * 0.026, 0.954, sideShadowHeight) *
    std.smoothstep(0.1, 0.9, -sideSlope) *
    rightSideFill *
    (1 - sideCrest * 0.14) *
    0.82;
  const sideTrough =
    std.smoothstep(0.76 - widthGain * 0.026, 0.954, 1 - sideHeight) *
    std.smoothstep(-0.02, 0.74, -sideSlope) *
    rightSideFill *
    0.66;
  const centralCrest =
    std.smoothstep(0.9991 - widthGain * 0.0007, 1, height) *
    centralFace *
    (0.48 + rightSideLift * 0.04);
  const centralBody =
    std.smoothstep(0.954 - widthGain * 0.012, 0.991, height) *
    (1 - std.smoothstep(0.995, 1, height) * 0.56) *
    centralFace *
    0.15;
  const centralShadow =
    std.smoothstep(0.75 - widthGain * 0.028, 0.952, shadowHeight) *
    std.smoothstep(0.08, 0.9, -slope) *
    centralFace *
    (1 - centralCrest * 0.14) *
    0.9;
  const centralTrough =
    std.smoothstep(0.75 - widthGain * 0.028, 0.952, 1 - height) *
    std.smoothstep(-0.02, 0.74, -slope) *
    centralFace *
    0.76;
  const crest =
    centralCrest + lowerCrest + sideCrest + fineLowerCrest + microLowerCrest;
  const body =
    centralBody + lowerBody + sideBody + fineLowerBody + microLowerBody;
  const shadow =
    centralShadow + lowerShadow + sideShadow + fineLowerShadow + microLowerShadow;
  const trough =
    centralTrough + lowerTrough + sideTrough + fineLowerTrough + microLowerTrough;

  return d.vec4f(
    std.clamp(crest, 0, 1),
    std.clamp(body, 0, 1),
    std.clamp(shadow, 0, 1),
    std.clamp(trough, 0, 1),
  );
});

const sampleLowerArcMask = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const bias = sampleFoldRingBias(dir);
  const lowerEnvelope =
    std.smoothstep(0.04, 0.62, -dir.y) *
    (1 - std.smoothstep(0.86, 1.04, -dir.y)) *
    std.smoothstep(-0.58, 0.36, dir.z) *
    (1 - std.smoothstep(0.84, 1.08, std.length(dir.xy))) *
    (0.62 + bias.z * 0.38);
  const phase = sampleFoldPhase(dir, 4.34, 1.72, 0.154);
  const height = std.sin(phase) * 0.5 + 0.5;
  const shadowHeight = std.sin(phase - 0.68) * 0.5 + 0.5;
  const slope = std.cos(phase);
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.014);
  const widthGain = std.smoothstep(0.004, 0.014, foldWidth);
  const core =
    std.smoothstep(0.99925 - widthGain * 0.0006, 1, height) *
    lowerEnvelope *
    0.3;
  const shadow =
    std.smoothstep(0.78 - widthGain * 0.022, 0.956, shadowHeight) *
    std.smoothstep(0.1, 0.9, -slope) *
    lowerEnvelope *
    0.16;

  return std.clamp(core + shadow, 0, 1);
});

const sampleScreenLowerArcMask = tgpu.fn(
  [d.vec2f, d.vec3f],
  d.f32,
)((screenPosition, dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const bias = sampleFoldRingBias(dir);
  const lowerEnvelope =
    std.smoothstep(-0.78, -0.48, screenPosition.y) *
    (1 - std.smoothstep(-0.24, -0.02, screenPosition.y)) *
    (1 - std.smoothstep(0.88, 1.04, std.abs(screenPosition.x))) *
    (0.64 + bias.z * 0.36);
  const ringDir = std.normalize(
    d.vec3f(
      dir.x + screenPosition.x * 0.06,
      dir.y + screenPosition.y * 0.04,
      dir.z,
    ),
  );
  const phase = sampleFoldPhase(ringDir, 4.52, 1.84, 0.17);
  const height = std.sin(phase) * 0.5 + 0.5;
  const shadowHeight = std.sin(phase - 0.68) * 0.5 + 0.5;
  const slope = std.cos(phase);
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.014);
  const widthGain = std.smoothstep(0.004, 0.014, foldWidth);
  const core =
    std.smoothstep(0.99925 - widthGain * 0.00055, 1, height) *
    lowerEnvelope *
    0.13;
  const shadow =
    std.smoothstep(0.78 - widthGain * 0.022, 0.956, shadowHeight) *
    std.smoothstep(0.1, 0.9, -slope) *
    lowerEnvelope *
    0.07;

  return std.clamp(core + shadow, 0, 1);
});

const sampleScreenLowerArcCoreMask = tgpu.fn(
  [d.vec2f, d.vec3f],
  d.f32,
)((screenPosition, dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const bias = sampleFoldRingBias(dir);
  const lowerEnvelope =
    std.smoothstep(-0.78, -0.48, screenPosition.y) *
    (1 - std.smoothstep(-0.24, -0.02, screenPosition.y)) *
    (1 - std.smoothstep(0.88, 1.04, std.abs(screenPosition.x))) *
    (0.62 + bias.z * 0.38);
  const ringDir = std.normalize(
    d.vec3f(
      dir.x + screenPosition.x * 0.06,
      dir.y + screenPosition.y * 0.04,
      dir.z,
    ),
  );
  const phase = sampleFoldPhase(ringDir, 4.52, 1.84, 0.17);
  const height = std.sin(phase) * 0.5 + 0.5;
  const foldWidth = std.clamp(params.foldWidth, 0.004, 0.014);
  const widthGain = std.smoothstep(0.004, 0.014, foldWidth);
  const core =
    std.smoothstep(0.99935 - widthGain * 0.0005, 1, height) *
    lowerEnvelope *
    0.1;

  return std.clamp(core, 0, 1);
});

const sampleFoldMask = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const topRidges = sampleTopRidgeMask(dir);
  const centralFoldMasks = sampleSphereCentralFoldMasks(dir);
  const centralRidges = std.clamp(
    std.max(centralFoldMasks.x, centralFoldMasks.y * 0.34) +
      centralFoldMasks.z * 0.16,
    0,
    1,
  );
  const lowerArc = sampleLowerArcMask(dir);
  const sourceGlow =
    (1 - std.smoothstep(0.02, 0.34, sampleFoldProgress(dir))) * 0.18;

  return std.clamp(
    std.max(std.max(topRidges, centralRidges), lowerArc) + sourceGlow,
    0,
    1,
  );
});

const sampleFabricDisplacement = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const progress = sampleFoldProgress(dir);
  const foldMask = sampleFoldMask(dir);
  const topFoldMasks = sampleSphereTopFoldMasks(dir);
  const topRelief =
    topFoldMasks.x * 0.5 +
    topFoldMasks.y * 0.14 -
    topFoldMasks.z * 0.32 -
    topFoldMasks.w * 0.18;
  const centralFoldMasks = sampleSphereCentralFoldMasks(dir);
  const centralRelief =
    centralFoldMasks.x * 0.48 +
    centralFoldMasks.y * 0.08 -
    centralFoldMasks.z * 0.36 -
    centralFoldMasks.w * 0.24;
  const broadContraction =
    params.contraction *
    std.smoothstep(0.52, 1, progress) *
    (0.18 + (1 - foldMask) * 0.16);

  return params.amplitude * (
    topRelief +
    centralRelief +
    foldMask * 0.04 -
    broadContraction
  );
});

const vertexFn = tgpu.vertexFn({
  in: {
    position: d.vec3f,
    normal: d.vec3f,
  },
  out: {
    pos: d.builtin.position,
    worldPosition: d.vec3f,
    worldNormal: d.vec3f,
    screenPosition: d.vec2f,
    foldMask: d.f32,
  },
})((input) => {
  "use gpu";

  const dir = std.normalize(input.position);
  const foldMask = sampleFoldMask(dir);
  const displacement = sampleFabricDisplacement(dir);
  const displacedPosition = std.mul(
    dir,
    renderLayout.$.params.radius + displacement,
  );
  const tangentSeed = std.select(
    d.vec3f(0, 1, 0),
    d.vec3f(1, 0, 0),
    std.abs(dir.y) > 0.92,
  );
  const tangent = std.normalize(std.cross(tangentSeed, dir));
  const bitangent = std.normalize(std.cross(dir, tangent));
  const sampleStep = 0.01;
  const tangentDir = std.normalize(std.add(dir, std.mul(tangent, sampleStep)));
  const bitangentDir = std.normalize(
    std.add(dir, std.mul(bitangent, sampleStep)),
  );
  const tangentPosition = std.mul(
    tangentDir,
    renderLayout.$.params.radius + sampleFabricDisplacement(tangentDir),
  );
  const bitangentPosition = std.mul(
    bitangentDir,
    renderLayout.$.params.radius + sampleFabricDisplacement(bitangentDir),
  );
  const estimatedNormal = std.normalize(
    std.cross(
      std.sub(tangentPosition, displacedPosition),
      std.sub(bitangentPosition, displacedPosition),
    ),
  );
  const localNormal = std.select(
    std.mul(estimatedNormal, -1),
    estimatedNormal,
    std.dot(estimatedNormal, dir) >= 0,
  );
  const modelPosition = std.mul(
    renderLayout.$.params.model,
    d.vec4f(displacedPosition, 1),
  );
  const worldNormal = std.mul(
    renderLayout.$.params.normalModel,
    d.vec4f(localNormal, 0),
  );
  const clipPosition = std.mul(
    renderLayout.$.params.mvp,
    d.vec4f(displacedPosition, 1),
  );
  const screenPosition = std.div(clipPosition.xy, d.vec2f(clipPosition.w));

  return {
    pos: clipPosition,
    worldPosition: modelPosition.xyz,
    worldNormal: std.normalize(worldNormal.xyz),
    screenPosition,
    foldMask,
  };
});

const fragmentFn = tgpu.fragmentFn({
  in: {
    worldPosition: d.vec3f,
    worldNormal: d.vec3f,
    screenPosition: d.vec2f,
    foldMask: d.f32,
  },
  out: d.vec4f,
})((input) => {
  "use gpu";

  const params = renderLayout.$.params;
  const normal = std.normalize(input.worldNormal);
  const light = std.normalize(d.vec3f(-0.42, 0.58, 0.7));
  const view = std.normalize(std.sub(d.vec3f(0, 0, 3.4), input.worldPosition));
  const halfVector = std.normalize(std.add(light, view));
  const diffuse = std.clamp(std.dot(normal, light), 0, 1);
  const specular = std.pow(std.clamp(std.dot(normal, halfVector), 0, 1), 36);
  const rim = std.pow(std.clamp(1 - std.dot(normal, view), 0, 1), 2.2);
  const dir = std.normalize(input.worldPosition);
  const topFoldMasks = sampleScreenTopFoldMasks(
    input.screenPosition,
    normal,
    dir,
  );
  const topCrest = topFoldMasks.x;
  const topBody = topFoldMasks.y;
  const topShadow = topFoldMasks.z;
  const topTrough = topFoldMasks.w;
  const centralFoldMasks = sampleSphereCentralFoldMasks(dir);
  const centralCrest = centralFoldMasks.x;
  const centralBody = centralFoldMasks.y;
  const centralShadow = centralFoldMasks.z;
  const centralTrough = centralFoldMasks.w;
  const topSheetRidges = sampleScreenTopSheetRidgeMask(
    input.screenPosition,
    normal,
  );
  const topSheetCore = topSheetRidges.x;
  const topSheetGlow = topSheetRidges.y;
  const screenLowerArc = sampleScreenLowerArcMask(input.screenPosition, dir);
  const screenLowerArcCore = sampleScreenLowerArcCoreMask(
    input.screenPosition,
    dir,
  );
  const lowerArc = screenLowerArc;
  const crestTint = std.mix(params.waveColor, params.highlightColor, 0.34);
  const softHighlightTint = std.mix(
    params.baseColor,
    params.highlightColor,
    0.42,
  );
  const silhouetteFade = std.smoothstep(
    0.68,
    0.96,
    std.length(input.screenPosition),
  );
  const edgeFoldCalm = 1 - silhouetteFade * 0.8;
  const rimLightCalm = 1 - silhouetteFade * 0.62;
  const crestHighlightMask =
    (topCrest + centralCrest * 0.78) * edgeFoldCalm;
  const foldMask = std.clamp(
    std.max(
      std.max(std.max(input.foldMask, topCrest), topBody),
      std.max(centralCrest, centralBody),
    ),
    0,
    1,
  );
  const facingMask = std.smoothstep(-0.08, 0.5, normal.z);
  const surfaceMask = std.smoothstep(0.02, 0.72, std.dot(normal, view));
  const foldBrightness =
    (0.32 + foldMask * 0.52) * facingMask * surfaceMask;
  const verticalWash = std.smoothstep(-0.72, 0.7, dir.y);
  const frontInterior =
    (1 - std.smoothstep(0.7, 0.94, std.length(input.screenPosition))) *
    std.smoothstep(-0.48, 0.42, normal.z);
  const leftPinkWash =
    std.exp(
      -(
        ((input.screenPosition.x + 0.52 + input.screenPosition.y * 0.16) *
          (input.screenPosition.x + 0.52 + input.screenPosition.y * 0.16)) /
          0.34 +
        ((input.screenPosition.y - 0.02 - input.screenPosition.x * 0.22) *
          (input.screenPosition.y - 0.02 - input.screenPosition.x * 0.22)) /
          0.92
      ),
    ) *
    frontInterior *
    std.smoothstep(-0.58, 0.32, dir.z);
  const leftMiddleBand =
    std.exp(
      -(
        ((input.screenPosition.x + 0.5 + input.screenPosition.y * 0.18) *
          (input.screenPosition.x + 0.5 + input.screenPosition.y * 0.18)) /
          0.14 +
        ((input.screenPosition.y + 0.02 - input.screenPosition.x * 0.16) *
          (input.screenPosition.y + 0.02 - input.screenPosition.x * 0.16)) /
          0.72
      ),
    ) *
    frontInterior;
  const leftInteriorGlow =
    std.exp(
      -(
        ((input.screenPosition.x + 0.28 + input.screenPosition.y * 0.08) *
          (input.screenPosition.x + 0.28 + input.screenPosition.y * 0.08)) /
          0.5 +
        ((input.screenPosition.y + 0.04 - input.screenPosition.x * 0.1) *
          (input.screenPosition.y + 0.04 - input.screenPosition.x * 0.1)) /
          0.78
      ),
    ) *
    frontInterior *
    std.smoothstep(-0.56, 0.36, dir.z);
  const centerLavenderGlow =
    std.exp(
      -(
        ((input.screenPosition.x + 0.04) * (input.screenPosition.x + 0.04)) /
          0.58 +
        ((input.screenPosition.y + 0.08) * (input.screenPosition.y + 0.08)) /
          0.72
      ),
    ) *
    std.smoothstep(-0.52, 0.44, dir.z);
  const lowerLeftBand =
    std.exp(
      -(
        ((input.screenPosition.x + 0.42) * (input.screenPosition.x + 0.42)) /
          0.26 +
        ((input.screenPosition.y + 0.4 + input.screenPosition.x * 0.12) *
          (input.screenPosition.y + 0.4 + input.screenPosition.x * 0.12)) /
          0.14
      ),
    ) *
    frontInterior;
  const lowerGlow =
    std.exp(
      -(
        (input.screenPosition.x * input.screenPosition.x) / 0.7 +
        ((input.screenPosition.y + 0.52) * (input.screenPosition.y + 0.52)) /
          0.16
      ),
    ) *
    0.16;
  const leftLowerPinkGlow =
    std.exp(
      -(
        ((input.screenPosition.x + 0.54) * (input.screenPosition.x + 0.54)) /
          0.22 +
        ((input.screenPosition.y + 0.36) * (input.screenPosition.y + 0.36)) /
          0.28
      ),
    ) *
    std.smoothstep(-0.56, 0.32, dir.z);
  const edgeHaze =
    std.pow(std.clamp(1 - std.dot(normal, view), 0, 1), 1.35) *
    std.smoothstep(-0.42, 0.52, normal.z);
  const foldRelief = std.clamp(
    topCrest * 0.72 +
      topBody * 0.22 -
      topShadow * 0.82 -
      topTrough * 0.34 +
      centralCrest * 0.66 +
      centralBody * 0.14 -
      centralShadow * 0.86 -
      centralTrough * 0.48,
    -1,
    1.35,
  );
  const foldSideLight = std.clamp(
    0.5 - input.screenPosition.y * 0.2,
    0.32,
    0.72,
  );
  const reliefLighting = std.clamp(
    1 +
      foldRelief * (0.2 + foldBrightness * 0.18) -
      topShadow * 0.2 -
      centralShadow * 0.16,
    0.56,
    1.34,
  );
  const lighting =
    0.8 + diffuse * 0.1 + rim * rimLightCalm * 0.04 + specular * 0.05;
  let color = std.mix(
    params.shadowColor,
    params.baseColor,
    0.72 + verticalWash * 0.2,
  );
  color = std.mix(
    color,
    params.waveColor,
    (leftPinkWash * 0.68 +
      leftMiddleBand * 0.58 +
      leftInteriorGlow * 0.34 +
      lowerLeftBand * 0.52 +
      leftLowerPinkGlow * 0.42 +
      lowerGlow * 0.12) *
      params.glow,
  );
  color = std.mix(
    color,
    softHighlightTint,
    (centerLavenderGlow * 0.13 +
      leftInteriorGlow * 0.08 +
      leftMiddleBand * 0.06 +
      lowerLeftBand * 0.03) *
      params.glow,
  );
  color = std.mul(color, lighting);
  color = std.mul(color, reliefLighting);
  color = std.add(color, std.mul(crestTint, specular * 0.035));
  color = std.mix(
    color,
    params.waveColor,
    lowerArc * edgeFoldCalm * (0.07 + foldBrightness * 0.04),
  );
  color = std.mul(
    color,
    std.clamp(
      1 +
        topCrest * 0.09 +
        topBody * 0.035 -
        topShadow * 0.32 -
        topTrough * 0.1 +
        centralCrest * 0.08 +
        centralBody * 0.028 -
        centralShadow * 0.34 -
        centralTrough * 0.14,
      0.62,
      1.24,
    ),
  );
  color = std.mix(
    color,
    params.shadowColor,
    std.clamp(
      (topShadow + centralShadow * 0.88) * (0.3 + foldBrightness * 0.16),
      0,
      0.56,
    ),
  );
  color = std.mix(
    color,
    params.baseColor,
    std.clamp(
      (topShadow + centralShadow * 0.62) * foldSideLight * 0.22,
      0,
      0.34,
    ),
  );
  color = std.mix(
    color,
    params.baseColor,
    std.clamp((topBody + centralBody * 0.7) * 0.045, 0, 0.09),
  );
  color = std.add(
    color,
    std.mul(
      params.waveColor,
      (topTrough * 0.28 + centralTrough * 0.24 + topSheetGlow * 0.1) *
        params.glow,
    ),
  );
  color = std.mix(
    color,
    crestTint,
    std.clamp(
      (crestHighlightMask * (0.18 + foldBrightness * 0.12) +
        topSheetCore * edgeFoldCalm * 0.024) *
        params.glow,
      0,
      0.26,
    ),
  );
  color = std.add(
    color,
    std.mul(
      params.waveColor,
      (lowerArc * (0.06 + foldBrightness * 0.04) + screenLowerArcCore * 0.055) *
        edgeFoldCalm,
    ),
  );
  color = std.add(
    color,
    std.mul(crestTint, screenLowerArcCore * edgeFoldCalm * params.glow * 0.01),
  );
  color = std.add(
    color,
    std.mul(
      params.waveColor,
      screenLowerArc * edgeFoldCalm * params.glow * 0.026,
    ),
  );
  color = std.add(
    color,
    std.mul(
      params.waveColor,
      (topTrough + centralTrough * 0.82) * (0.1 + foldBrightness * 0.06),
    ),
  );
  color = std.add(
    color,
    std.mul(
      crestTint,
      crestHighlightMask * params.glow * 0.026,
    ),
  );
  color = std.add(
    color,
    std.mul(params.waveColor, topSheetGlow * params.glow * 0.04),
  );
  color = std.add(
    color,
    std.mul(params.shadowColor, (topShadow + centralShadow * 0.86) * 0.04),
  );
  color = std.add(
    color,
    std.mul(
      params.waveColor,
      edgeHaze * edgeFoldCalm * (0.018 + params.glow * 0.012),
    ),
  );
  color = std.add(
    color,
    std.mul(params.waveColor, leftLowerPinkGlow * params.glow * 0.05),
  );
  color = std.add(color, std.mul(params.baseColor, rim * rimLightCalm * 0.02));
  color = std.clamp(color, d.vec3f(0), d.vec3f(1));

  return d.vec4f(color, 1);
});

export const createFabricBallEffect: ShaderEffectFactory = (root) => {
  const mesh = createSphereMesh();
  const vertexBuffer = root
    .createBuffer(VertexDataArray, mesh.vertices)
    .$usage("vertex");
  const indexBuffer = root
    .createBuffer(IndexDataArray, mesh.indices)
    .$usage("index");
  const paramsBuffer = root
    .createBuffer(
      FabricBallParams,
      createParams(
        new Float32Array(16),
        new Float32Array(16),
        new Float32Array(16),
        0,
        d.vec2f(1, 1),
      ),
    )
    .$usage("uniform");
  const renderBindGroup = root.createBindGroup(renderLayout, {
    params: paramsBuffer,
  });
  const renderPipeline = root.createRenderPipeline({
    attribs: vertexLayout.attrib,
    vertex: vertexFn,
    fragment: fragmentFn,
    primitive: {
      cullMode: "back",
      frontFace: "cw",
      topology: "triangle-list",
    },
  });
  const modelMatrix = new Float32Array(16);
  const viewMatrix = new Float32Array(16);
  const projectionMatrix = new Float32Array(16);
  const viewProjectionMatrix = new Float32Array(16);
  const mvpMatrix = new Float32Array(16);
  const normalModelMatrix = new Float32Array(16);

  const writeParams = (
    canvasSize: ShaderEffectCanvasSize,
    elapsedSeconds: number,
    runtimeControls?: ShaderEffectRuntimeControls,
  ) => {
    const controls =
      runtimeControls?.fabricBall ?? FABRIC_BALL_RUNTIME_CONTROL_DEFAULTS;
    const aspect =
      canvasSize.width > 0 && canvasSize.height > 0
        ? canvasSize.width / canvasSize.height
        : 1;
    const cameraDistance = 3.72 / Math.min(1, Math.max(0.5, aspect));

    mat4.identity(modelMatrix);
    mat4.identity(normalModelMatrix);
    mat4.lookAt([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0], viewMatrix);
    mat4.perspective((Math.PI / 180) * 35, aspect, 0.1, 100, projectionMatrix);
    mat4.multiply(projectionMatrix, viewMatrix, viewProjectionMatrix);
    mat4.multiply(viewProjectionMatrix, modelMatrix, mvpMatrix);

    paramsBuffer.write(
      createParams(
        mvpMatrix,
        modelMatrix,
        normalModelMatrix,
        elapsedSeconds,
        getResolution(canvasSize),
        controls,
      ),
    );
  };

  return {
    render: (ctx, _audioFrame, elapsedSeconds, canvasSize, runtimeControls) => {
      writeParams(canvasSize, elapsedSeconds, runtimeControls);

      renderPipeline
        .with(vertexLayout, vertexBuffer)
        .withIndexBuffer(indexBuffer)
        .with(renderBindGroup)
        .withColorAttachment({
          view: ctx,
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        })
        .drawIndexed(INDEX_COUNT);
    },
    dispose: () => {
      vertexBuffer.destroy();
      indexBuffer.destroy();
      paramsBuffer.destroy();
    },
  };
};
