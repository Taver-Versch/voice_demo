// Femi: wake word engine. app.js calls these:
// - init(): load the model (runs on every Start, so cache it).
// - start(onDetected): listen on the mic, call onDetected() on each wake word.
// - stop(): stop listening and release the mic; safe to call twice.