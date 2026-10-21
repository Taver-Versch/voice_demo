// Femi: wake word engine. app.js calls these:
// - init(): load the model (runs on every Start, so cache it).
// - start(onDetected): listen on the mic, call onDetected() on each wake word.
// - stop(): stop listening and release the mic; safe to call twice.

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MODEL_URL = "https://huggingface.co/harvestsu/openwakeword-onnx/resolve/main/";
const WAKE_MODEL_URL = "/static/models/hey_husker.onnx";
export const WAKE_PHRASE = "Hey Husker";
const THRESHOLD = 0.5;
const CHUNK = 1280;
const MEL_CONTEXT = 480;
const MEL_FRAMES = 76;
const EMBEDDINGS = 16;

let ready, melModel, embeddingModel, wakeModel;
let listener = null;

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
  await loadScript(`${ORT_URL}ort.min.js`);
  window.ort.env.wasm.wasmPaths = ORT_URL;
  [melModel, embeddingModel, wakeModel] = await Promise.all(
    [`${MODEL_URL}melspectrogram.onnx`, `${MODEL_URL}embedding_model.onnx`, WAKE_MODEL_URL].map((url) =>
      window.ort.InferenceSession.create(url),
    ),
  );
}

async function run(model, data, dims) {
  const output = await model.run({ [model.inputNames[0]]: new window.ort.Tensor("float32", data, dims) });
  return output[model.outputNames[0]].data;
}

export function init() {
  ready ??= load();
  return ready;
}

export async function start(onDetected) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: 16000 });
  const processor = context.createScriptProcessor(1024, 1, 1);
  context.createMediaStreamSource(stream).connect(processor);
  processor.connect(context.destination);

  const self = { stream, context, processor };
  listener = self;
  let pending = new Float32Array(MEL_CONTEXT);
  let melFrames = [];
  let embeddings = [];
  let lastDetection = 0;
  let queue = Promise.resolve();

  async function score(audio) {
    const mel = await run(melModel, audio, [1, audio.length]);
    for (let i = 0; i < mel.length; i += 32) melFrames.push(mel.slice(i, i + 32).map((x) => x / 10 + 2));
    melFrames = melFrames.slice(-MEL_FRAMES);
    if (melFrames.length < MEL_FRAMES) return;

    const embedding = await run(embeddingModel, Float32Array.from(melFrames.flatMap((f) => [...f])), [1, MEL_FRAMES, 32, 1]);
    embeddings = [...embeddings, embedding].slice(-EMBEDDINGS);
    if (embeddings.length < EMBEDDINGS) return;

    const [wakeScore] = await run(wakeModel, Float32Array.from(embeddings.flatMap((e) => [...e])), [1, EMBEDDINGS, 96]);
    if (wakeScore < THRESHOLD || Date.now() - lastDetection < 1000 || listener !== self) return;
    lastDetection = Date.now();
    onDetected();
  }

  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0).map((x) => x * 32767);
    pending = Float32Array.from([...pending, ...samples]);
    while (pending.length >= MEL_CONTEXT + CHUNK) {
      const audio = pending.slice(0, MEL_CONTEXT + CHUNK);
      pending = pending.slice(CHUNK);
      queue = queue.then(() => score(audio));
    }
  };
}

export function stop() {
  if (!listener) return;
  listener.processor.onaudioprocess = null;
  listener.stream.getTracks().forEach((track) => track.stop());
  listener.context.close();
  listener = null;
}
