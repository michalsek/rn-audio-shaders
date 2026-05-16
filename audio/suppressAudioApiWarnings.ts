import { LogBox } from "react-native";

const recordingNotificationWarning =
  "RecordingNotificationManager is not implemented on iOS. Any calls to it will be no-ops.";

LogBox.ignoreLogs([
  recordingNotificationWarning,
]);

const globalWarningState = globalThis as typeof globalThis & {
  __audioApiConsoleWarnPatched?: boolean;
};

if (!globalWarningState.__audioApiConsoleWarnPatched) {
  const originalWarn = console.warn;

  console.warn = (...args: Parameters<typeof console.warn>) => {
    const [message] = args;

    if (
      typeof message === "string" &&
      message.includes(recordingNotificationWarning)
    ) {
      return;
    }

    originalWarn(...args);
  };

  globalWarningState.__audioApiConsoleWarnPatched = true;
}
