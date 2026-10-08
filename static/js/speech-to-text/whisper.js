const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL = "onnx-community/whisper-tiny.en";

let recognizer;

export async function init() {
  if (recognizer) return;
  const { pipeline } = await import(TRANSFORMERS_URL);
  recognizer = await pipeline("automatic-speech-recognition", MODEL);
}

export async function transcribe(audio) {
  const { text } = await recognizer(audio);
    return text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
}