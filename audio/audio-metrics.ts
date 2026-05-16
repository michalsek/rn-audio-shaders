export const AUDIO_ANALYSER_READ_INTERVAL_MS = 50;

type NumberRef = {
  current: number;
};

export type AudioMetricRefs = {
  audioLevelRef: NumberRef;
  audioPeakRef: NumberRef;
  audioBrightnessRef: NumberRef;
  smoothedLevelRef: NumberRef;
  smoothedPeakRef: NumberRef;
  lastAnalyserReadAtRef: NumberRef;
};

export const extractSampleMetrics = (
  samples: Float32Array,
  sampleCount: number,
) => {
  let sumSquares = 0;
  let peak = 0;
  let signChanges = 0;
  let previous = samples[0] ?? 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = samples[i];
    const magnitude = Math.abs(sample);
    sumSquares += sample * sample;
    peak = Math.max(peak, magnitude);

    if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) {
      signChanges += 1;
    }

    previous = sample;
  }

  return {
    rms: Math.sqrt(sumSquares / Math.max(1, sampleCount)),
    peak,
    brightness: signChanges / Math.max(1, sampleCount - 1),
  };
};

export const resetAudioMetrics = ({
  audioLevelRef,
  audioPeakRef,
  audioBrightnessRef,
  smoothedLevelRef,
  smoothedPeakRef,
  lastAnalyserReadAtRef,
}: AudioMetricRefs) => {
  audioLevelRef.current = 0;
  audioPeakRef.current = 0;
  audioBrightnessRef.current = 0;
  smoothedLevelRef.current = 0;
  smoothedPeakRef.current = 0;
  lastAnalyserReadAtRef.current = 0;
};

export const updateAudioMetrics = (
  { audioLevelRef, audioPeakRef, audioBrightnessRef }: AudioMetricRefs,
  samples: Float32Array,
  sampleCount: number,
  levelScale: number,
) => {
  const { rms, peak, brightness } = extractSampleMetrics(samples, sampleCount);
  const scaledLevel = Math.min(1, rms * levelScale);
  const scaledPeak = Math.min(1, peak * levelScale * 0.65);

  audioLevelRef.current = scaledLevel;
  audioPeakRef.current = Math.max(audioPeakRef.current * 0.72, scaledPeak);
  audioBrightnessRef.current = Math.min(1, brightness * 18);
};

export const decayAudioMetrics = ({
  audioLevelRef,
  audioPeakRef,
  audioBrightnessRef,
  smoothedLevelRef,
  smoothedPeakRef,
}: AudioMetricRefs) => {
  smoothedLevelRef.current +=
    (audioLevelRef.current - smoothedLevelRef.current) * 0.36;
  smoothedPeakRef.current = Math.max(
    audioPeakRef.current,
    smoothedPeakRef.current * 0.9,
  );
  audioLevelRef.current *= 0.88;
  audioPeakRef.current *= 0.94;
  audioBrightnessRef.current *= 0.94;
};
