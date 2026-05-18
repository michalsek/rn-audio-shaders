import { createEmptyEffect } from "./empty";
import { createFabricBallEffect } from "./fabricBall";
import { createLiquidEffect } from "./liquid";
import { createMountainsEffect } from "./mountains";
import { createStaticGradientEffect } from "./staticGradient";
import { createVoiceOrbEffect } from "./voiceOrb";
import type { ShaderEffect, ShaderEffectFactory } from "./types";

export type {
  ShaderEffect,
  ShaderEffectCanvasContext,
  ShaderEffectFactory,
  ShaderEffectRenderer,
} from "./types";
export { createEmptyEffect } from "./empty";
export { createFabricBallEffect } from "./fabricBall";
export { createLiquidEffect } from "./liquid";
export { createMountainsEffect } from "./mountains";
export { createStaticGradientEffect } from "./staticGradient";
export { createVoiceOrbEffect } from "./voiceOrb";

export const SHADER_EFFECT_OPTIONS = [
  { value: "empty", label: "Empty" },
  { value: "static gradient", label: "Static gradient" },
  { value: "liquid", label: "Liquid" },
  { value: "fabric ball", label: "Fabric ball" },
  { value: "mountains", label: "Mountains" },
  { value: "voice orb", label: "Voice orb" },
] satisfies { value: ShaderEffect; label: string }[];

const shaderEffectFactories: Record<ShaderEffect, ShaderEffectFactory> = {
  empty: createEmptyEffect,
  "static gradient": createStaticGradientEffect,
  liquid: createLiquidEffect,
  "fabric ball": createFabricBallEffect,
  mountains: createMountainsEffect,
  "voice orb": createVoiceOrbEffect,
};

export const createShaderEffect = (effect: ShaderEffect, root: Parameters<ShaderEffectFactory>[0]) =>
  shaderEffectFactories[effect](root);
