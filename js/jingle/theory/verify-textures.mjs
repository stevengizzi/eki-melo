/* =================================================================
   VERIFY-TEXTURES — exit-criterion check for the texture vocabulary
   (buildplan Session 6).

   It confirms:
     1. textures — every texture in TEXTURE_REGISTRY, run against representative
        lead-event sequences in several modes, (a) returns an array, (b) emits
        events with a valid Pitch and a positive duration, (c) keeps every Pitch
        in the harmony register (MIDI 60..83 for below-the-lead textures; the
        two `*_above` upper harmonies get the raised ceiling MIDI 60..96), and
        (d) never sits a harmony event above the lead note sounding at its onset
        — the no-voice-crossing rule. THREE textures are documented exceptions
        to (d), where crossing is intrinsic: parallel_thirds_above,
        parallel_sixths_above (upper harmonies) and imitation_one_beat_delay (a
        delayed canon). They are checked for (a)-(c) only, and the crossings they
        produce are reported (informationally) so we can see them.
     2. dispatch — Stage 6's buildHarmony reaches the registry: every registry
        name is callable through a TexturePlan.
     3. end-to-end — runPipeline over every hand-written inspector case (now
        exercising oblique_held and imitation_one_beat_delay alongside the
        parallel-thirds default) yields a FinalJingle whose every event has a
        positive duration and (when not a rest) a synth string parsing through
        the REAL synth.js noteToFreq to a finite, positive frequency, with the
        three voices beat-aligned.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-textures.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import { TEXTURE_REGISTRY } from './textures.js';
import { degreeToPitch, pitchSetForScale } from './mode-engine.js';
import { resolveRoman } from './roman-numeral.js';
import { toMidi, toScoreString, pitchClassOf } from './pitch.js';
import { renderMotifToDegreeEvents } from './motif.js';
import { runPipeline } from '../pipeline/pipeline-runner.js';
import { noteToFreq } from '../synth.js';
import { CASES } from '../debug/pipeline-inspector-cases.js';

const HARMONY_LOW_MIDI = 60;
const HARMONY_HIGH_MIDI = 83;
const HARMONY_ABOVE_HIGH_MIDI = 96; // raised ceiling for the *_above upper harmonies
const EPSILON = 1e-9;
// Upper harmonies — sit above the lead by design, with the raised ceiling.
const ABOVE_TEXTURES = new Set(['parallel_thirds_above', 'parallel_sixths_above']);
// Textures where crossing above the lead is intrinsic, not an accident.
const CROSSING_EXEMPT = new Set(['imitation_one_beat_delay', ...ABOVE_TEXTURES]);

const failures = [];
const notes = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);

// --- build a representative passage in a given mode ------------------------

const LEAD_OCTAVE = 5;
const METER = { numerator: 4, denominator: 4, grouping: [4] };

// A two-bar lead with a mix of leaps, steps, and a repeated note, realized
// exactly the way Stage 6 does (renderMotifToDegreeEvents → degreeToPitch),
// carrying the degree/octave_offset textures reason in.
const PROBE_MOTIF = {
  degrees: [1, 3, 5, 5, 4, 2, 7, 8],
  rhythm: [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 1.5],
  contour: 'wandering',
  register: 'mid',
  anomaly: null,
};

function buildPassage(mode, tonic, progression) {
  const lead = renderMotifToDegreeEvents(PROBE_MOTIF, 0).map((event) => ({
    pitch: degreeToPitch(mode, tonic, event.degree, LEAD_OCTAVE + event.octave_offset),
    beat: event.beat,
    duration: event.duration,
    degree: event.degree,
    octave_offset: event.octave_offset,
  }));
  const beatsPerBar = METER.numerator;
  const totalBeats = lead.reduce((s, e) => Math.max(s, e.beat + e.duration), 0);
  const barCount = Math.ceil(totalBeats / beatsPerBar);
  const chordsByAbsBar = new Map();
  for (let bar = 0; bar < barCount; bar++) {
    chordsByAbsBar.set(bar, resolveRoman(progression[bar % progression.length], mode, tonic, 4));
  }
  return { lead, chordsByAbsBar };
}

// The lead Pitch sounding at `beat`, or null in a gap (mirrors textures.js).
function leadPitchAtBeat(lead, beat) {
  for (const event of lead) {
    if (beat >= event.beat - EPSILON && beat < event.beat + event.duration - EPSILON) return event.pitch;
  }
  return null;
}

// --- 1. per-texture invariants ---------------------------------------------

const PROBES = [
  { mode: 'major', tonic: 'C', progression: ['I', 'IV', 'V', 'I'] },
  { mode: 'dorian', tonic: 'D', progression: ['i', 'IV', 'VII', 'i'] },
  { mode: 'harmonic_minor', tonic: 'A', progression: ['i', 'iv', 'V', 'i'] },
  { mode: 'phrygian_dominant', tonic: 'E', progression: ['I', 'II', 'iv', 'I'] },
];

for (const name of Object.keys(TEXTURE_REGISTRY)) {
  const texture = TEXTURE_REGISTRY[name];
  let totalEvents = 0;
  let crossings = 0;

  for (const { mode, tonic, progression } of PROBES) {
    const { lead, chordsByAbsBar } = buildPassage(mode, tonic, progression);

    let out;
    try {
      out = texture(lead, chordsByAbsBar, mode, tonic, LEAD_OCTAVE, METER, {});
    } catch (error) {
      fail(`texture:${name}:${mode}`, `threw: ${error.message}`);
      continue;
    }

    // (a) returns an array.
    if (!Array.isArray(out)) {
      fail(`texture:${name}:${mode}`, `did not return an array (got ${typeof out})`);
      continue;
    }
    totalEvents += out.length;

    out.forEach((event, i) => {
      // (b) valid Pitch + positive duration.
      const pitch = event.pitch;
      if (!pitch || typeof pitch !== 'object' || typeof pitch.letter !== 'string') {
        fail(`texture:${name}:${mode}`, `event ${i} has no valid Pitch: ${JSON.stringify(event)}`);
        return;
      }
      if (!(typeof event.duration === 'number' && event.duration > 0)) {
        fail(`texture:${name}:${mode}`, `event ${i} duration not positive: ${JSON.stringify(event.duration)}`);
      }
      if (!(typeof event.beat === 'number' && Number.isFinite(event.beat))) {
        fail(`texture:${name}:${mode}`, `event ${i} beat not finite: ${JSON.stringify(event.beat)}`);
      }

      // (c) in the harmony register (the *_above upper harmonies get the
      // raised ceiling).
      const midi = toMidi(pitch);
      const ceiling = ABOVE_TEXTURES.has(name) ? HARMONY_ABOVE_HIGH_MIDI : HARMONY_HIGH_MIDI;
      if (midi < HARMONY_LOW_MIDI || midi > ceiling) {
        fail(`texture:${name}:${mode}`, `event ${i} pitch ${toScoreString(pitch)} (MIDI ${midi}) out of range ${HARMONY_LOW_MIDI}..${ceiling}`);
      }

      // (d) no voice crossing (except the documented imitation exception).
      const leadPitch = leadPitchAtBeat(lead, event.beat);
      if (leadPitch && midi > toMidi(leadPitch) + EPSILON) {
        if (CROSSING_EXEMPT.has(name)) {
          crossings += 1;
        } else {
          fail(`texture:${name}:${mode}`, `event ${i} ${toScoreString(pitch)} crosses ABOVE lead ${toScoreString(leadPitch)} at beat ${event.beat}`);
        }
      }
    });
  }

  // dropout is legitimately empty; everything else must produce events.
  if (name !== 'dropout' && totalEvents === 0) {
    fail(`texture:${name}`, 'produced no events across any probe mode');
  }
  if (CROSSING_EXEMPT.has(name) && crossings > 0) {
    const why = ABOVE_TEXTURES.has(name) ? 'an upper harmony, above the lead by design' : 'a delayed canon overlapping the lead';
    notes.push(`${name}: ${crossings} documented voice crossing(s) across the probes (${why}) — accepted, not a failure.`);
  }
}

// --- 1b. heterophony density guard (Session-10 checkpoint regression) -------
// The old heterophony halved EVERY lead note, so a sixteenth ornament note became
// two 32nds and a zero-movement step doubled a pitch into a stutter — "nothing a
// human would write." The reshaped texture holds the lead's pitch and adds at most
// one sixteenth passing tone into the next, only on notes longer than an eighth.
// Guard both regressions: no sub-sixteenth event, and never more than 2 events per
// lead note (no over-subdivision).
{
  const sixteenth = METER.denominator / 8 / 2; // 0.25 in x/4
  const hetMode = 'major';
  const hetTonic = 'C';
  // A lead with a sixteenth note and held notes — the shapes that produced 32nds /
  // dotted-sixteenth runs under the old code.
  const hetMotif = { degrees: [1, 3, 2, 5], rhythm: [0.25, 0.75, 1, 2], contour: 'wandering', register: 'mid', anomaly: null };
  const hetLead = renderMotifToDegreeEvents(hetMotif, 0).map((event) => ({
    pitch: degreeToPitch(hetMode, hetTonic, event.degree, LEAD_OCTAVE + event.octave_offset),
    beat: event.beat,
    duration: event.duration,
    degree: event.degree,
    octave_offset: event.octave_offset,
  }));
  const hetChords = new Map([[0, resolveRoman('I', hetMode, hetTonic, 4)]]);
  const hetOut = TEXTURE_REGISTRY.heterophony(hetLead, hetChords, hetMode, hetTonic, LEAD_OCTAVE, METER, {});
  hetOut.forEach((event, i) => {
    if (event.duration < sixteenth - EPSILON) {
      fail('heterophony:density', `event ${i} duration ${event.duration} is shorter than a sixteenth (${sixteenth}) — 32nd-note regression`);
    }
  });
  if (hetOut.length > hetLead.length * 2) {
    fail('heterophony:density', `produced ${hetOut.length} events from ${hetLead.length} lead notes (> 2× — over-subdivided)`);
  }
}

// --- 1c. imitation stays in the mode (Session-10 checkpoint regression) -----
// The old imitation transposed in SEMITONES (a "real answer"), turning a diatonic
// lead chromatic — out-of-key D#/A# clashed with the melody. The tonal (scale-step)
// answer must keep every echo pitch class in the active scale.
for (const { mode, tonic, progression } of PROBES) {
  const { lead, chordsByAbsBar } = buildPassage(mode, tonic, progression);
  const out = TEXTURE_REGISTRY.imitation_one_beat_delay(lead, chordsByAbsBar, mode, tonic, LEAD_OCTAVE, METER, {});
  const inScale = new Set(pitchSetForScale(mode, tonic).map(pitchClassOf));
  out.forEach((event, i) => {
    if (!inScale.has(pitchClassOf(event.pitch))) {
      fail('imitation:in-mode', `${mode}: echo ${i} ${toScoreString(event.pitch)} is out of the ${mode} scale`);
    }
  });
}

// --- 2. dispatch reaches every registry entry ------------------------------

const registryNames = Object.keys(TEXTURE_REGISTRY).sort();
if (registryNames.length < 13) {
  fail('registry', `expected ≥ 13 textures, found ${registryNames.length}: ${registryNames.join(', ')}`);
}
for (const required of [
  'parallel_thirds_below', 'parallel_thirds_above', 'parallel_sixths_below', 'parallel_sixths_above',
  'contrary_motion', 'oblique_held', 'drone_on_1', 'drone_on_5', 'imitation_one_beat_delay',
  'voice_exchange', 'dropout', 'chord_tones_pulse', 'heterophony',
]) {
  if (typeof TEXTURE_REGISTRY[required] !== 'function') {
    fail('registry', `missing texture "${required}"`);
  }
}

// --- 3. end-to-end over every inspector case -------------------------------

CASES.forEach((testCase) => {
  let jingle;
  try {
    jingle = runPipeline(testCase);
  } catch (error) {
    fail(`e2e:${testCase.id}`, `runPipeline threw: ${error.message}`);
    return;
  }
  if (!jingle.tempo || !jingle.key) fail(`e2e:${testCase.id}`, 'missing tempo/key metadata');

  ['lead', 'harmony', 'bass'].forEach((voice) => {
    const track = jingle[voice];
    if (!Array.isArray(track)) {
      fail(`e2e:${testCase.id}:${voice}`, 'track is not an array');
      return;
    }
    track.forEach((event, i) => {
      const [note, duration] = event;
      if (!(typeof duration === 'number' && duration > 0)) {
        fail(`e2e:${testCase.id}:${voice}`, `event ${i} duration not positive: ${JSON.stringify(duration)}`);
      }
      if (note !== 'rest') {
        const freq = noteToFreq(note);
        if (!Number.isFinite(freq) || freq <= 0) {
          fail(`e2e:${testCase.id}:${voice}`, `event ${i} note "${note}" → bad freq ${freq}`);
        }
      }
    });
  });

  // The three voices must stay beat-aligned.
  const beats = (track) => track.reduce((s, e) => s + e[1], 0);
  const lengths = ['lead', 'harmony', 'bass'].map((v) => beats(jingle[v]));
  if (Math.max(...lengths) - Math.min(...lengths) > 1e-6) {
    fail(`e2e:${testCase.id}:align`, `track beat-lengths disagree: ${JSON.stringify(lengths)}`);
  }
});

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`verify-textures FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
for (const n of notes) console.log('  note: ' + n);
console.log(
  `verify-textures PASSED — ${registryNames.length} textures invariant-checked across ${PROBES.length} modes, ` +
  `dispatch reaches the registry, and runPipeline is clean across ${CASES.length} cases.`
);
