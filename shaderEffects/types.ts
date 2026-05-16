import type { UseConfigureContextResult } from "@typegpu/react";
import type { TgpuRoot } from "typegpu";

import type { AudioFrameMetrics } from "@/audio/audioMetrics";

export type ShaderEffect = "empty" | "static gradient" | "liquid";

export type ShaderEffectCanvasContext = NonNullable<
  UseConfigureContextResult["ctxRef"]["current"]
>;

export type ShaderEffectRenderer = {
  audioAnalyserReadIntervalMs?: number;
  render: (
    ctx: ShaderEffectCanvasContext,
    audioFrame: AudioFrameMetrics,
    elapsedSeconds: number,
  ) => void;
  dispose?: () => void;
};

export type ShaderEffectFactory = (root: TgpuRoot) => ShaderEffectRenderer;
