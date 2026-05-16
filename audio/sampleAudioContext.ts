import "@/audio/suppressAudioApiWarnings";
import type { AudioContext as AudioContextType } from "react-native-audio-api";

const { AudioContext } =
  require("react-native-audio-api") as typeof import("react-native-audio-api");

let sampleAudioContext: AudioContextType | null = null;

export const getSampleAudioContext = () => {
  if (!sampleAudioContext) {
    sampleAudioContext = new AudioContext();
  }

  return sampleAudioContext;
};

export const getCurrentSampleAudioContext = () => sampleAudioContext;

export const closeSampleAudioContext = () => {
  sampleAudioContext?.close();
  sampleAudioContext = null;
};
