// Dan: speech-to-text engine. app.js calls these:
// - init(): load the model (runs on every Start, so cache it).
// - transcribe(audio): audio is a 16 kHz mono Float32Array of one phrase
//   (app.js records it and cuts on silence); return the text as a string.
