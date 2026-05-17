import type { UseConfigureContextResult } from "@typegpu/react";
import type { TgpuRoot } from "typegpu";

import type { AudioFrameMetrics } from "@/audio/audioMetrics";

export type ShaderEffect =
  | "empty"
  | "static gradient"
  | "liquid"
  | "fabric ball"
  | "voice orb";

export type ShaderEffectCanvasContext = NonNullable<
  UseConfigureContextResult["ctxRef"]["current"]
>;

export type ShaderEffectCanvasSize = {
  width: number;
  height: number;
};

export type ShaderEffectRenderer = {
  audioAnalyserReadIntervalMs?: number;
  render: (
    ctx: ShaderEffectCanvasContext,
    audioFrame: AudioFrameMetrics,
    elapsedSeconds: number,
    canvasSize: ShaderEffectCanvasSize,
  ) => void;
  dispose?: () => void;
};

export type ShaderEffectFactory = (root: TgpuRoot) => ShaderEffectRenderer;
