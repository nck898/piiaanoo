# Piiaanoo

Retro-styled browser instrument built with React, TypeScript, and Vite. Includes live waveform, playful mode switching, a tape-inspired recorder, and a minimal UI tuned for keyboard input.

## Stack
- Vite + React 18 + TypeScript
- Web Audio API for synthesis, reverb/delay, and recording (MediaRecorder)
- Vanilla CSS for the retro Mac/tape deck look

## Features
- Instruments: Piano (detuned octave down), Kalimba, Chordz pad (supersaw pad locked to key/scale). Mode cycles via spacebar or screen display click.
- Keyboard control: mapped to A/W/S/E/D/F/T/G/Y/H/U/J/K/O/L/P/; for the available range.
- Waveform monitor: live oscilloscope from the audio analyser node.
- Tape recorder: one-take capture (30s), playback, clear/re-arm, WAV download, styled like a cassette deck.
- Responsive layout with a centered piano and toggleable recorder.

## Running
```bash
npm install
npm run dev
```
Open the shown local URL.

## File structure
- `src/App.tsx`: UI, audio engine, recorder, keyboard, modes.
- `src/index.css`: Styling for window, controls, piano, waveform, cassette.
- `src/main.tsx`: App entry.
- `vite.config.ts`, `tsconfig*.json`: Tooling configs.

## Notes
- Chordz uses a fixed supersaw pad preset for deep/floating chords.
- Recorder tries `audio/wav` via MediaRecorder when supported; falls back to webm and still offers download.
- Piano and Kalimba route a light reverb; pad has longer ambience.
