import type { UseConfigureContextResult } from "@typegpu/react";
import type { TgpuRoot } from "typegpu";

import type { AudioFrameMetrics } from "@/audio/audioMetrics";

export type ShaderEffect =
  | "empty"
  | "static gradient"
  | "liquid"
  | "fabric ball"
  | "mountains"
  | "voice orb";

export type ShaderEffectCanvasContext = NonNullable<
  UseConfigureContextResult["ctxRef"]["current"]
>;

export type ShaderEffectCanvasSize = {
  width: number;
  height: number;
};

export type FabricBallRuntimeControls = {
  radius: number;
  amplitude: number;
  foldCount: number;
  foldWidth: number;
  travelSpeed: number;
  bend: number;
  twist: number;
  contraction: number;
  softness: number;
  glow: number;
};

export type ShaderEffectRuntimeControls = {
  fabricBall?: FabricBallRuntimeControls;
};

export type ShaderEffectRenderer = {
  audioAnalyserReadIntervalMs?: number;
  render: (
    ctx: ShaderEffectCanvasContext,
    audioFrame: AudioFrameMetrics,
    elapsedSeconds: number,
    canvasSize: ShaderEffectCanvasSize,
    runtimeControls?: ShaderEffectRuntimeControls,
  ) => void;
  dispose?: () => void;
};

export type ShaderEffectFactory = (root: TgpuRoot) => ShaderEffectRenderer;
