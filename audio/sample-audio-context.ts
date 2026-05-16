import { AudioContext } from "react-native-audio-api";

let sampleAudioContext: AudioContext | null = null;

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
