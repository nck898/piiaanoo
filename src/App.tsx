// @ts-expect-error lamejs has no types
import lamejs from 'lamejs';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const NOTE_ORDER = [
  'C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4','A4','A#4','B4',
  'C5','C#5','D5','D#5','E5'
];

const KEY_BINDINGS: Record<string, string> = {
  a: 'C4', w: 'C#4', s: 'D4', e: 'D#4', d: 'E4', f: 'F4', t: 'F#4',
  g: 'G4', y: 'G#4', h: 'A4', u: 'A#4', j: 'B4', k: 'C5', o: 'C#5',
  l: 'D5', p: 'D#5', ';': 'E5'
};

const SCALE_INTERVALS = { major: [0, 2, 4, 5, 7, 9, 11] } as const;

const BASE_TRIADS = {
  major: [ [0,4,7], [0,3,7], [0,3,7], [0,4,7], [0,4,7], [0,3,7], [0,3,6] ],
};

const CHORD_PRESET = { keyRoot: 'C', scaleType: 'major', chordMode: 'triad', inversion: 'root' } as const;

function noteToFrequency(note: string) {
  const match = note.match(/^([A-G])(#?)(\d)$/);
  if (!match) return 0;
  const [, letter, sharp, octave] = match;
  const semitoneMap: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const semitone = semitoneMap[letter] + (sharp ? 1 : 0);
  const pitch = 440 * Math.pow(2, (parseInt(octave, 10) - 4));
  return pitch * Math.pow(2, semitone / 12);
}

function noteNameToMidi(note: string) {
  const match = note.match(/^([A-G])(#?)(\d)$/);
  if (!match) return null;
  const [, letter, sharp, octave] = match;
  const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[letter] + (sharp ? 1 : 0);
  return base + (12 * (parseInt(octave, 10) + 1));
}

function midiToNoteName(midi: number) {
  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const octave = Math.floor(midi / 12) - 1;
  const name = notes[(midi % 12 + 12) % 12];
  return `${name}${octave}`;
}

function quantizeToScale(midi: number, keyRoot: string, scaleType: keyof typeof SCALE_INTERVALS) {
  const rootMidi = noteNameToMidi(`${keyRoot}4`)! % 12;
  const intervals = SCALE_INTERVALS[scaleType];
  const diff = ((midi % 12) - rootMidi + 12) % 12;
  let closest = intervals[0];
  let min = 12;
  intervals.forEach(iv => {
    const d = Math.min((diff - iv + 12) % 12, (iv - diff + 12) % 12);
    if (d < min) { min = d; closest = iv; }
  });
  const baseOct = Math.floor(midi / 12);
  let target = rootMidi + closest + baseOct * 12;
  if (target - midi > 6) target -= 12;
  if (midi - target > 6) target += 12;
  return target;
}

function buildChord(note: string) {
  const midi = noteNameToMidi(note);
  if (midi == null) return [note];
  const rootMidi = noteNameToMidi(`${CHORD_PRESET.keyRoot}4`)!;
  const intervals = SCALE_INTERVALS[CHORD_PRESET.scaleType];
  const degreeDiff = ((midi % 12) - (rootMidi % 12) + 12) % 12;
  const degreeIndex = intervals.reduce((bestIdx, iv, idx) => {
    const d = Math.abs(degreeDiff - iv);
    const best = Math.abs(degreeDiff - intervals[bestIdx]);
    return d < best ? idx : bestIdx;
  }, 0);
  const degree = degreeIndex + 1;
  const baseTriad = BASE_TRIADS.major[(degree - 1) % 7];
  const degreeRootMidi = quantizeToScale(midi, CHORD_PRESET.keyRoot, CHORD_PRESET.scaleType);
  const chordMidis = baseTriad.map(iv => degreeRootMidi + iv);
  return chordMidis.map(midiToNoteName);
}

function createReverbImpulse(ctx: AudioContext, duration = 2.8, decay = 2.8) {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const channel = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

type Mode = 'piano' | 'kalimba' | 'chordz';

type ActiveMap = Map<string, { stop: (t?: number) => void } | { stop: (t?: number) => void }[]>;

function useAudioEngine() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const reverbRef = useRef<ConvolverNode | null>(null);
  const externalRef = useRef<{ audio: HTMLAudioElement; source: MediaElementAudioSourceNode } | null>(null);
  const activeNotes = useRef<ActiveMap>(new Map());
  const captureRef = useRef<{
    active: boolean;
    left: Float32Array[];
    right: Float32Array[];
    processor: ScriptProcessorNode | null;
    tap: GainNode | null;
    sampleRate: number;
  }>({ active: false, left: [], right: [], processor: null, tap: null, sampleRate: 44100 });

  const ensureContext = () => {
    if (ctxRef.current) {
      if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
      return;
    }
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const mediaDest = ctx.createMediaStreamDestination();
    const reverb = ctx.createConvolver();
    reverb.buffer = createReverbImpulse(ctx);

    master.connect(analyser);
    master.connect(ctx.destination);
    master.connect(mediaDest);
    reverb.connect(master);
    reverb.connect(analyser);
    reverb.connect(mediaDest);

    ctxRef.current = ctx;
    analyserRef.current = analyser;
    masterRef.current = master;
    mediaDestRef.current = mediaDest;
    reverbRef.current = reverb;
  };

  const createVoice = (frequency: number, mode: Mode | 'chordz', startTime?: number) => {
    const ctx = ctxRef.current!;
    const now = startTime ?? ctx.currentTime;
    if (mode === 'piano') {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.85, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

      const base = ctx.createOscillator();
      base.type = 'sine';
      base.frequency.value = frequency;

      const overtone = ctx.createOscillator();
      overtone.type = 'triangle';
      overtone.frequency.value = frequency * 2;
      const overtoneGain = ctx.createGain();
      overtoneGain.gain.value = 0.22;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2000, now);
      filter.frequency.exponentialRampToValueAtTime(550, now + 1.6);

      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.12;

      base.connect(filter);
      overtone.connect(overtoneGain).connect(filter);
      filter.connect(gain).connect(masterRef.current!);
      gain.connect(reverbSend).connect(reverbRef.current!);
      base.start(now);
      overtone.start(now);

      return {
        stop: (t?: number) => {
          const stopTime = t ?? ctx.currentTime;
          gain.gain.cancelScheduledValues(stopTime);
          gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), stopTime);
          gain.gain.linearRampToValueAtTime(0.0001, stopTime + 0.06);
          base.stop(stopTime + 0.08);
          overtone.stop(stopTime + 0.08);
        },
      };
    }

    if (mode === 'kalimba') {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.85, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

      const baseFreq = frequency;

      const noise = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;
      noise.loop = false;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.35;

      const tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = baseFreq * 1.1;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = baseFreq * 1.1;
      bp.Q.value = 8;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 2400;
      lowpass.Q.value = 0.5;

      const reverbSend = ctx.createGain();
      reverbSend.gain.value = 0.08;

      noise.connect(noiseGain).connect(bp).connect(lowpass).connect(gain);
      tone.connect(gain);
      gain.connect(masterRef.current!);
      gain.connect(reverbSend).connect(reverbRef.current!);

      noise.start(now);
      tone.start(now);

      return {
        stop: (t?: number) => {
          const stopTime = t ?? ctx.currentTime;
          gain.gain.cancelScheduledValues(stopTime);
          gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), stopTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, stopTime + 0.5);
          noise.stop(stopTime + 0.6);
          tone.stop(stopTime + 0.6);
        },
      };
    }

    // Chordz pad: supersaw + width + delay + reverb
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, now);
    voiceGain.gain.linearRampToValueAtTime(0.85, now + 0.4);
    voiceGain.gain.setTargetAtTime(0.7, now + 0.8, 0.4);

    const cutoff = ctx.createBiquadFilter();
    cutoff.type = 'lowpass';
    cutoff.frequency.setValueAtTime(1400, now);
    cutoff.Q.value = 0.7;

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.22;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.08;
    delay.connect(feedback).connect(delay);

    const delayMix = ctx.createGain();
    delayMix.gain.value = 0.22;
    delay.connect(delayMix);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.45;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.65;

    const makeDetuned = (detune: number, panPos: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.15;
      const panner = ctx.createStereoPanner();
      panner.pan.value = panPos;
      osc.connect(oscGain).connect(panner).connect(cutoff);
      osc.start(now);
      return osc;
    };

    const oscillators = [
      makeDetuned(-12, -0.35),
      makeDetuned(12, 0.35),
      makeDetuned(-7, -0.15),
      makeDetuned(7, 0.15),
      makeDetuned(0, -0.05),
      makeDetuned(0, 0.05),
    ];

    cutoff.connect(voiceGain);
    voiceGain.connect(dryGain).connect(masterRef.current!);
    voiceGain.connect(delay).connect(masterRef.current!);
    voiceGain.connect(delayMix).connect(masterRef.current!);
    voiceGain.connect(reverbSend).connect(reverbRef.current!).connect(masterRef.current!);

    return {
      stop: (t?: number) => {
        const stopTime = t ?? ctx.currentTime;
        voiceGain.gain.cancelScheduledValues(stopTime);
        voiceGain.gain.setValueAtTime(Math.max(voiceGain.gain.value, 0.0001), stopTime);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopTime + 1.0);
        oscillators.forEach(o => o.stop(stopTime + 1.05));
      },
    };
  };

  const playNote = (note: string, mode: Mode | 'chordz', id: string, startTime?: number) => {
    ensureContext();
    const freqFactor = (mode === 'piano' || mode === 'chordz') ? 0.5 : 1;
    const freq = noteToFrequency(note) * freqFactor;
    if (!freq || activeNotes.current.has(id)) return;
    const voice = createVoice(freq, mode, startTime);
    activeNotes.current.set(id, voice);
  };

  const playChord = (notes: string[], mode: Mode | 'chordz', id: string, strumMs = 10) => {
    ensureContext();
    if (activeNotes.current.has(id)) return;
    const voices: { stop: (t?: number) => void }[] = [];
    notes.forEach((note, idx) => {
      const freq = noteToFrequency(note) * (mode === 'chordz' ? 0.5 : 1);
      if (!freq) return;
      const startTime = ctxRef.current!.currentTime + (idx * strumMs / 1000);
      const voice = createVoice(freq, mode, startTime);
      voices.push(voice as { stop: (t?: number) => void });
    });
    if (voices.length) activeNotes.current.set(id, voices);
  };

  const stopNote = (id: string) => {
    const voice = activeNotes.current.get(id);
    if (voice) {
      if (Array.isArray(voice)) {
        voice.forEach(v => v.stop());
      } else {
        voice.stop();
      }
      activeNotes.current.delete(id);
    }
  };

  const getRecordStream = () => {
    ensureContext();
    return mediaDestRef.current ? mediaDestRef.current.stream : null;
  };

  const startCapture = () => {
    ensureContext();
    const ctx = ctxRef.current!;
    const tap = ctx.createGain();
    tap.gain.value = 1;
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    captureRef.current = { active: true, left: [], right: [], processor: proc, tap, sampleRate: ctx.sampleRate };
    proc.onaudioprocess = (e) => {
      if (!captureRef.current.active) return;
      const input = e.inputBuffer;
      captureRef.current.left.push(new Float32Array(input.getChannelData(0)));
      captureRef.current.right.push(new Float32Array(input.getChannelData(1)));
    };
    masterRef.current!.connect(tap);
    tap.connect(proc);
    proc.connect(ctx.destination);
  };

  const stopCapture = () => {
    ensureContext();
    const cap = captureRef.current;
    cap.active = false;
    if (cap.tap) {
      try { masterRef.current?.disconnect(cap.tap); } catch {}
      cap.tap.disconnect();
      cap.tap = null;
    }
    if (cap.processor) {
      cap.processor.disconnect();
      cap.processor = null;
    }
    const left = cap.left;
    const right = cap.right.length ? cap.right : cap.left;
    const sampleRate = cap.sampleRate;
    captureRef.current = { active: false, left: [], right: [], processor: null, tap: null, sampleRate };
    return { left, right, sampleRate };
  };

  const playExternal = (url: string, onEnded?: () => void) => {
    ensureContext();
    const ctx = ctxRef.current!;
    if (externalRef.current) {
      externalRef.current.audio.pause();
      externalRef.current.source.disconnect();
      externalRef.current = null;
    }
    const audioEl = new Audio(url);
    audioEl.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(audioEl);
    src.connect(masterRef.current!);
    audioEl.onended = () => {
      externalRef.current = null;
      onEnded?.();
    };
    audioEl.play();
    externalRef.current = { audio: audioEl, source: src };
  };

  return { analyser: analyserRef, playNote, playChord, stopNote, ensureContext, startCapture, stopCapture, playExternal };
}

function Waveform({ analyser }: { analyser: React.MutableRefObject<AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!analyser.current) return;
      const data = new Uint8Array(analyser.current.frequencyBinCount);
      analyser.current.getByteTimeDomainData(data);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00ff80';
      ctx.beginPath();
      const slice = canvas.width / data.length;
      data.forEach((v, i) => {
        const x = i * slice;
        const y = (v / 255) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return <canvas id="wave" ref={canvasRef} width={1000} height={180} />;
}

function Key({ note, isSharp, isActive, onPress, onRelease, offset }: {
  note: string;
  isSharp: boolean;
  isActive: boolean;
  onPress: () => void;
  onRelease: () => void;
  offset?: string;
}) {
  const className = isSharp ? 'black-key' : 'white-key';
  const style = isSharp ? { left: offset } : undefined;
  return (
    <div
      className={className + (isActive ? ' active' : '')}
      style={style}
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      onPointerUp={onRelease}
      onPointerLeave={(e) => { if (e.pressure !== 0) onRelease(); }}
      aria-label={note}
      title={note}
    />
  );
}

function Keyboard({ activeKeys, onPress, onRelease }: {
  activeKeys: Set<string>;
  onPress: (note: string) => void;
  onRelease: (note: string) => void;
}) {
  const whiteKeys = useMemo(() => NOTE_ORDER.filter(n => !n.includes('#')), []);
  const blackKeys = useMemo(() => {
    const sharps: Record<string, string> = { C: 'C#', D: 'D#', F: 'F#', G: 'G#', A: 'A#' };
    const out: { note: string; left: number }[] = [];
    whiteKeys.forEach((w, idx) => {
      const base = w[0];
      if (!sharps[base]) return;
      const sharpNote = sharps[base] + w.slice(1);
      if (!NOTE_ORDER.includes(sharpNote)) return;
      const whiteWidth = 62; // 60px + 2px margin
      const blackWidth = 40;
      const left = idx * whiteWidth + (whiteWidth - blackWidth / 2);
      out.push({ note: sharpNote, left });
    });
    return out;
  }, [whiteKeys]);

  return (
    <div className="keyboard">
      <div style={{ display: 'flex' }}>
        {whiteKeys.map((note) => (
          <div key={note} style={{ position: 'relative' }}>
            <Key
              note={note}
              isSharp={false}
              isActive={activeKeys.has(note)}
              onPress={() => onPress(note)}
              onRelease={() => onRelease(note)}
            />
          </div>
        ))}
      </div>
      {blackKeys.map(({ note, left }) => (
        <Key
          key={note}
          note={note}
          isSharp
          offset={`${left}px`}
          isActive={activeKeys.has(note)}
          onPress={() => onPress(note)}
          onRelease={() => onRelease(note)}
        />
      ))}
    </div>
  );
}

function Controls({ mode, onCycle, blinkToken }: { mode: Mode; onCycle: () => void; blinkToken: number; }) {
  return (
    <div className="controls">
      <div className="mode-display" onClick={onCycle} title="Click or press Space to change mode">
        <span className="mode-text blink-text" key={blinkToken}>{mode.toUpperCase()}</span>
      </div>
    </div>
  );
}

function CassetteRecorder({
  audio,
  onRecordingStart,
  onRecordingStop,
  onVisualPlayback,
}: {
  audio: ReturnType<typeof useAudioEngine>;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onVisualPlayback?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [status, setStatus] = useState('Ready');
  const [remainingMs, setRemainingMs] = useState(30000);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number>();
  const intervalRef = useRef<number>();
  const tickRef = useRef<number>(0);

  const encodePcmToMp3 = (pcm: { left: Float32Array[]; right: Float32Array[]; sampleRate: number }) => {
    const numChannels = 2;
    const total = pcm.left.reduce((sum, buf) => sum + buf.length, 0);
    const leftFlat = new Int16Array(total);
    const rightFlat = new Int16Array(total);
    let offset = 0;
    pcm.left.forEach((buf, idx) => {
      const rbuf = pcm.right[idx] || buf;
      for (let i = 0; i < buf.length; i++) {
        const l = Math.max(-1, Math.min(1, buf[i]));
        const r = Math.max(-1, Math.min(1, rbuf[i] ?? buf[i]));
        leftFlat[offset + i] = l < 0 ? l * 0x8000 : l * 0x7fff;
        rightFlat[offset + i] = r < 0 ? r * 0x8000 : r * 0x7fff;
      }
      offset += buf.length;
    });
    const mp3enc = new lamejs.Mp3Encoder(numChannels, pcm.sampleRate, 128);
    const blockSize = 1152;
    const mp3Data: Uint8Array[] = [];
    for (let i = 0; i < leftFlat.length; i += blockSize) {
      const leftChunk = leftFlat.subarray(i, i + blockSize);
      const rightChunk = rightFlat.subarray(i, i + blockSize);
      const enc = mp3enc.encodeBuffer(leftChunk, rightChunk);
      if (enc.length) mp3Data.push(new Uint8Array(enc));
    }
    const enc = mp3enc.flush();
    if (enc.length) mp3Data.push(new Uint8Array(enc));
    return new Blob(mp3Data, { type: 'audio/mpeg' });
  };

  const handleStopRecording = async () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (!recording) return;
    setRecording(false);
    onRecordingStop?.();
    setStatus('Encoding to mp3…');
    const pcm = audio.stopCapture();
    const mp3Blob = encodePcmToMp3(pcm);
    const url = URL.createObjectURL(mp3Blob);
    setRecordedBlob(mp3Blob);
    setRecordedUrl(url);
    setStatus('Captured (mp3)');
  };

  const startRecording = () => {
    if (recording || recordedUrl) return;
    if (!audio.startCapture || !audio.stopCapture) {
      setStatus('Recorder unavailable');
      return;
    }
    audio.ensureContext();
    setRecording(true);
    setStatus('Recording… (max 30s)');
    setRemainingMs(30000);
    onRecordingStart?.();
    tickRef.current = Date.now();
    audio.startCapture();
    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const delta = now - tickRef.current;
      tickRef.current = now;
      setRemainingMs(prev => {
        const next = Math.max(0, prev - delta);
        if (next <= 0) {
          void handleStopRecording();
          return 0;
        }
        return next;
      });
    }, 50);
    timerRef.current = window.setTimeout(() => {
      setRemainingMs(0);
      void handleStopRecording();
    }, 30000);
  };

  const playRecording = () => {
    if (!recordedUrl) return;
    setStatus('Playing');
    onVisualPlayback?.();
    audio.playExternal(recordedUrl, () => setStatus('Ready'));
  };

  const clearRecording = () => {
    if (recording) stopRecording();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordedBlob(null);
    setStatus('Ready');
    setRemainingMs(30000);
  };

  const downloadRecording = () => {
    if (!recordedBlob) return;
    let ext = 'webm';
    if (recordedBlob.type.includes('mpeg') || recordedBlob.type.includes('mp3')) ext = 'mp3';
    else if (recordedBlob.type.includes('wav')) ext = 'wav';
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `piiaanoo-take.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stopRecording = () => { void handleStopRecording(); };

  return (
    <div className="panel cassette">
      <div className="cassette-ridges"></div>
      <div className="cassette-body">
        <div className="cassette-top">
          <div className="cassette-meta">
            <button className="cassette-download" onClick={downloadRecording} disabled={!recordedBlob} title="Download WAV">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12"></path>
                <path d="M7 12l5 5 5-5"></path>
                <path d="M5 20h14"></path>
              </svg>
            </button>
            <div className="cassette-label">TAPE CAPTURE</div>
            <div className="cassette-duration">
              {recording ? 'REC' : 'DUR'}{' '}
              {`${String(Math.floor(remainingMs / 1000)).padStart(2, '0')}:${String(Math.floor((remainingMs % 1000) / 10)).padStart(2, '0')}`}
            </div>
          </div>
          <div className="tape-window">
            <div className="spool"></div>
            <div className="window-center">
              <div className="window-arrow">➜</div>
              <div className="window-status">{status}</div>
            </div>
            <div className="spool"></div>
          </div>
        </div>

        <div className="cassette-controls">
          <div className="transport-row">
            <button className="transport-button rec" onClick={startRecording} disabled={recording || !!recordedUrl}>REC</button>
            <button className="transport-button" onClick={playRecording} disabled={!recordedUrl}>PLAY</button>
            <button className="transport-button" onClick={stopRecording} disabled={!recording}>STOP</button>
            <button className="transport-button" onClick={clearRecording} disabled={!recordedUrl && !recording}>REW</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const MODES: Mode[] = ['piano', 'kalimba', 'chordz'];
  const [mode, setMode] = useState<Mode>(() => MODES[Math.floor(Math.random() * MODES.length)]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const audio = useAudioEngine();
  const pressedKeys = useRef<Set<string>>(new Set());
  const [showRecorder, setShowRecorder] = useState(false);
  const [blinkToken, setBlinkToken] = useState(0);
  const recordingActiveRef = useRef(false);
  const recordLogRef = useRef<{ type: 'down' | 'up'; note: string; time: number }[]>([]);
  const recordStartRef = useRef(0);
  const visualTimeoutsRef = useRef<number[]>([]);

  const cycleMode = () => {
    setMode((prev) => {
      const idx = MODES.indexOf(prev);
      return MODES[(idx + 1) % MODES.length];
    });
  };

  useEffect(() => {
    setBlinkToken((n) => n + 1);
  }, [mode]);

  const onRecordingStart = () => {
    recordLogRef.current = [];
    recordStartRef.current = performance.now();
    recordingActiveRef.current = true;
  };

  const onRecordingStop = () => {
    recordingActiveRef.current = false;
  };

  const playVisualLog = () => {
    visualTimeoutsRef.current.forEach(id => window.clearTimeout(id));
    visualTimeoutsRef.current = [];
    setActive(new Set());
    const log = recordLogRef.current;
    log.forEach(evt => {
      const id = window.setTimeout(() => {
        setActive(prev => {
          const next = new Set(prev);
          if (evt.type === 'down') next.add(evt.note);
          else next.delete(evt.note);
          return next;
        });
      }, evt.time);
      visualTimeoutsRef.current.push(id);
    });
  };

  const handlePress = (note: string) => {
    if (active.has(note)) return;
    const id = `${note}`;
    setActive(prev => new Set(prev).add(note));
    if (recordingActiveRef.current) {
      recordLogRef.current.push({ type: 'down', note, time: performance.now() - recordStartRef.current });
    }
    if (mode === 'chordz') {
      const chordNotes = buildChord(note);
      audio.playChord(chordNotes, 'chordz', id, 0);
    } else {
      audio.playNote(note, mode, id);
    }
  };

  const handleRelease = (note: string) => {
    const id = `${note}`;
    setActive(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
    if (recordingActiveRef.current) {
      recordLogRef.current.push({ type: 'up', note, time: performance.now() - recordStartRef.current });
    }
    audio.stopNote(id);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        cycleMode();
        return;
      }
      const note = KEY_BINDINGS[e.key.toLowerCase()];
      if (!note) return;
      if (pressedKeys.current.has(note)) return;
      pressedKeys.current.add(note);
      audio.ensureContext();
      handlePress(note);
    };
    const up = (e: KeyboardEvent) => {
      const note = KEY_BINDINGS[e.key.toLowerCase()];
      if (!note) return;
      pressedKeys.current.delete(note);
      handleRelease(note);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [mode, audio]);

  useEffect(() => {
    const unlock = () => {
      audio.ensureContext();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, [audio]);

  return (
    <>
      <div className="app-shell">
        <div className="window main-window">
          <div className="title-bar">
            <div className="title-dots">
              <div className="dot red"></div>
              <div className="dot yellow"></div>
              <div className="dot green"></div>
            </div>
            <div className="title">Piiaanoo</div>
            <button className="recorder-toggle" onClick={() => setShowRecorder(v => !v)}>
              {showRecorder ? 'Hide Recorder' : 'Show Recorder'}
            </button>
          </div>

          <div className="left-stack">
            <div className="panel wave">
              <div className="wave-header">
                <span>Waveform Monitor</span>
                <div className="wave-leds">
                  <div className={'led ' + (mode === 'piano' ? 'active' : '')}></div>
                  <div className={'led ' + (mode === 'kalimba' ? 'active' : '')}></div>
                  <div className={'led ' + (mode === 'chordz' ? 'active' : '')}></div>
                </div>
              </div>
              <Waveform analyser={audio.analyser} />
              <Controls mode={mode} blinkToken={blinkToken} onCycle={cycleMode} />
            </div>

            <div className="panel keyboard-panel">
              <Keyboard activeKeys={active} onPress={handlePress} onRelease={handleRelease} />
            </div>
          </div>
        </div>
        {showRecorder && (
          <CassetteRecorder
            audio={audio}
            onRecordingStart={onRecordingStart}
            onRecordingStop={onRecordingStop}
            onVisualPlayback={playVisualLog}
          />
        )}
      </div>
      <div className="corner-signature">Made with luv @nck898 github</div>
    </>
  );
}
