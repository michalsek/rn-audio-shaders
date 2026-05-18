import { perlin3d } from "@typegpu/noise";
import tgpu, { d, std } from "typegpu";
import { mat4 } from "wgpu-matrix";

import type {
  ShaderEffectCanvasSize,
  ShaderEffectFactory,
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

const MountainsParams = d.struct({
  mvp: d.mat4x4f,
  model: d.mat4x4f,
  normalModel: d.mat4x4f,
  time: d.f32,
  resolution: d.vec2f,
  radius: d.f32,
  baseFreq: d.f32,
  secondaryFreq: d.f32,
  warpFreq: d.f32,
  warpAmp: d.f32,
  amplitude: d.f32,
  sharpness: d.f32,
  bias: d.f32,
  animationSpeed: d.f32,
  secondaryWeight: d.f32,
  baseColor: d.vec3f,
  highlightColor: d.vec3f,
  waveColor: d.vec3f,
  shadowColor: d.vec3f,
});

type MountainsParamsValue = d.InferInput<typeof MountainsParams>;
type VertexDataValue = d.InferInput<typeof VertexData>;

type MountainsRuntimeControls = {
  radius: number;
  baseFreq: number;
  secondaryFreq: number;
  warpFreq: number;
  warpAmp: number;
  amplitude: number;
  sharpness: number;
  bias: number;
  animationSpeed: number;
  secondaryWeight: number;
};

const renderLayout = tgpu.bindGroupLayout({
  params: { uniform: MountainsParams, visibility: ["vertex", "fragment"] },
});

type HexColor = `#${string}`;

export const MOUNTAINS_RUNTIME_CONTROL_DEFAULTS = {
  radius: 1,
  baseFreq: 2.8,
  secondaryFreq: 4,
  warpFreq: 2.1,
  warpAmp: 0.2,
  amplitude: 0.075,
  sharpness: 2.2,
  bias: 0.34,
  animationSpeed: 0.045,
  secondaryWeight: 0.1,
} satisfies MountainsRuntimeControls;

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

const MOUNTAINS_COLORS_HEX = {
  base: brandColors.green80,
  highlight: brandColors.red20,
  wave: brandColors.green60,
  shadow: brandColors.red100,
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
      `Mountains icosphere has ${vertices.length} vertices, exceeding u16 indices.`,
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
  controls: MountainsRuntimeControls = MOUNTAINS_RUNTIME_CONTROL_DEFAULTS,
): MountainsParamsValue => ({
  mvp,
  model,
  normalModel,
  time,
  resolution,
  radius: controls.radius,
  baseFreq: controls.baseFreq,
  secondaryFreq: controls.secondaryFreq,
  warpFreq: controls.warpFreq,
  warpAmp: controls.warpAmp,
  amplitude: controls.amplitude,
  sharpness: controls.sharpness,
  bias: controls.bias,
  animationSpeed: controls.animationSpeed,
  secondaryWeight: controls.secondaryWeight,
  baseColor: createColor(MOUNTAINS_COLORS_HEX.base),
  highlightColor: createColor(MOUNTAINS_COLORS_HEX.highlight),
  waveColor: createColor(MOUNTAINS_COLORS_HEX.wave),
  shadowColor: createColor(MOUNTAINS_COLORS_HEX.shadow),
});

const fbm3 = tgpu.fn([d.vec3f], d.f32)((point) => {
  "use gpu";

  const octave0 = perlin3d.sample(point) * 0.5;
  const octave1 =
    perlin3d.sample(std.add(std.mul(point, 2.03), d.vec3f(17.13, -9.27, 4.61))) *
    0.25;
  const octave2 =
    perlin3d.sample(std.add(std.mul(point, 4.07), d.vec3f(-6.41, 13.81, 19.19))) *
    0.125;

  return (octave0 + octave1 + octave2) / 0.875;
});

const sampleClothDisplacement = tgpu.fn([d.vec3f], d.f32)((dir) => {
  "use gpu";

  const params = renderLayout.$.params;
  const time = params.time * params.animationSpeed;
  const warpDomain = std.mul(dir, params.warpFreq);
  const warp = d.vec3f(
    perlin3d.sample(std.add(warpDomain, d.vec3f(time * 0.73, 11.37, -4.19))),
    perlin3d.sample(std.add(warpDomain, d.vec3f(-7.53, time * -0.61, 8.83))),
    perlin3d.sample(std.add(warpDomain, d.vec3f(5.29, -13.17, time * 0.47))),
  );
  const q = std.add(std.mul(dir, params.baseFreq), std.mul(warp, params.warpAmp));
  const primary = std.pow(1 - std.abs(fbm3(q)), params.sharpness);
  const secondaryDomain = std.add(
    std.add(
      std.mul(dir, params.secondaryFreq),
      std.mul(warp, params.warpAmp * 0.42),
    ),
    d.vec3f(time * -0.91 + 23.13, time * 0.57 - 15.71, time * 0.38 + 6.37),
  );
  const secondary =
    std.pow(1 - std.abs(fbm3(secondaryDomain)), params.sharpness * 0.78) *
    params.secondaryWeight;
  const balanced =
    (primary + secondary - params.bias) /
    (1 + params.secondaryWeight * 0.5);

  return params.amplitude * std.clamp(balanced, -0.62, 0.86);
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
  },
})((input) => {
  "use gpu";

  const dir = std.normalize(input.position);
  const displacement = sampleClothDisplacement(dir);
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
    renderLayout.$.params.radius + sampleClothDisplacement(tangentDir),
  );
  const bitangentPosition = std.mul(
    bitangentDir,
    renderLayout.$.params.radius + sampleClothDisplacement(bitangentDir),
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
  };
});

const fragmentFn = tgpu.fragmentFn({
  in: {
    worldPosition: d.vec3f,
    worldNormal: d.vec3f,
    screenPosition: d.vec2f,
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
  const minResolution = std.max(
    1,
    std.min(params.resolution.x, params.resolution.y),
  );
  const screenPosition = std.mul(
    input.screenPosition,
    std.div(params.resolution, d.vec2f(minResolution)),
  );
  const flowTime = params.time * 0.8;
  const pathDriftA = perlin3d.sample(d.vec3f(flowTime * 0.18, 1.37, -0.41));
  const pathDriftB = perlin3d.sample(d.vec3f(-0.73, flowTime * 0.15, 1.91));
  const pathDriftC = perlin3d.sample(d.vec3f(1.23, -0.52, flowTime * 0.13));
  const diagonalAxis = std.normalize(
    d.vec2f(0.70710678 + pathDriftA * 0.22, -0.70710678 + pathDriftB * 0.18),
  );
  const bandAxis = d.vec2f(-diagonalAxis.y, diagonalAxis.x);
  const screenDiagonal = std.dot(screenPosition, diagonalAxis);
  const alongBand =
    std.dot(screenPosition, bandAxis) +
    input.worldPosition.x * input.worldPosition.y * (0.18 + pathDriftC * 0.08);
  const lowNoise = perlin3d.sample(
    d.vec3f(
      input.worldPosition.x * 1.45 + flowTime * 0.14,
      input.worldPosition.y * 1.45 - flowTime * 0.09,
      input.worldPosition.z * 1.45 + flowTime * 0.11,
    ),
  );
  const detailNoise = perlin3d.sample(
    d.vec3f(
      input.worldPosition.x * 4.2 - flowTime * 0.18,
      input.worldPosition.y * 4.2 + flowTime * 0.14,
      input.worldPosition.z * 4.2 + alongBand * 0.32,
    ),
  );
  const lowNoise01 = lowNoise * 0.5 + 0.5;
  const detailNoise01 = detailNoise * 0.5 + 0.5;
  const orbitDrift = perlin3d.sample(
    d.vec3f(
      input.worldPosition.z * 0.8 + flowTime * 0.1,
      input.worldPosition.x * 0.8 - flowTime * 0.07,
      input.worldPosition.y * 0.8 + pathDriftC,
    ),
  );
  const surfaceBend =
    input.worldPosition.z * (0.58 + pathDriftA * 0.18) +
    input.worldPosition.x * input.worldPosition.y * (0.22 + pathDriftB * 0.12) -
    input.worldPosition.y * input.worldPosition.z * (0.16 + pathDriftC * 0.1) -
    input.worldPosition.x * input.worldPosition.z * (0.16 + pathDriftA * 0.1);
  const surfaceProgress =
    screenDiagonal * 0.78 +
    surfaceBend +
    lowNoise * 0.36 +
    detailNoise * 0.08 +
    orbitDrift * 0.2;
  const warpedDomain = d.vec3f(
    surfaceProgress * (1.1 + pathDriftA * 0.16) + orbitDrift * 0.36,
    alongBand * (1.35 + pathDriftB * 0.18) + lowNoise * 0.28,
    input.worldPosition.z * 1.25 + flowTime * 0.42 + pathDriftC * 0.24,
  );
  const ridgeNoise = perlin3d.sample(warpedDomain);
  const ridgeDetail = perlin3d.sample(
    d.vec3f(
      warpedDomain.x * 2.1 + detailNoise * 0.42,
      warpedDomain.y * 2.1 - lowNoise * 0.24,
      warpedDomain.z * 2.1 + flowTime * 0.18,
    ),
  );
  const ridgeNoise01 = ridgeNoise * 0.5 + 0.5;
  const ridgeDetail01 = ridgeDetail * 0.5 + 0.5;
  const waveWidth = 0.11 + lowNoise01 * 0.045 + detailNoise01 * 0.06;
  const ridgeCenter = 0.5 + orbitDrift * 0.16 + pathDriftB * 0.1;
  const ridgeDistance = std.abs(ridgeNoise01 - ridgeCenter);
  const core =
    1 - std.smoothstep(waveWidth * 0.24, waveWidth * 1.08, ridgeDistance);
  const glow =
    1 - std.smoothstep(waveWidth * 0.9, waveWidth * 3.6, ridgeDistance);
  const lengthTaper =
    1 -
    std.smoothstep(
      0.92 + lowNoise01 * 0.18,
      1.36 + detailNoise01 * 0.22,
      std.abs(alongBand + lowNoise * 0.16 + ridgeDetail * 0.18),
    );
  const waveMask = std.clamp(
    (core * 0.52 + glow * 0.3) *
      lengthTaper *
      (0.66 + detailNoise01 * 0.18 + ridgeDetail01 * 0.16),
    0,
    1,
  );
  const facingMask = std.smoothstep(0.0, 0.42, normal.z);
  const surfaceMask = std.smoothstep(0.04, 0.72, std.dot(normal, view));
  const localBrightness =
    0.32 + detailNoise01 * 0.28 + lowNoise01 * 0.12 + ridgeDetail01 * 0.16;
  const waveBrightness = localBrightness * facingMask * surfaceMask;
  const lighting = 0.36 + diffuse * 0.5 + rim * 0.12 + specular * 0.12;
  let color = std.mul(params.baseColor, lighting);
  color = std.mix(color, params.shadowColor, (1 - diffuse) * rim * 0.08);
  color = std.add(color, std.mul(params.highlightColor, specular * 0.08));
  const waveTint = std.mix(
    params.waveColor,
    params.highlightColor,
    core * ridgeDetail01 * 0.1,
  );
  color = std.mix(color, waveTint, waveMask * (0.24 + waveBrightness * 0.6));
  color = std.add(
    color,
    std.mul(params.waveColor, glow * waveBrightness * 0.055),
  );
  color = std.clamp(color, d.vec3f(0), d.vec3f(1));

  return d.vec4f(color, 1);
});

export const createMountainsEffect: ShaderEffectFactory = (root) => {
  const mesh = createSphereMesh();
  const vertexBuffer = root
    .createBuffer(VertexDataArray, mesh.vertices)
    .$usage("vertex");
  const indexBuffer = root
    .createBuffer(IndexDataArray, mesh.indices)
    .$usage("index");
  const paramsBuffer = root
    .createBuffer(
      MountainsParams,
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
  ) => {
    const controls = MOUNTAINS_RUNTIME_CONTROL_DEFAULTS;
    const aspect =
      canvasSize.width > 0 && canvasSize.height > 0
        ? canvasSize.width / canvasSize.height
        : 1;
    const cameraDistance = 3.45 / Math.min(1, Math.max(0.42, aspect));

    mat4.identity(modelMatrix);
    mat4.identity(normalModelMatrix);
    mat4.lookAt([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0], viewMatrix);
    mat4.perspective((Math.PI / 180) * 34, aspect, 0.1, 100, projectionMatrix);
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
    render: (ctx, _audioFrame, elapsedSeconds, canvasSize) => {
      writeParams(canvasSize, elapsedSeconds);

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
