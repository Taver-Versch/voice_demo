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
  heard: { label: "Heard you", color: "#1e8449" },
};

const SPEECH_RMS = 0.01;
const SILENCE_MS = 1000;
const NO_SPEECH_MS = 5000;
const MAX_CLIP_MS = 15000;

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

let isListening = false;
let sessionId = 0;
let lastToggleTime = 0;
let wakeEngine, sttEngine;
let vrSupported = false;
const recentLines = [];

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

async function recordPhrase(id) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);

  const volumeMeter = new AudioContext();
  const analyser = volumeMeter.createAnalyser();
  volumeMeter.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const startTime = Date.now();
  let lastSpeechTime = startTime;
  let heardSpeech = false;

  recorder.start();
  await new Promise((resolve) => {
    recorder.onstop = resolve;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const volume = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      const now = Date.now();
      if (volume > SPEECH_RMS) {
        heardSpeech = true;
        lastSpeechTime = now;
      }
      const quietFor = now - lastSpeechTime;
      const tooLong = now - startTime > MAX_CLIP_MS;
      if (quietFor > (heardSpeech ? SILENCE_MS : NO_SPEECH_MS) || tooLong || id !== sessionId) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 100);
  });
  stream.getTracks().forEach((track) => track.stop());
  volumeMeter.close();
  if (!heardSpeech) return null;

  const decoder = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await decoder.decodeAudioData(await new Blob(chunks).arrayBuffer());
    return decoded.getChannelData(0);
  } finally {
    decoder.close();
  }
}

async function recordAndTranscribe(id) {
  const audio = await recordPhrase(id);
  if (!audio || id !== sessionId) return;
  const startTime = performance.now();
  const text = await sttEngine.transcribe(audio);
  if (!text) return;
  addTranscriptLine(text, `${Math.round(performance.now() - startTime)} ms`);
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
    setState("idle");
    return;
  }

  const mode = modeSelect.value;
  wakeEngine = mode === "stt" ? null : wakeEngines[wakeSelect.value];
  sttEngine = mode === "wake" ? null : sttEngines[sttSelect.value];
  setState("loading");
  try {
    await Promise.all([wakeEngine?.init(), sttEngine?.init()]);
  } catch (error) {
    return stopWithError(id, error);
  }
  if (id !== sessionId) return;

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
[modeSelect, wakeSelect, sttSelect].forEach((select) => select.addEventListener("change", restartListening));
enterVrButton.addEventListener("click", () => {
  if (vrSupported) scene.enterVR().catch(() => setStatus("VR not available on this device"));
});
vrExitButton.addEventListener("click", () => scene.exitVR());

setState("idle");
