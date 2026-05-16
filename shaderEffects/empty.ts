import type { ShaderEffectFactory } from "./types";

export const createEmptyEffect: ShaderEffectFactory = () => ({
  render: () => {},
});
