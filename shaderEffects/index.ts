import { createEmptyEffect } from "./empty";
import { createLiquidEffect } from "./liquid";
import { createStaticGradientEffect } from "./staticGradient";
import type { ShaderEffect, ShaderEffectFactory } from "./types";

export type {
  ShaderEffect,
  ShaderEffectCanvasContext,
  ShaderEffectFactory,
  ShaderEffectRenderer,
} from "./types";
export { createEmptyEffect } from "./empty";
export { createLiquidEffect } from "./liquid";
export { createStaticGradientEffect } from "./staticGradient";

export const SHADER_EFFECT_OPTIONS = [
  { value: "empty", label: "Empty" },
  { value: "static gradient", label: "Static gradient" },
  { value: "liquid", label: "Liquid" },
] satisfies { value: ShaderEffect; label: string }[];

const shaderEffectFactories: Record<ShaderEffect, ShaderEffectFactory> = {
  empty: createEmptyEffect,
  "static gradient": createStaticGradientEffect,
  liquid: createLiquidEffect,
};

export const createShaderEffect = (effect: ShaderEffect, root: Parameters<ShaderEffectFactory>[0]) =>
  shaderEffectFactories[effect](root);
