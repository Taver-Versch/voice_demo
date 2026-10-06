# voice_demo

A small browser demo comparing wake-word engines and speech-to-text models, runnable on a laptop browser and in WebXR on Apple Vision Pro and Meta Quest.

Part of the UNL SoC Yao project. Licensed under Apache 2.0, see LICENSE.

## What it does
- Wake word (TensorFlow.js Speech Commands or openWakeWord) decides when the user is speaking to the app.
- Speech to text (Moonshine or Whisper tiny, via Transformers.js) turns the phrase into text.
- Three modes: Wake + STT, Wake word only, STT only.
- Runs in the browser. No audio or text is sent to a server.

## Run locally
    pip install -r requirements.txt
    python app.py

Open http://localhost:5000.

## Run for headsets
WebXR and microphone access need HTTPS:

    cloudflared tunnel --url http://localhost:5000

Open the printed https://*.trycloudflare.com URL on Vision Pro or Quest, grant mic access, then tap Enter VR.