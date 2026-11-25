# Synthetic speech clips (tests only)

`as-crash.m4a`, `as-road.m4a`, `as-vehicles.m4a`, `as-persons.m4a` are the `spoken.sections` of
`../transcripts.as.json` read aloud by a **synthetic voice**: no real person is recorded. They are
16 kHz mono AAC, the format the app records on Android, with a quiet noise floor (about -60 dBFS)
because a real microphone never produces digital silence.

- Voice: AAII *Xobdo Boroxa 1.0* (FastSpeech2 + Multi-band MelGAN, ONNX),
  `aaiiaxom/assamese-tts-aaii-xobdo-fs2-mb` at revision `9027cb27`, licence **CC-BY-NC-4.0**
  (non-commercial). Used only to make these test fixtures; it is not part of the app or server.
- Rebuild: `npm run make-test-audio` (downloads the voice into `models/tts-as/`, checks SHA-256).
- Used by `tests/speech.test.js` (real speech recognition end to end).
