/* =================================================================
   PIANO-ROLL RENDERING (with section markers) + PLAYHEAD ANIMATION
   ================================================================= */
import { NOTE_MAP, synth } from './synth.js';
import { escapeHtml } from '../ui.js';

export function renderPianoRoll(jingle) {
  const tempo = jingle.tempo || 140;
  const beat = 60 / tempo;
  const trackLens = ['lead', 'harmony', 'bass']
    .map(t => (jingle[t] || []).reduce((s, ev) => s + (Number(ev[1]) || 0), 0));
  const totalBeats = Math.max(...trackLens, 1);

  const events = [];
  ['lead', 'harmony', 'bass'].forEach(tname => {
    let t = 0;
    (jingle[tname] || []).forEach(ev => {
      if (!Array.isArray(ev)) return;
      const [note, beats] = ev;
      const d = Number(beats) || 0;
      if (note && note !== 'rest') {
        const m = String(note).match(/^([A-G][#b]?)(-?\d+)$/);
        if (m) {
          const midi = NOTE_MAP[m[1]] + (parseInt(m[2]) + 1) * 12;
          events.push({ track: tname, t, d, midi });
        }
      }
      t += d;
    });
  });

  if (events.length === 0) return '<div class="piano-roll"><div class="playhead" data-duration="0"></div></div>';

  const midis = events.map(e => e.midi);
  const minMidi = Math.min(...midis) - 1;
  const maxMidi = Math.max(...midis) + 1;
  const range = Math.max(maxMidi - minMidi, 8);
  const innerH = 88;
  const noteH = Math.max(3, Math.floor(innerH / range));

  let html = '<div class="piano-roll">';

  if (Array.isArray(jingle.sections) && jingle.sections.length > 0) {
    jingle.sections.forEach((sec, i) => {
      const start = Number(sec.start) || 0;
      const left = (start / totalBeats) * 100;
      if (i > 0) html += `<div class="section-marker" style="left:${left}%"></div>`;
      html += `<div class="section-label" style="left:${left}%">${escapeHtml(sec.label || '')}</div>`;
    });
  }

  events.forEach(e => {
    const left  = (e.t / totalBeats) * 100;
    const width = Math.max((e.d / totalBeats) * 100 - 0.3, 0.5);
    const top   = ((maxMidi - e.midi) / range) * innerH + 4;
    html += `<div class="note-block ${e.track}" style="left:${left}%;width:${width}%;top:${top}px;height:${noteH}px"></div>`;
  });

  html += `<div class="piano-roll-legend"><span class="lead-l">LEAD</span><span class="harm-l">HARM</span><span class="bass-l">BASS</span></div>`;
  html += `<div class="playhead" data-duration="${totalBeats * beat}"></div></div>`;
  return html;
}

/* =================================================================
   PLAYHEAD ANIMATION
   ================================================================= */
let playheadAnim = null;
function setPlayingCard(id, isPlaying) {
  document.querySelectorAll('.guest-card.playing').forEach(c => c.classList.remove('playing'));
  document.querySelectorAll('.playhead.active').forEach(p => { p.classList.remove('active'); p.style.left = '0%'; });
  if (playheadAnim) { cancelAnimationFrame(playheadAnim); playheadAnim = null; }
  if (!isPlaying) return;

  const card = document.querySelector(`.guest-card[data-id="${id}"]`);
  if (!card) return;
  card.classList.add('playing');
  const playhead = card.querySelector('.playhead');
  if (!playhead) return;
  const duration = parseFloat(playhead.dataset.duration) * 1000;
  if (!duration || duration <= 0) return;

  playhead.classList.add('active');
  const startedAt = performance.now();
  const tick = (now) => {
    const elapsed = now - startedAt;
    const pct = Math.min(elapsed / duration, 1) * 100;
    playhead.style.left = pct + '%';
    if (elapsed < duration) playheadAnim = requestAnimationFrame(tick);
  };
  playheadAnim = requestAnimationFrame(tick);
}

synth.onStart = (id) => setPlayingCard(id, true);
synth.onEnd   = (id) => setPlayingCard(id, false);
