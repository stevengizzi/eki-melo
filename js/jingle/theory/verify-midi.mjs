/* =================================================================
   VERIFY-MIDI — exit-criterion check for the Standard MIDI File writer
   (buildplan Session 15). Pure-byte, NO live API calls.

   It confirms:
     (a) pitchStringToMidi — the synth-mirroring pitch convention, including
         rests, missing octaves, bad letters, and the 0–127 boundary.
     (b) writeVlq — the variable-length-quantity test vectors, including the
         SMF delta-time maximum.
     (c) buildMidiFile on three fixtures (a v1-shaped piece, the Sunrise
         Fanfare pipeline output, and an empty-harmony dropout edge case):
         structural anchors (the header bytes), the four-track shape, the
         tempo meta-event, and the section-marker count.
     (d) Round-trip — an inline ~50-line SMF reader walks the produced bytes
         and re-reads every Note-On/Note-Off; the parsed note sequence per
         voice must match the input [pitch, duration] tuples after
         pitch→MIDI and duration→tick conversion. This catches encoding bugs
         the structural anchors miss.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-midi.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import { buildMidiFile, pitchStringToMidi, writeVlq } from '../midi-writer.js';
import { runPipeline } from '../pipeline/pipeline-runner.js';
import { CASES } from '../debug/pipeline-inspector-cases.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);

function expect(scope, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(scope, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// --- (a) pitchStringToMidi -------------------------------------------------

expect('pitch:C4', pitchStringToMidi('C4'), 60);
expect('pitch:A4', pitchStringToMidi('A4'), 69);
expect('pitch:C-1', pitchStringToMidi('C-1'), 0);
expect('pitch:G9', pitchStringToMidi('G9'), 127);
expect('pitch:F#3', pitchStringToMidi('F#3'), 54);
expect('pitch:Bb3', pitchStringToMidi('Bb3'), 58);
expect('pitch:Db5', pitchStringToMidi('Db5'), 73);
expect('pitch:rest', pitchStringToMidi('rest'), null);
expect('pitch:r', pitchStringToMidi('r'), null);
expect('pitch:empty', pitchStringToMidi(''), null);
expect('pitch:null', pitchStringToMidi(null), null);
expect('pitch:notapitch', pitchStringToMidi('notapitch'), null);
expect('pitch:no-octave', pitchStringToMidi('C'), null);
expect('pitch:bad-letter', pitchStringToMidi('H4'), null);

// --- (b) writeVlq ----------------------------------------------------------

expect('vlq:0', writeVlq(0), [0x00]);
expect('vlq:127', writeVlq(127), [0x7F]);
expect('vlq:128', writeVlq(128), [0x81, 0x00]);
expect('vlq:0x3FFF', writeVlq(0x3FFF), [0xFF, 0x7F]);
expect('vlq:0x4000', writeVlq(0x4000), [0x81, 0x80, 0x00]);
// The buildplan listed this as "0xFFFFFF → [0xFF,0xFF,0xFF,0x7F] // max for SMF
// delta times". The expected bytes ARE the SMF delta-time maximum, but that
// maximum's value is 0x0FFFFFFF (268435455), not 0xFFFFFF — the leading 0 was
// dropped in the prose. Honoring the documented intent (the bytes + "max for
// SMF delta times") over the typo'd literal.
expect('vlq:0x0FFFFFFF', writeVlq(0x0FFFFFFF), [0xFF, 0xFF, 0xFF, 0x7F]);

// --- inline SMF reader (round-trip, item d) --------------------------------
// Just enough to walk MTrk chunks and recover the note + marker + tempo events.
// Handles MIDI running status defensively even though this writer never uses it.

function readMidi(bytes) {
  let pos = 0;
  const u16 = () => { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; };
  const u32 = () => { const v = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4; return v; };
  const fourCC = () => { const s = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]); pos += 4; return s; };
  const readVlq = () => { let v = 0, b; do { b = bytes[pos++]; v = (v << 7) | (b & 0x7F); } while (b & 0x80); return v; };
  const decode = (arr) => new TextDecoder().decode(Uint8Array.from(arr));

  if (fourCC() !== 'MThd') throw new Error('missing MThd header');
  const headerLen = u32();
  const format = u16();
  const ntrks = u16();
  const division = u16();
  pos += headerLen - 6; // skip any extra header bytes (there are none here)

  const tracks = [];
  for (let t = 0; t < ntrks; t++) {
    const id = fourCC();
    const len = u32();
    const end = pos + len;
    if (id !== 'MTrk') { pos = end; continue; }
    const track = { name: null, markers: [], notes: [], tempoUs: null, programs: [], sawEndOfTrack: false };
    const pending = new Map();
    let absTick = 0;
    let runningStatus = null;
    while (pos < end) {
      absTick += readVlq();
      let status = bytes[pos];
      if (status & 0x80) { pos++; runningStatus = status; } else { status = runningStatus; }
      if (status === 0xFF) {
        const metaType = bytes[pos++];
        const mlen = readVlq();
        const data = bytes.slice(pos, pos + mlen);
        pos += mlen;
        if (metaType === 0x03) track.name = decode(data);
        else if (metaType === 0x06) track.markers.push({ tick: absTick, text: decode(data) });
        else if (metaType === 0x51) track.tempoUs = (data[0] << 16) | (data[1] << 8) | data[2];
        else if (metaType === 0x2F) track.sawEndOfTrack = true;
      } else if ((status & 0xF0) === 0xC0 || (status & 0xF0) === 0xD0) {
        track.programs.push(bytes[pos]); pos += 1; // program change / channel pressure: 1 data byte
      } else if ((status & 0xF0) === 0x90) {
        const note = bytes[pos++]; const vel = bytes[pos++];
        if (vel > 0) pending.set(note, absTick);
        else { const on = pending.get(note); if (on !== undefined) { track.notes.push({ note, onTick: on, offTick: absTick }); pending.delete(note); } }
      } else if ((status & 0xF0) === 0x80) {
        const note = bytes[pos++]; pos++; // note off (+ release velocity)
        const on = pending.get(note); if (on !== undefined) { track.notes.push({ note, onTick: on, offTick: absTick }); pending.delete(note); }
      } else {
        pos += 2; // any other channel voice message: 2 data bytes
      }
    }
    track.notes.sort((a, b) => a.onTick - b.onTick || a.note - b.note);
    tracks.push(track);
    pos = end;
  }
  return { format, ntrks, division, tracks };
}

// The notes a voice SHOULD produce: walk the [pitch, duration] tuples with the
// same integer-tick accumulator the writer uses, skipping rests.
function expectedNotes(track, ticksPerBeat) {
  const out = [];
  let cursor = 0;
  for (const ev of (Array.isArray(track) ? track : [])) {
    if (!Array.isArray(ev)) continue;
    const durTicks = Math.round((Number(ev[1]) || 0) * ticksPerBeat);
    const midi = pitchStringToMidi(ev[0]);
    if (midi !== null) out.push({ note: midi, onTick: cursor, offTick: cursor + durTicks });
    cursor += durTicks;
  }
  return out.sort((a, b) => a.onTick - b.onTick || a.note - b.note);
}

// Assert a slice of the produced bytes equals an expected byte pattern.
function expectBytes(scope, bytes, offset, pattern) {
  const slice = Array.from(bytes.slice(offset, offset + pattern.length));
  if (JSON.stringify(slice) !== JSON.stringify(pattern)) {
    fail(scope, `bytes @${offset} expected ${JSON.stringify(pattern)}, got ${JSON.stringify(slice)}`);
  }
}

// The header anchors common to every file built at the default 96 ticks/beat.
function checkHeaderAnchors(scope, bytes) {
  expectBytes(`${scope}:MThd`, bytes, 0, [0x4D, 0x54, 0x68, 0x64]); // "MThd"
  expectBytes(`${scope}:hdrlen`, bytes, 4, [0x00, 0x00, 0x00, 0x06]); // length 6
  expectBytes(`${scope}:format`, bytes, 8, [0x00, 0x01]); // format 1
  expectBytes(`${scope}:ntrks`, bytes, 10, [0x00, 0x04]); // 4 tracks
  expectBytes(`${scope}:division`, bytes, 12, [0x00, 0x60]); // 96 ticks/beat
  expectBytes(`${scope}:MTrk`, bytes, 14, [0x4D, 0x54, 0x72, 0x6B]); // "MTrk" follows
}

// Round-trip every voice: parsed notes must equal the expected note sequence.
function checkRoundTrip(scope, jingle, parsed, ticksPerBeat) {
  const voices = ['lead', 'harmony', 'bass'];
  voices.forEach((voice, i) => {
    const trackIndex = i + 1; // track 0 is meta
    const got = parsed.tracks[trackIndex].notes;
    const want = expectedNotes(jingle[voice], ticksPerBeat);
    expect(`${scope}:${voice}:count`, got.length, want.length);
    const n = Math.min(got.length, want.length);
    for (let k = 0; k < n; k++) {
      if (got[k].note !== want[k].note || got[k].onTick !== want[k].onTick || got[k].offTick !== want[k].offTick) {
        fail(`${scope}:${voice}`, `note ${k} expected ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`);
      }
    }
  });
}

// --- (c)+(d) FIXTURE 1: a simple v1-shaped piece ---------------------------
// 4-note lead, parallel-third harmony, root/fifth bass, 120 BPM.

const v1Fixture = {
  title: 'Test Theme',
  tempo: 120,
  key: 'C major',
  sections: [{ label: 'A', start: 0 }, { label: 'B', start: 4 }],
  lead: [['C4', 1], ['E4', 1], ['G4', 1], ['C5', 1]],
  harmony: [['A3', 1], ['C4', 1], ['E4', 1], ['G4', 1]],
  bass: [['C2', 2], ['G2', 2]],
};
const v1Bytes = buildMidiFile(v1Fixture);
checkHeaderAnchors('fix1', v1Bytes);
const v1Parsed = readMidi(v1Bytes);
expect('fix1:ntrks', v1Parsed.ntrks, 4);
expect('fix1:division', v1Parsed.division, 96);
expect('fix1:format', v1Parsed.format, 1);
expect('fix1:track0-name', v1Parsed.tracks[0].name, 'eki-melo: Test Theme');
expect('fix1:track0-tempo', v1Parsed.tracks[0].tempoUs, Math.round(60000000 / 120));
expect('fix1:track0-markers', v1Parsed.tracks[0].markers.length, v1Fixture.sections.length);
expect('fix1:track-names', [v1Parsed.tracks[1].name, v1Parsed.tracks[2].name, v1Parsed.tracks[3].name], ['Lead', 'Harmony', 'Bass']);
expect('fix1:lead-c4-midi', v1Parsed.tracks[1].notes[0]?.note, 60);
checkRoundTrip('fix1', v1Fixture, v1Parsed, 96);

// --- (c)+(d) FIXTURE 2: the Sunrise Fanfare pipeline output -----------------

const sunriseInput = CASES.find((c) => c.id === 'c-major-aaba');
if (!sunriseInput) {
  fail('fix2', 'could not find the c-major-aaba (Sunrise Fanfare) inspector case');
} else {
  const sunrise = runPipeline(sunriseInput);
  const sunriseBytes = buildMidiFile(sunrise);
  checkHeaderAnchors('fix2', sunriseBytes);
  const parsed = readMidi(sunriseBytes);
  expect('fix2:ntrks', parsed.ntrks, 4);
  expect('fix2:tempo', parsed.tracks[0].tempoUs, Math.round(60000000 / sunrise.tempo));
  expect('fix2:marker-count', parsed.tracks[0].markers.length, sunrise.sections.length);
  expect('fix2:track-names', [parsed.tracks[1].name, parsed.tracks[2].name, parsed.tracks[3].name], ['Lead', 'Harmony', 'Bass']);
  checkRoundTrip('fix2', sunrise, parsed, 96);
}

// --- (c)+(d) FIXTURE 3: empty-harmony dropout edge case --------------------

const edgeFixture = {
  title: 'Dropout',
  tempo: 140,
  key: 'A minor',
  sections: [{ label: 'A', start: 0 }],
  lead: [['A4', 0.5], ['B4', 0.5], ['C5', 1], ['rest', 1], ['E5', 1]],
  harmony: [], // dropout — no harmony at all
  bass: [['A2', 2], ['E2', 2]],
};
const edgeBytes = buildMidiFile(edgeFixture);
checkHeaderAnchors('fix3', edgeBytes);
const edgeParsed = readMidi(edgeBytes);
expect('fix3:harmony-zero-notes', edgeParsed.tracks[2].notes.length, 0);
// An empty harmony is still a valid MTrk: length-prefixed (the reader walked it
// without overrun) and terminated by the end-of-track meta event.
expect('fix3:harmony-name', edgeParsed.tracks[2].name, 'Harmony');
expect('fix3:harmony-has-end-of-track', edgeParsed.tracks[2].sawEndOfTrack, true);
expect('fix3:harmony-has-program', edgeParsed.tracks[2].programs.length, 1);
expect('fix3:lead-sounds', edgeParsed.tracks[1].notes.length > 0, true);
checkRoundTrip('fix3', edgeFixture, edgeParsed, 96);
// The leading rest in lead is correctly skipped (4 sounding notes, not 5).
expect('fix3:lead-note-count', edgeParsed.tracks[1].notes.length, 4);

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`verify-midi FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('verify-midi PASSED — SMF writer is structurally sound and round-trips across 3 fixtures.');
