# Code Guide

## Entry
- `src/main.tsx`: Renders `<App />` into `#root` with React 18 StrictMode.

## App shell (`src/App.tsx`)
- `App`: Manages mode cycling (`piano`, `kalimba`, `chordz`), active keys, recorder toggle, and blink token for the mode display. Spacebar or clicking the display cycles modes. Keyboard listeners map to `KEY_BINDINGS`.
- Layout: main window with title bar, waveform panel, keyboard panel, optional cassette recorder.

## Audio engine (`useAudioEngine`)
- Lazily creates AudioContext, master gain, analyser, convolver reverb, and MediaStreamDestination for recording.
- `playNote`, `playChord`, `stopNote` manage active voices (map of id → voice(s)).
- Voices:
  - Piano: sine + triangle overtone, lowpass sweep, light reverb send, octave down.
  - Kalimba: noise+bandpass+sine pluck, lower octave removed (plays at pitch), mild reverb.
  - Chordz: supersaw pad (detuned saws, lowpass, delay, reverb) an octave down for depth.
- Chord builder: quantizes to major scale, builds triads via `buildChord` helpers using MIDI conversions.

## UI components
- `Waveform`: canvas oscilloscope driven by analyser node.
- `Controls`: mode display (click/space cycles), blinking text on change.
- `Keyboard`/`Key`: renders white/black keys; pointer handlers trigger play/stop and display note tooltips.
- `CassetteRecorder`: handles MediaRecorder capture (30s), playback, clear, and WAV download. Uses `MediaRecorder` with `audio/wav` if supported; stores blob/URL; offers retro transport buttons and status.

## Styles (`src/index.css`)
- Retro Mac-esque window/panel/piano styling; cassette faceplate; mode display; oval recorder toggle; rainbow title shadow.
- Responsive tweaks for smaller screens.

## Recording & download
- Audio routed through master and reverb to analyser and MediaStreamDestination so the recorded file matches what you hear.
- Download button saves the take as WAV when supported (falls back to webm). Filename: `piiaanoo-take.<ext>`.
