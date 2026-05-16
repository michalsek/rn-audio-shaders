import {
  DEFAULT_AUDIO_ANALYSER_READ_INTERVAL_MS,
  type AudioMetricRefs,
  decayAudioMetrics,
  getAudioFrameMetrics,
  resetAudioMetrics,
  updateAudioMetrics,
} from "@/audio/audioMetrics";
import "@/audio/suppressAudioApiWarnings";
import {
  closeSampleAudioContext,
  getCurrentSampleAudioContext,
  getSampleAudioContext,
} from "@/audio/sampleAudioContext";
import type { AudioSource, MicStatus } from "@/audio/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalyserNode,
  AudioBuffer,
  AudioBufferSourceNode,
} from "react-native-audio-api";

const { AudioManager, AudioRecorder } =
  require("react-native-audio-api") as typeof import("react-native-audio-api");

const recorder = new AudioRecorder();
const voiceSampleAsset = require("../assets/audio/voice-sample-landing.mp3");

export const useAudioSession = () => {
  const audioLevelRef = useRef(0);
  const audioPeakRef = useRef(0);
  const audioBrightnessRef = useRef(0);
  const smoothedLevelRef = useRef(0);
  const smoothedPeakRef = useRef(0);
  const lastAnalyserReadAtRef = useRef(0);
  const audioReadIdRef = useRef(0);
  const sampleBufferRef = useRef<AudioBuffer | null>(null);
  const sampleSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sampleAnalyserRef = useRef<AnalyserNode | null>(null);
  const sampleDataRef = useRef<Float32Array | null>(null);
  const [audioSource, setAudioSource] = useState<AudioSource>("microphone");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micMessage, setMicMessage] = useState("");

  const audioMetricRefs = useMemo<AudioMetricRefs>(
    () => ({
      audioLevelRef,
      audioPeakRef,
      audioBrightnessRef,
      smoothedLevelRef,
      smoothedPeakRef,
      lastAnalyserReadAtRef,
      audioReadIdRef,
    }),
    [],
  );

  const resetIncomingAudioState = useCallback(() => {
    resetAudioMetrics(audioMetricRefs);
  }, [audioMetricRefs]);

  const updateIncomingAudioMetrics = useCallback(
    (samples: Float32Array, sampleCount: number, levelScale: number) => {
      updateAudioMetrics(audioMetricRefs, samples, sampleCount, levelScale);
    },
    [audioMetricRefs],
  );

  const stopVoiceSample = useCallback(async () => {
    const context = getCurrentSampleAudioContext();

    if (sampleSourceRef.current) {
      try {
        sampleSourceRef.current.stop();
      } catch {
        // Buffer source nodes can already be stopped by native teardown.
      }

      sampleSourceRef.current.disconnect();
      sampleSourceRef.current = null;
    }

    if (context && sampleAnalyserRef.current) {
      try {
        sampleAnalyserRef.current.disconnect(context.destination);
      } catch {
        // The analyser may not be connected if startup failed partway through.
      }
    }

    sampleAnalyserRef.current = null;
    sampleDataRef.current = null;

    if (context && context.state !== "closed") {
      await context.suspend();
    }

    resetIncomingAudioState();
    await AudioManager.setAudioSessionActivity(false);
    setMicStatus("idle");
    setMicMessage("");
  }, [resetIncomingAudioState]);

  const stopMic = useCallback(async () => {
    recorder.clearOnAudioReady();
    recorder.clearOnError();

    if (recorder.isRecording()) {
      recorder.stop();
    }

    resetIncomingAudioState();
    await AudioManager.setAudioSessionActivity(false);
    setMicStatus("idle");
    setMicMessage("");
  }, [resetIncomingAudioState]);

  const startMic = useCallback(async () => {
    await stopVoiceSample();
    setMicStatus("starting");
    setMicMessage("");

    try {
      AudioManager.setAudioSessionOptions({
        iosCategory: "record",
        iosMode: "measurement",
        iosOptions: [],
      });

      const permission = await AudioManager.requestRecordingPermissions();
      if (permission !== "Granted") {
        setMicStatus("denied");
        setMicMessage("Microphone denied");
        return;
      }

      await AudioManager.setAudioSessionActivity(true);

      const callbackResult = recorder.onAudioReady(
        {
          sampleRate: 44100,
          bufferLength: 2048,
          channelCount: 1,
        },
        ({ buffer, numFrames }) => {
          const samples = buffer.getChannelData(0);
          const sampleCount = Math.min(numFrames, samples.length);
          updateIncomingAudioMetrics(samples, sampleCount, 7.5);
        },
      );

      if (callbackResult.status === "error") {
        throw new Error(callbackResult.message);
      }

      recorder.onError(({ message }) => {
        setMicStatus("error");
        setMicMessage(message);
      });

      const startResult = recorder.start();
      if (startResult.status === "error") {
        throw new Error(startResult.message);
      }

      setMicStatus("listening");
    } catch (error) {
      recorder.clearOnAudioReady();
      await AudioManager.setAudioSessionActivity(false);
      setMicStatus("error");
      setMicMessage(
        error instanceof Error ? error.message : "Microphone error",
      );
    }
  }, [stopVoiceSample, updateIncomingAudioMetrics]);

  const startVoiceSample = useCallback(async () => {
    await stopMic();
    setMicStatus("starting");
    setMicMessage("");

    try {
      AudioManager.setAudioSessionOptions({
        iosCategory: "playback",
        iosMode: "default",
        iosOptions: [],
      });

      const context = getSampleAudioContext();
      const buffer =
        sampleBufferRef.current ??
        (await context.decodeAudioData(voiceSampleAsset));
      const analyser = context.createAnalyser();

      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.45;
      sampleBufferRef.current = buffer;
      sampleAnalyserRef.current = analyser;
      sampleDataRef.current = new Float32Array(analyser.fftSize);

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(analyser);
      analyser.connect(context.destination);
      source.start(context.currentTime);
      sampleSourceRef.current = source;

      await AudioManager.setAudioSessionActivity(true);
      await context.resume();
      lastAnalyserReadAtRef.current = 0;
      setMicStatus("listening");
    } catch (error) {
      await stopVoiceSample();
      setMicStatus("error");
      setMicMessage(error instanceof Error ? error.message : "Sample error");
    }
  }, [stopMic, stopVoiceSample]);

  const stopActiveSource = useCallback(async () => {
    if (audioSource === "microphone") {
      await stopMic();
      return;
    }

    await stopVoiceSample();
  }, [audioSource, stopMic, stopVoiceSample]);

  const startActiveSource = useCallback(async () => {
    if (audioSource === "microphone") {
      await startMic();
      return;
    }

    await startVoiceSample();
  }, [audioSource, startMic, startVoiceSample]);

  const selectSource = useCallback(
    async (nextSource: AudioSource) => {
      if (nextSource === audioSource || micStatus === "starting") {
        return;
      }

      await stopActiveSource();
      setAudioSource(nextSource);
    },
    [audioSource, micStatus, stopActiveSource],
  );

  const readAudioFrame = useCallback(
    (analyserReadIntervalMs = DEFAULT_AUDIO_ANALYSER_READ_INTERVAL_MS) => {
      const now = Date.now();
      const sampleAnalyser = sampleAnalyserRef.current;
      const sampleData = sampleDataRef.current;

      if (
        audioSource === "voiceSample" &&
        micStatus === "listening" &&
        sampleAnalyser &&
        sampleData &&
        now - lastAnalyserReadAtRef.current >= analyserReadIntervalMs
      ) {
        lastAnalyserReadAtRef.current = now;
        sampleAnalyser.getFloatTimeDomainData(sampleData);
        updateIncomingAudioMetrics(sampleData, sampleData.length, 5.6);
      }

      decayAudioMetrics(audioMetricRefs);
      return getAudioFrameMetrics(audioMetricRefs);
    },
    [audioMetricRefs, audioSource, micStatus, updateIncomingAudioMetrics],
  );

  useEffect(() => {
    return () => {
      recorder.clearOnAudioReady();
      recorder.clearOnError();

      if (recorder.isRecording()) {
        recorder.stop();
      }

      if (sampleSourceRef.current) {
        try {
          sampleSourceRef.current.stop();
        } catch {}

        sampleSourceRef.current.disconnect();
        sampleSourceRef.current = null;
      }

      AudioManager.setAudioSessionActivity(false);
      closeSampleAudioContext();
    };
  }, []);

  return {
    audioSource,
    micStatus,
    micMessage,
    isListening: micStatus === "listening",
    selectSource,
    startActiveSource,
    stopActiveSource,
    readAudioFrame,
  };
};

export type { AudioSource, MicStatus };
