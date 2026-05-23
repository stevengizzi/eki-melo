/* =================================================================
   CHIPTUNE SYNTHESIS — works on AudioContext OR OfflineAudioContext
   ================================================================= */
export function makePulseWave(ctx, duty) {
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag);
}

export const NOTE_MAP = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };

export function noteToFreq(note) {
  if (!note || note === 'rest' || note === 'r') return 0;
  const m = String(note).match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) return 0;
  const semis = NOTE_MAP[m[1]] + (parseInt(m[2]) - 4) * 12;
  return 440 * Math.pow(2, (semis - 9) / 12);
}

function scheduleNote(ctx, dest, freq, startTime, duration, waveform, volume, periodicWaves) {
  if (freq === 0 || duration <= 0.01) return null;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  if (waveform === 'pulse50') osc.setPeriodicWave(periodicWaves.p50);
  else if (waveform === 'pulse25') osc.setPeriodicWave(periodicWaves.p25);
  else osc.type = waveform;
  osc.frequency.setValueAtTime(freq, startTime);
  const attack = 0.003;
  const decay = 0.04;
  const sustain = volume * 0.72;
  const release = Math.min(0.08, duration * 0.3);
  const sustainEnd = Math.max(startTime + attack + decay, startTime + duration - release);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + attack);
  gain.gain.linearRampToValueAtTime(sustain, startTime + attack + decay);
  gain.gain.setValueAtTime(sustain, sustainEnd);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
  return osc;
}

export function scheduleJingle(ctx, dest, jingle, startTime, periodicWaves) {
  const beat = 60 / (jingle.tempo || 140);
  const oscs = [];
  let totalDur = 0;

  const playTrack = (track, waveform, volume) => {
    if (!Array.isArray(track)) return;
    let t = 0;
    for (const ev of track) {
      if (!Array.isArray(ev) || ev.length < 2) continue;
      const [note, beats] = ev;
      const dur = (Number(beats) || 0) * beat;
      const freq = noteToFreq(note);
      const osc = scheduleNote(ctx, dest, freq, startTime + t, dur * 0.94, waveform, volume, periodicWaves);
      if (osc) oscs.push(osc);
      t += dur;
    }
    if (t > totalDur) totalDur = t;
  };

  playTrack(jingle.lead,    'pulse50',  0.13);
  playTrack(jingle.harmony, 'pulse25',  0.085);
  playTrack(jingle.bass,    'triangle', 0.22);

  return { oscs, totalDur };
}

export class LiveSynth {
  constructor() {
    this.ctx = null;
    this.activeOscs = [];
    this.currentId = null;
    this.onStart = null;
    this.onEnd = null;
    this._endTimer = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.65;
      this.master.connect(this.ctx.destination);
      this.pw = { p50: makePulseWave(this.ctx, 0.50), p25: makePulseWave(this.ctx, 0.25) };
    }
    // 'interrupted' (iOS, after a call/Siri grabbed audio) and 'suspended' both
    // need a kick; only 'running' is good to go.
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  // iOS/Safari unlock. The AudioContext is born 'suspended' and only resumes
  // from inside a user gesture — and on stricter iOS builds it is *starting a
  // source node* within that gesture, not resume() alone, that opens output.
  // main.js wires this to the first tap/keypress so the auto-play that fires
  // from a timer right after COMPOSE has a live context to play into.
  unlock() {
    this.init();
    try {
      const blip = this.ctx.createBufferSource();
      blip.buffer = this.ctx.createBuffer(1, 1, 22050);
      blip.connect(this.ctx.destination);
      blip.start(0);
    } catch (e) { /* unlock is best-effort */ }
  }

  // Resolve only once the clock is actually advancing. Awaiting resume() here is
  // what fixes "I see it play but hear nothing": resume() is async, so reading
  // currentTime before it lands gave a frozen timestamp, and every note (plus
  // its gain envelope) got scheduled into what became the past — leaving each
  // note pinned at its release-end gain of 0. With a live currentTime, notes are
  // scheduled in the real future and sound.
  async ensureRunning() {
    this.init();
    if (this.ctx.state === 'running') return;
    try { await this.ctx.resume(); } catch (e) { /* stays suspended; play no-ops */ }
  }

  stop() {
    this.activeOscs.forEach(n => { try { n.stop(); } catch(e) {} });
    this.activeOscs = [];
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    if (this.currentId && this.onEnd) this.onEnd(this.currentId);
    this.currentId = null;
  }

  async play(jingle, id) {
    await this.ensureRunning();
    this.stop();
    const startTime = this.ctx.currentTime + 0.06;
    const { oscs, totalDur } = scheduleJingle(this.ctx, this.master, jingle, startTime, this.pw);
    this.activeOscs = oscs;
    this.currentId = id;
    if (this.onStart) this.onStart(id, totalDur);
    this._endTimer = setTimeout(() => {
      if (this.onEnd) this.onEnd(id);
      this.currentId = null;
    }, (totalDur + 0.25) * 1000);
  }
}

export const synth = new LiveSynth();

/* =================================================================
   WAV RENDERING via OfflineAudioContext
   ================================================================= */
export async function renderJingleToWav(jingle) {
  const sampleRate = 44100;
  const beat = 60 / (jingle.tempo || 140);
  const trackLens = ['lead', 'harmony', 'bass']
    .map(t => (jingle[t] || []).reduce((s, ev) => s + (Number(ev[1]) || 0), 0));
  const totalBeats = Math.max(...trackLens, 1);
  const durationSec = totalBeats * beat + 0.6;
  const offline = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  const master = offline.createGain();
  master.gain.value = 0.65;
  master.connect(offline.destination);
  const pw = { p50: makePulseWave(offline, 0.50), p25: makePulseWave(offline, 0.25) };
  scheduleJingle(offline, master, jingle, 0.05, pw);
  const buffer = await offline.startRendering();
  return audioBufferToWavBlob(buffer);
}

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const dataLength = samples * numChannels * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
