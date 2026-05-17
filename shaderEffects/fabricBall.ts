import { perlin3d } from "@typegpu/noise";
import tgpu, { d, std } from "typegpu";
import { mat4 } from "wgpu-matrix";

import type { ShaderEffectCanvasSize, ShaderEffectFactory } from "./types";

const LONGITUDE_SEGMENTS = 256;
const LATITUDE_SEGMENTS = LONGITUDE_SEGMENTS / 2;
const VERTEX_COLUMNS = LONGITUDE_SEGMENTS + 1;
const VERTEX_ROWS = LATITUDE_SEGMENTS + 1;
const VERTEX_COUNT = VERTEX_COLUMNS * VERTEX_ROWS;
const INDEX_COUNT = LONGITUDE_SEGMENTS * LATITUDE_SEGMENTS * 6;

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

const FABRIC_BALL_COLORS_HEX = {
  base: brandColors.red80,
  highlight: brandColors.red20,
  wave: brandColors.red60,
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

const createSphereMesh = () => {
  const vertices: VertexDataValue[] = [];
  const indices: number[] = [];

  for (let row = 0; row < VERTEX_ROWS; row++) {
    const v = row / LATITUDE_SEGMENTS;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let column = 0; column < VERTEX_COLUMNS; column++) {
      const u = column / LONGITUDE_SEGMENTS;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);
      const normal = d.vec3f(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);

      vertices.push({
        position: normal,
        normal,
      });
    }
  }

  for (let row = 0; row < LATITUDE_SEGMENTS; row++) {
    for (let column = 0; column < LONGITUDE_SEGMENTS; column++) {
      const topLeft = row * VERTEX_COLUMNS + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + VERTEX_COLUMNS;
      const bottomRight = bottomLeft + 1;

      indices.push(topLeft, bottomLeft, topRight);
      indices.push(topRight, bottomLeft, bottomRight);
    }
  }

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
): FabricBallParamsValue => ({
  mvp,
  model,
  normalModel,
  time,
  resolution,
  baseColor: createColor(FABRIC_BALL_COLORS_HEX.base),
  highlightColor: createColor(FABRIC_BALL_COLORS_HEX.highlight),
  waveColor: createColor(FABRIC_BALL_COLORS_HEX.wave),
  shadowColor: createColor(FABRIC_BALL_COLORS_HEX.shadow),
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

  const modelPosition = std.mul(
    renderLayout.$.params.model,
    d.vec4f(input.position, 1),
  );
  const worldNormal = std.mul(
    renderLayout.$.params.normalModel,
    d.vec4f(input.normal, 0),
  );
  const clipPosition = std.mul(
    renderLayout.$.params.mvp,
    d.vec4f(input.position, 1),
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
  ) => {
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
