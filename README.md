# voice_demo

A small browser demo for comparing wake-word engines and speech-to-text models. It runs in a laptop browser and in WebXR on Apple Vision Pro and Meta Quest.

Part of the UNL SoC Yao project. Licensed under Apache 2.0, see LICENSE.

## What it does
- Wake word (TensorFlow.js Speech Commands or openWakeWord) decides when the user is speaking to the app.
- Speech to text (Moonshine or Whisper tiny, via Transformers.js) turns the phrase into text.
- Three modes: Wake + STT, Wake word only, STT only.
- Everything runs in the browser. The app never sends audio or text to a server.

## Run locally
    pip install -r requirements.txt
    python app.py

Open http://localhost:5000.

> If port 5000 is already in use, Flask will stop with an error. On a Mac this is usually AirPlay Receiver: turn it off in System Settings > General > AirDrop & Handoff, or change the port at the bottom of app.py (and in the cloudflared command below).

## Run for headsets
WebXR and microphone access need HTTPS. Install cloudflared first:

    winget install Cloudflare.cloudflared    (Windows)
    brew install cloudflared                 (Mac)

Then, with the app running:

    cloudflared tunnel --url http://localhost:5000

Open the printed https://*.trycloudflare.com URL on Vision Pro or Quest. Press Start Listening and allow microphone access, then tap Enter VR. Enter VR does nothing on a laptop or desktop.
