import * as wakeTfjs from "./wakeword/tensor-flow.js";
import * as wakeOpenwakeword from "./wakeword/open-wake-word.js";
import * as sttMoonshine from "./speech-to-text/moonshine.js";
import * as sttWhisper from "./speech-to-text/whisper.js";

const wakeEngines = { tfjs: wakeTfjs, openwakeword: wakeOpenwakeword };
const sttEngines = { moonshine: sttMoonshine, "whisper-tiny": sttWhisper };

const STATES = {
  idle: { label: "Idle", color: "#4b5563" },
  loading: { label: "Loading models...", color: "#4b5563" },
  listening: { label: "Listening", color: "#2606dc" },
  heard: { label: "Wake Word Heard...", color: "#1e8449" },
};

const SPEECH_RMS = 0.01;
const SPEECH_OVER_NOISE = 2.5;
const NOISE_RISE = 0.002;
const SILENCE_MS = 400;
const NO_SPEECH_MS = 3000;
const MAX_CLIP_MS = 5000;
const PRE_ROLL_MS = 1000;
const CHUNK_SIZE = 2048;
const LEAD_IN_CHUNKS = 4;
const METER_BARS = 32;

const scene = document.querySelector("a-scene");
const listenButton = document.querySelector("#listen-button");
const enterVrButton = document.querySelector("#enter-vr-button");
const modeSelect = document.querySelector("#mode-select");
const wakeSelect = document.querySelector("#wake-select");
const sttSelect = document.querySelector("#stt-select");
const statusLight = document.querySelector("#status-light");
const statusLabel = document.querySelector("#status-label");
const transcript = document.querySelector("#transcript");
const vrListenButton = document.querySelector("#vr-listen-button");
const vrListenLabel = document.querySelector("#vr-listen-label");
const vrExitButton = document.querySelector("#vr-exit-button");
const vrStatusLight = document.querySelector("#vr-status-light");
const vrStatusLabel = document.querySelector("#vr-status-label");
const vrTranscriptLines = document.querySelectorAll(".vr-transcript-line");
const meter = document.querySelector("#meter");
const vrMeter = document.querySelector("#vr-meter");
const meterBars = [];
const vrMeterBars = [];

for (let i = 0; i < METER_BARS; i++) {
  meterBars.push(meter.appendChild(document.createElement("span")));
  const vrBar = document.createElement("a-plane");
  vrBar.setAttribute("width", (0.55 / METER_BARS) * 0.7);
  vrBar.setAttribute("height", 0.16);
  vrBar.setAttribute("position", `${(i * 0.55) / METER_BARS} 0 0`);
  vrBar.setAttribute("color", "#2606dc");
  vrMeterBars.push(vrMeter.appendChild(vrBar));
}

let isListening = false;
let sessionId = 0;
let lastToggleTime = 0;
let wakeEngine, sttEngine;
let mic = null;
let vrSupported = false;
const recentLines = [];
const engineLoads = new Map();

navigator.xr?.isSessionSupported("immersive-vr").then((supported) => (vrSupported = supported));

function setStatus(label, color) {
  statusLabel.textContent = label;
  vrStatusLabel.setAttribute("value", label);
  if (color) {
    statusLight.style.background = color;
    vrStatusLight.setAttribute("color", color);
  }
}

function setState(name) {
  setStatus(STATES[name].label, STATES[name].color);
}

function loadEngine(engine) {
  if (!engineLoads.has(engine)) {
    const load = Promise.resolve()
      .then(() => engine.init())
      .catch((error) => {
        engineLoads.delete(engine);
        throw error;
      });
    engineLoads.set(engine, load);
  }
  return engineLoads.get(engine);
}

function preloadEngines() {
  loadEngine(wakeEngines[wakeSelect.value]).catch(() => {});
  loadEngine(sttEngines[sttSelect.value]).catch(() => {});
}

function addTranscriptLine(text, badgeText) {
  const line = document.createElement("div");
  const badge = document.createElement("span");
  line.className = "transcript-line";
  badge.className = "transcript-badge";
  badge.textContent = badgeText;
  line.append(text, badge);
  transcript.prepend(line);

  recentLines.unshift(text.length > 90 ? `${text.slice(0, 87)}...` : text);
  recentLines.splice(vrTranscriptLines.length);
  vrTranscriptLines.forEach((vrLine, i) => vrLine.setAttribute("value", recentLines[i] ?? ""));
}

function showLevels(levels) {
  meterBars.forEach((bar, i) => {
    const level = 0.1 + ((levels[i] ?? 0) / 255) * 0.9;
    bar.style.height = `${level * 100}%`;
    vrMeterBars[i].object3D.scale.y = level;
  });
}

function volumeOf(samples) {
  return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
}

function speechLevel(activeMic) {
  return Math.max(SPEECH_RMS, activeMic.noise * SPEECH_OVER_NOISE);
}

async function openMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.minDecibels = -80;
  analyser.maxDecibels = -10;
  const processor = context.createScriptProcessor(CHUNK_SIZE, 1, 1);
  source.connect(analyser);
  source.connect(processor);
  processor.connect(context.destination);

  const levels = new Uint8Array(analyser.frequencyBinCount);
  const preRollChunks = Math.ceil(((PRE_ROLL_MS / 1000) * context.sampleRate) / CHUNK_SIZE);
  const newMic = { stream, context, processor, recent: [], onSamples: null, noise: 1 };
  processor.onaudioprocess = (event) => {
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const volume = volumeOf(samples);
    newMic.noise = Math.min(volume, newMic.noise + (volume - newMic.noise) * NOISE_RISE);
    newMic.recent.push(samples);
    if (newMic.recent.length > preRollChunks) newMic.recent.shift();
    analyser.getByteFrequencyData(levels);
    showLevels(levels);
    newMic.onSamples?.(samples, volume);
  };
  return newMic;
}

function closeMic(oldMic) {
  oldMic.processor.onaudioprocess = null;
  oldMic.onSamples?.(null);
  oldMic.stream.getTracks().forEach((track) => track.stop());
  oldMic.context.close();
  showLevels([]);
}

function recordPhrase(id) {
  const activeMic = mic;
  const chunks = [...activeMic.recent];
  const sampleRate = activeMic.context.sampleRate;
  const startTime = performance.now();
  let lastSpeechTime = startTime;
  let heardSpeech = false;

  return new Promise((resolve) => {
    activeMic.onSamples = (samples, volume) => {
      const now = performance.now();
      if (samples) {
        chunks.push(samples);
        if (volume > speechLevel(activeMic)) {
          heardSpeech = true;
          lastSpeechTime = now;
        }
      }
      const quietFor = now - lastSpeechTime;
      const tooLong = now - startTime > MAX_CLIP_MS;
      if (samples && id === sessionId && !tooLong && quietFor < (heardSpeech ? SILENCE_MS : NO_SPEECH_MS)) return;
      activeMic.onSamples = null;
      activeMic.recent = [];
      if (!samples || !heardSpeech) return resolve(null);
      const firstSpeech = chunks.findIndex((chunk) => volumeOf(chunk) > speechLevel(activeMic));
      resolve({ chunks: chunks.slice(Math.max(0, firstSpeech - LEAD_IN_CHUNKS)), sampleRate, speechEndTime: lastSpeechTime });
    };
  });
}

async function toModelAudio(chunks, sampleRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const resampler = new OfflineAudioContext(1, Math.ceil((length * 16000) / sampleRate), 16000);
  const buffer = resampler.createBuffer(1, length, sampleRate);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.copyToChannel(chunk, 0, offset);
    offset += chunk.length;
  }
  const source = resampler.createBufferSource();
  source.buffer = buffer;
  source.connect(resampler.destination);
  source.start();
  return (await resampler.startRendering()).getChannelData(0);
}

async function recordAndTranscribe(id) {
  const phrase = await recordPhrase(id);
  if (!phrase || id !== sessionId) return;
  const audio = await toModelAudio(phrase.chunks, phrase.sampleRate);
  const text = await sttEngine.transcribe(audio);
  if (!text) return;
  addTranscriptLine(text, `${Math.round(performance.now() - phrase.speechEndTime)} ms`);
}

async function transcribeLoop(id) {
  while (id === sessionId) await recordAndTranscribe(id);
}

async function onWakeWord(id) {
  wakeEngine.stop();
  setState("heard");
  await recordAndTranscribe(id);
  if (id !== sessionId) return;
  setState("listening");
  wakeEngine.start(() => onWakeWord(id).catch((error) => stopWithError(id, error)));
}

function stopWithError(id, error) {
  if (id !== sessionId) return;
  console.error(error);
  setListening(false);
  setStatus(`Error: ${error.message}`);
}

async function setListening(on) {
  const id = ++sessionId;
  isListening = on;
  listenButton.textContent = on ? "Stop Listening" : "Start Listening";
  listenButton.classList.toggle("listening", on);
  vrListenLabel.setAttribute("value", on ? "Stop Listening" : "Start Listening");
  vrListenButton.setAttribute("color", on ? "#646464" : "#1e8449");

  if (!on) {
    wakeEngine?.stop();
    if (mic) closeMic(mic);
    mic = null;
    setState("idle");
    return;
  }

  const mode = modeSelect.value;
  wakeEngine = mode === "stt" ? null : wakeEngines[wakeSelect.value];
  sttEngine = mode === "wake" ? null : sttEngines[sttSelect.value];
  setState("loading");
  let newMic;
  try {
    await Promise.all([wakeEngine && loadEngine(wakeEngine), sttEngine && loadEngine(sttEngine)]);
    newMic = await openMic();
  } catch (error) {
    return stopWithError(id, error);
  }
  if (id !== sessionId) return closeMic(newMic);
  mic = newMic;

  setState("listening");
  if (mode === "stt") transcribeLoop(id).catch((error) => stopWithError(id, error));
  else if (mode === "wake") wakeEngine.start(() => addTranscriptLine("Wake word detected", "wake"));
  else wakeEngine.start(() => onWakeWord(id).catch((error) => stopWithError(id, error)));
}

function toggleListening() {
  if (Date.now() - lastToggleTime < 300) return;
  lastToggleTime = Date.now();
  setListening(!isListening);
}

function restartListening() {
  if (!isListening) return;
  setListening(false);
  setListening(true);
}

listenButton.addEventListener("click", toggleListening);
vrListenButton.addEventListener("click", toggleListening);
[modeSelect, wakeSelect, sttSelect].forEach((select) =>
  select.addEventListener("change", () => {
    preloadEngines();
    restartListening();
  }),
);
enterVrButton.addEventListener("click", () => {
  if (vrSupported) scene.enterVR().catch(() => setStatus("VR not available on this device"));
});
vrExitButton.addEventListener("click", () => scene.exitVR());

setState("idle");
preloadEngines();
