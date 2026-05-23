/* =================================================================
   STANDARD MIDI FILE WRITER (buildplan Session 15).

   Turns a playback-shaped jingle — the same { title, tempo, key, sections,
   lead, harmony, bass } object the UI already holds for a stored jingle — into
   the bytes of a Format 1 Standard MIDI File (.mid), so a guest's theme can be
   opened in any DAW or notation tool. Pure JS, self-contained, no external
   dependencies and no audio: it never touches synth.js, it only mirrors that
   file's pitch convention (NOTE_MAP + the octave math) so a string the synth
   would sound maps to the MIDI note number a DAW will play.

   FOUR TRACKS, Format 1 (parallel tracks sharing one timeline):
     Track 0 — meta only: tempo, 4/4 time signature (the project is
               meter-locked), the file's track name ("eki-melo: <title>"), and
               each section as a MIDI Marker at its beat position.
     Track 1 — Lead    (channel 0, GM program 80 "Lead 1 (square)")
     Track 2 — Harmony (channel 1, GM program 81 "Lead 2 (sawtooth)")
     Track 3 — Bass    (channel 2, GM program 38 "Synth Bass 1")
   The programs are HINTS for import — the actual chiptune timbre was always
   synth-specific (pulse/triangle waves), so a GM patch can only approximate it;
   DAWs and notation software substitute their own patches anyway. Channel 9 is
   GM percussion, so the three voices deliberately skip it.

   TIMING. Beats convert to ticks at `ticksPerBeat` (default 96 — divisible by
   the common subdivisions: a 16th = 24, an 8th-triplet = 32, a dotted-8th = 72,
   a quarter = 96). Ticks are accumulated as INTEGERS, rounded per note, so the
   delta times never drift across a long piece the way a float beat-cursor would.

   The synth plays notes at 94% of their nominal length for articulation; MIDI
   does NOT — notes here run their full notated duration (legato, back-to-back),
   which is what a score wants. Velocity is uniform (default 90): the synth
   carries no per-note dynamics, so there is nothing truer to export.
   ================================================================= */

// Pitch-class map, mirrored verbatim from synth.js NOTE_MAP (C=0 … B=11, with
// both spellings of each black key). Kept as its own copy rather than imported
// so this writer stays free of any audio dependency.
const NOTE_MAP = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };

const DEFAULT_TICKS_PER_BEAT = 96;
const DEFAULT_VELOCITY = 90;
const DEFAULT_PROGRAMS = { lead: 80, harmony: 81, bass: 38 };

const META_TRACK_NAME = 0x03;
const META_MARKER = 0x06;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;
const META_END_OF_TRACK = [0xFF, 0x2F, 0x00];

/**
 * Pitch string → MIDI note number, mirroring synth.js's noteToFreq regex +
 * NOTE_MAP. `midi = NOTE_MAP[letter] + (octave + 1) * 12`, so "C4" → 60,
 * "A4" → 69, "F#3" → 54. Returns null for "rest" / "r" / empty / null and for
 * anything unparseable (a missing octave, a bad letter) or out of MIDI's 0–127
 * range — the caller treats null as silence and just advances its tick cursor.
 */
export function pitchStringToMidi(noteString) {
  if (noteString === null || noteString === undefined) return null;
  const s = String(noteString).trim();
  if (s === '' || s === 'rest' || s === 'r') return null;
  const m = s.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!m) return null;
  const semitone = NOTE_MAP[m[1]];
  if (semitone === undefined) return null;
  const midi = semitone + (parseInt(m[2], 10) + 1) * 12;
  if (midi < 0 || midi > 127) return null;
  return midi;
}

/**
 * Variable-length quantity encoding — how SMF stores delta times. Each byte
 * carries 7 bits of value; every byte but the last sets the high continuation
 * bit. writeVlq(0) → [0x00], writeVlq(128) → [0x81, 0x00]. Exposed for the
 * verifier. Throws on a non-negative-integer input (a guard, not a code path).
 */
export function writeVlq(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`writeVlq requires a non-negative integer, got ${value}`);
  }
  const bytes = [value & 0x7F];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7F) | 0x80);
    value >>= 7;
  }
  return bytes;
}

// Big-endian width helpers for the chunk lengths and the header fields.
function writeUint16BE(value) {
  return [(value >> 8) & 0xFF, value & 0xFF];
}
function writeUint32BE(value) {
  return [(value >>> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF];
}

// A four-character chunk id ("MThd"/"MTrk") as its ASCII bytes.
function fourCC(id) {
  return [id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3)];
}

// Wrap a chunk's data in its id + big-endian byte-length prefix.
function chunk(id, dataBytes) {
  return [...fourCC(id), ...writeUint32BE(dataBytes.length), ...dataBytes];
}

// UTF-8 bytes of a string, for the text meta-events (track names, markers).
// TextEncoder is a platform global in both the browser and Node — no import.
function textBytes(str) {
  return Array.from(new TextEncoder().encode(String(str ?? '')));
}

// A meta event: 0xFF, type, VLQ length, then the payload. The length is itself
// VLQ-encoded, so a >127-byte title still encodes correctly.
function metaEvent(type, dataBytes) {
  return [0xFF, type, ...writeVlq(dataBytes.length), ...dataBytes];
}

function textMeta(type, str) {
  return metaEvent(type, textBytes(str));
}

// Tempo as microseconds per quarter note (FF 51 03 tt tt tt).
function tempoMeta(bpm) {
  const usPerQuarter = Math.round(60000000 / bpm);
  return metaEvent(META_TEMPO, [(usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF]);
}

// 4/4, the project's locked meter. numerator 4, denominator 2^2 = 4,
// 24 MIDI clocks per metronome click, 8 notated 32nds per quarter note.
function timeSignatureMeta() {
  return metaEvent(META_TIME_SIGNATURE, [4, 2, 24, 8]);
}

// Total integer-tick length of one voice (sum of its rounded note/rest ticks).
function trackTotalTicks(track, ticksPerBeat) {
  if (!Array.isArray(track)) return 0;
  return track.reduce((sum, ev) => {
    const beats = Array.isArray(ev) ? Number(ev[1]) : 0;
    return sum + Math.round((Number.isFinite(beats) ? beats : 0) * ticksPerBeat);
  }, 0);
}

// The piece's overall length in ticks — the longest of the three voices. Track
// 0's end-of-track sits here so the meta track spans the whole timeline.
function pieceTotalTicks(jingle, ticksPerBeat) {
  return Math.max(
    trackTotalTicks(jingle.lead, ticksPerBeat),
    trackTotalTicks(jingle.harmony, ticksPerBeat),
    trackTotalTicks(jingle.bass, ticksPerBeat),
    0,
  );
}

// A section's display label and beat position, tolerating both the pipeline
// shape ({ label, start }) and a bare string. Missing start → beat 0.
function sectionLabelAndStart(section) {
  if (section && typeof section === 'object') {
    const start = Number.isFinite(section.start) ? section.start : 0;
    return { label: section.label ?? '', start };
  }
  return { label: String(section ?? ''), start: 0 };
}

// Track 0: tempo + 4/4 + file name + one Marker per section, then end-of-track
// at the piece's full length. Markers are sorted by tick so the delta times are
// monotonic (a section's `start` is in beats).
function buildMetaTrack(jingle, ticksPerBeat) {
  const events = [];
  const push = (delta, bytes) => events.push(...writeVlq(delta), ...bytes);

  push(0, tempoMeta(jingle.tempo || 140));
  push(0, timeSignatureMeta());
  push(0, textMeta(META_TRACK_NAME, `eki-melo: ${jingle.title ?? 'Untitled'}`));

  const sections = Array.isArray(jingle.sections) ? jingle.sections : [];
  const markers = sections
    .map((section) => {
      const { label, start } = sectionLabelAndStart(section);
      return { label, tick: Math.round(start * ticksPerBeat) };
    })
    .sort((a, b) => a.tick - b.tick);

  let lastTick = 0;
  for (const marker of markers) {
    push(Math.max(0, marker.tick - lastTick), textMeta(META_MARKER, marker.label));
    lastTick = marker.tick;
  }

  const endTick = pieceTotalTicks(jingle, ticksPerBeat);
  push(Math.max(0, endTick - lastTick), META_END_OF_TRACK);
  return chunk('MTrk', events);
}

// One voice track: program-change + track-name at time 0, then Note-On/Note-Off
// for each non-rest event, then end-of-track. The tick CURSOR is where the next
// note begins; LASTEVENT is the absolute tick of the most recent emitted event,
// and every delta is (this event's tick − lastEvent). A rest advances the cursor
// without emitting anything, so the following note's delta carries the rest's
// length (and a trailing rest lands in the end-of-track delta).
function buildVoiceTrack(track, { channel, program, name, ticksPerBeat, velocity }) {
  const events = [];
  const push = (delta, bytes) => events.push(...writeVlq(delta), ...bytes);
  const ch = channel & 0x0F;

  push(0, [0xC0 | ch, program & 0x7F]);
  push(0, textMeta(META_TRACK_NAME, name));

  let cursor = 0;
  let lastEvent = 0;
  const notes = Array.isArray(track) ? track : [];
  for (const ev of notes) {
    if (!Array.isArray(ev) || ev.length < 2) continue;
    const durTicks = Math.round((Number(ev[1]) || 0) * ticksPerBeat);
    const midi = pitchStringToMidi(ev[0]);
    if (midi === null) {
      cursor += durTicks; // rest — advance the cursor, emit nothing
      continue;
    }
    push(cursor - lastEvent, [0x90 | ch, midi, velocity & 0x7F]);
    lastEvent = cursor;
    const offTick = cursor + durTicks;
    push(offTick - lastEvent, [0x80 | ch, midi, 0]);
    lastEvent = offTick;
    cursor = offTick;
  }

  push(Math.max(0, cursor - lastEvent), META_END_OF_TRACK);
  return chunk('MTrk', events);
}

/**
 * Build a Format 1 Standard MIDI File from a playback-shaped jingle and return
 * its bytes as a Uint8Array, ready to download as a .mid. `options`:
 *   - ticksPerBeat (default 96)
 *   - velocity     (default 90, uniform across all voices)
 *   - programs     (default { lead: 80, harmony: 81, bass: 38 } — GM hints)
 */
export function buildMidiFile(jingle, options = {}) {
  if (!jingle || typeof jingle !== 'object') {
    throw new Error('buildMidiFile requires a jingle object');
  }
  const ticksPerBeat = options.ticksPerBeat ?? DEFAULT_TICKS_PER_BEAT;
  const velocity = options.velocity ?? DEFAULT_VELOCITY;
  const programs = { ...DEFAULT_PROGRAMS, ...(options.programs ?? {}) };

  const header = chunk('MThd', [
    ...writeUint16BE(1), // format 1
    ...writeUint16BE(4), // ntrks
    ...writeUint16BE(ticksPerBeat), // division (ticks per quarter note)
  ]);
  const meta = buildMetaTrack(jingle, ticksPerBeat);
  const lead = buildVoiceTrack(jingle.lead, { channel: 0, program: programs.lead, name: 'Lead', ticksPerBeat, velocity });
  const harmony = buildVoiceTrack(jingle.harmony, { channel: 1, program: programs.harmony, name: 'Harmony', ticksPerBeat, velocity });
  const bass = buildVoiceTrack(jingle.bass, { channel: 2, program: programs.bass, name: 'Bass', ticksPerBeat, velocity });

  return Uint8Array.from([...header, ...meta, ...lead, ...harmony, ...bass]);
}
