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

const SphereParams = d.struct({
  mvp: d.mat4x4f,
  model: d.mat4x4f,
  normalModel: d.mat4x4f,
  radius: d.f32,
  ambientStrength: d.f32,
  diffuseStrength: d.f32,
  specularStrength: d.f32,
  specularPower: d.f32,
  rimStrength: d.f32,
  baseColor: d.vec3f,
  shadowColor: d.vec3f,
  highlightColor: d.vec3f,
  rimColor: d.vec3f,
});

type SphereParamsValue = d.InferInput<typeof SphereParams>;
type VertexDataValue = d.InferInput<typeof VertexData>;

const renderLayout = tgpu.bindGroupLayout({
  params: { uniform: SphereParams, visibility: ["vertex", "fragment"] },
});

type HexColor = `#${string}`;
type Vec3 = [number, number, number];
type Triangle = [number, number, number];

const SPHERE_COLORS_HEX = {
  base: "#B9C7FF",
  shadow: "#5C6FD6",
  highlight: "#FFF2FF",
  rim: "#C8FBFF",
} satisfies Record<string, HexColor>;

const SPHERE_DEFAULTS = {
  radius: 0.84,
  ambientStrength: 0.28,
  diffuseStrength: 0.66,
  specularStrength: 0.34,
  specularPower: 52,
  rimStrength: 0.2,
};

const TRANSPARENT_CLEAR_COLOR = [0, 0, 0, 0] as const;

const createColor = (hex: HexColor) =>
  d.vec3f(
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
  );

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
      `Sphere mesh has ${vertices.length} vertices, exceeding u16 indices.`,
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
): SphereParamsValue => ({
  mvp,
  model,
  normalModel,
  radius: SPHERE_DEFAULTS.radius,
  ambientStrength: SPHERE_DEFAULTS.ambientStrength,
  diffuseStrength: SPHERE_DEFAULTS.diffuseStrength,
  specularStrength: SPHERE_DEFAULTS.specularStrength,
  specularPower: SPHERE_DEFAULTS.specularPower,
  rimStrength: SPHERE_DEFAULTS.rimStrength,
  baseColor: createColor(SPHERE_COLORS_HEX.base),
  shadowColor: createColor(SPHERE_COLORS_HEX.shadow),
  highlightColor: createColor(SPHERE_COLORS_HEX.highlight),
  rimColor: createColor(SPHERE_COLORS_HEX.rim),
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
  },
})((input) => {
  "use gpu";

  const params = renderLayout.$.params;
  const localPosition = std.mul(input.position, params.radius);
  const modelPosition = std.mul(params.model, d.vec4f(localPosition, 1));
  const worldNormal = std.mul(params.normalModel, d.vec4f(input.normal, 0));
  const clipPosition = std.mul(params.mvp, d.vec4f(localPosition, 1));

  return {
    pos: clipPosition,
    worldPosition: modelPosition.xyz,
    worldNormal: std.normalize(worldNormal.xyz),
  };
});

const fragmentFn = tgpu.fragmentFn({
  in: {
    worldPosition: d.vec3f,
    worldNormal: d.vec3f,
  },
  out: d.vec4f,
})((input) => {
  "use gpu";

  const params = renderLayout.$.params;
  const normal = std.normalize(input.worldNormal);
  const light = std.normalize(d.vec3f(-0.44, 0.58, 0.68));
  const fillLight = std.normalize(d.vec3f(0.48, -0.24, 0.82));
  const view = std.normalize(std.sub(d.vec3f(0, 0, 3.8), input.worldPosition));
  const halfVector = std.normalize(std.add(light, view));
  const diffuse = std.clamp(std.dot(normal, light), 0, 1);
  const fill = std.clamp(std.dot(normal, fillLight), 0, 1);
  const viewFacing = std.clamp(std.dot(normal, view), 0, 1);
  const specular =
    std.pow(std.clamp(std.dot(normal, halfVector), 0, 1), params.specularPower) *
    params.specularStrength;
  const rim =
    std.pow(std.clamp(1 - viewFacing, 0, 1), 2.45) * params.rimStrength;
  const vertical = std.smoothstep(-0.78, 0.86, normal.y);
  const lightAmount =
    params.ambientStrength +
    diffuse * params.diffuseStrength +
    fill * 0.12;

  let color = std.mix(params.shadowColor, params.baseColor, lightAmount);
  color = std.mix(color, params.highlightColor, vertical * 0.12 + specular);
  color = std.add(color, std.mul(params.rimColor, rim));
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
      SphereParams,
      createParams(
        new Float32Array(16),
        new Float32Array(16),
        new Float32Array(16),
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

  const writeParams = (canvasSize: ShaderEffectCanvasSize) => {
    const aspect =
      canvasSize.width > 0 && canvasSize.height > 0
        ? canvasSize.width / canvasSize.height
        : 1;
    const cameraDistance = 3.75 / Math.min(1, Math.max(0.5, aspect));

    mat4.identity(modelMatrix);
    mat4.identity(normalModelMatrix);
    mat4.lookAt([0, 0, cameraDistance], [0, 0, 0], [0, 1, 0], viewMatrix);
    mat4.perspective((Math.PI / 180) * 35, aspect, 0.1, 100, projectionMatrix);
    mat4.multiply(projectionMatrix, viewMatrix, viewProjectionMatrix);
    mat4.multiply(viewProjectionMatrix, modelMatrix, mvpMatrix);

    paramsBuffer.write(createParams(mvpMatrix, modelMatrix, normalModelMatrix));
  };

  return {
    render: (ctx, _audioFrame, _elapsedSeconds, canvasSize) => {
      writeParams(canvasSize);

      renderPipeline
        .with(vertexLayout, vertexBuffer)
        .withIndexBuffer(indexBuffer)
        .with(renderBindGroup)
        .withColorAttachment({
          view: ctx,
          clearValue: TRANSPARENT_CLEAR_COLOR,
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
