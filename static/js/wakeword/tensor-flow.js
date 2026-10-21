// Femi: wake word engine. app.js calls these:
// - init(): load the model (runs on every Start, so cache it).
// - start(onDetected): listen on the mic, call onDetected() on each wake word.
// - stop(): stop listening and release the mic; safe to call twice.

const WAKE_WORD = "go";
export const WAKE_PHRASE = "Go";
const CONFIDENCE = 0.75;

let ready, recognizer;
let stopping = Promise.resolve();
let wanted = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(script);
  });
}

async function load() {
  await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
  await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.5.4/dist/speech-commands.min.js");
  recognizer = window.speechCommands.create("BROWSER_FFT");
  await recognizer.ensureModelLoaded();
}

export function init() {
  ready ??= load();
  return ready;
}

export async function start(onDetected) {
  wanted = true;
  await stopping;
  if (!wanted) return;
  const wakeIndex = recognizer.wordLabels().indexOf(WAKE_WORD);
  let lastDetection = 0;
  await recognizer.listen(
    async ({ scores }) => {
      if (scores[wakeIndex] < CONFIDENCE || Date.now() - lastDetection < 1000) return;
      lastDetection = Date.now();
      onDetected();
    },
    { invokeCallbackOnNoiseAndUnknown: true, overlapFactor: 0.75 },
  );
}

export function stop() {
  wanted = false;
  if (recognizer?.isListening()) stopping = recognizer.stopListening();
}
