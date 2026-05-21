/* =================================================================
   VERIFY-STAGE6 — exit-criterion check for voice realization (buildplan
   Session 4).

   It confirms:
     1. roman-numeral-stub — resolveRoman builds the right diatonic triads
        (root/quality/members) in major and in an exotic mode, places them at
        the requested octave, and throws on a chromatic alteration.
     2. bass-patterns — each of the five patterns returns positive-duration,
        Pitch-bearing events for 4/4; root_fifth adapts to 3/4 and 6/8.
     3. stage-6 realizeVoices — produces VoiceTracks of { pitch, duration }
        with Pitch objects throughout, and realizes a chromatic_neighbor
        anomaly as a genuinely out-of-scale pitch.
     4. end-to-end — runPipeline over every hand-written case yields a
        FinalJingle whose every event has a positive duration and (when not a
        rest) a synth string that parses through the real synth.js noteToFreq
        to a finite, positive frequency. No NaN reaches the synth.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage6.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import { resolveRoman } from './roman-numeral-stub.js';
import * as Bass from './bass-patterns.js';
import { pitchSetForScale } from './mode-engine.js';
import { pitchClassOf, toScoreString, toMidi } from './pitch.js';
import * as T from './transformations.js';
import { realizeVoices } from '../pipeline/stage-6-voice.js';
import { runPipeline } from '../pipeline/pipeline-runner.js';
import { noteToFreq } from '../synth.js';
import { CASES } from '../debug/pipeline-inspector-cases.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);

function expect(scope, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(scope, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectThrows(scope, thunk) {
  try {
    thunk();
    fail(scope, 'expected a throw, but none happened');
  } catch {
    /* expected */
  }
}

const isPitch = (p) =>
  p && typeof p === 'object' && typeof p.letter === 'string' &&
  Number.isInteger(p.accidental) && Number.isInteger(p.octave);

const FOUR_FOUR = { numerator: 4, denominator: 4, grouping: [4] };

// --- 1. roman-numeral-stub -------------------------------------------------

const cMajorI = resolveRoman('I', 'major', 'C', 3);
expect('roman:C-major-I-root', toScoreString(cMajorI.root), 'C3');
expect('roman:C-major-I-quality', cMajorI.quality, 'major');
expect('roman:C-major-I-members', cMajorI.members.map(toScoreString), ['C3', 'E3', 'G3']);

const cMajorV = resolveRoman('V', 'major', 'C');
expect('roman:C-major-V-quality', cMajorV.quality, 'major');
expect('roman:C-major-V-members', cMajorV.members.map(toScoreString), ['G4', 'B4', 'D5']);

const cMajorii = resolveRoman('ii', 'major', 'C');
expect('roman:C-major-ii-quality', cMajorii.quality, 'minor');

// Exotic mode: "II" in E phrygian-dominant is the bII-flavoured F major triad.
const ephrII = resolveRoman('II', 'phrygian_dominant', 'E', 3);
expect('roman:Ephr-II-quality', ephrII.quality, 'major');
expect('roman:Ephr-II-root-class', pitchClassOf(ephrII.root), 5); // F
// A diminished diatonic triad still resolves (quality derived from pitches).
expect('roman:Ephr-v-quality', resolveRoman('v', 'phrygian_dominant', 'E').quality, 'diminished');
// Chromatic alteration is out of scope for the stub.
expectThrows('roman:chromatic-throws', () => resolveRoman('bII', 'major', 'C'));

// --- 2. bass-patterns ------------------------------------------------------

function assertEvents(scope, events) {
  if (!Array.isArray(events) || events.length === 0) {
    fail(scope, `expected a non-empty event array, got ${JSON.stringify(events)}`);
    return;
  }
  events.forEach((event, i) => {
    if (!isPitch(event.pitch)) fail(scope, `event ${i} pitch is not a Pitch: ${JSON.stringify(event.pitch)}`);
    if (!(typeof event.duration === 'number' && event.duration > 0)) {
      fail(scope, `event ${i} duration not positive: ${JSON.stringify(event.duration)}`);
    }
  });
}

const chord = resolveRoman('I', 'major', 'C', 3);
const nextChord = resolveRoman('V', 'major', 'C', 3);

const rf44 = Bass.root_fifth(chord, 'major', 'C', FOUR_FOUR, 1, {});
assertEvents('bass:root_fifth-4/4', rf44);
expect('bass:root_fifth-4/4-count', rf44.length, 4);
expect('bass:root_fifth-4/4-pitches', rf44.map((e) => toScoreString(e.pitch)), ['C3', 'G3', 'C3', 'G3']);

const rf34 = Bass.root_fifth(chord, 'major', 'C', { numerator: 3, denominator: 4 }, 1, {});
expect('bass:root_fifth-3/4-count', rf34.length, 3);
expect('bass:root_fifth-3/4-durs', rf34.map((e) => e.duration), [1, 1, 1]);

const rf68 = Bass.root_fifth(chord, 'major', 'C', { numerator: 6, denominator: 8 }, 1, {});
assertEvents('bass:root_fifth-6/8', rf68);
expect('bass:root_fifth-6/8-totalbeats', rf68.reduce((s, e) => s + e.duration, 0), 6);

assertEvents('bass:walking', Bass.walking(chord, 'major', 'C', FOUR_FOUR, 1, { nextChord }));
expect('bass:walking-count', Bass.walking(chord, 'major', 'C', FOUR_FOUR, 1, { nextChord }).length, 4);
assertEvents('bass:pedal', Bass.pedal(chord, 'major', 'C', FOUR_FOUR, 2, { degree: 5 }));
assertEvents('bass:arpeggio', Bass.arpeggio(chord, 'major', 'C', FOUR_FOUR, 1, {}));
expect('bass:arpeggio-count', Bass.arpeggio(chord, 'major', 'C', FOUR_FOUR, 1, {}).length, 8);
assertEvents('bass:cadential', Bass.cadential_5_1(chord, 'major', 'C', FOUR_FOUR, 1, {}));

// --- 3. realizeVoices structure + chromatic anomaly ------------------------

// A minimal one-bar plan whose motif carries a chromatic passing tone between
// the tonic and the second degree. In C major that inserted note must bend to
// a pitch class outside the scale.
const chromMotif = T.ornament_chromatic_passing(
  { degrees: [1, 2, 3], rhythm: [1, 1, 1], contour: 'rising_arc', register: 'mid', anomaly: null },
  { at_position: 0 }
);
const chromPlan = {
  macroParams: {
    tempo: 120,
    meter: FOUR_FOUR,
    tonic: 'C',
    mode: 'major',
    form: 'through_composed',
    total_bars: 1,
    register_center: 'C5',
    sections: [{ label: 'A', bars: 1 }],
  },
  motifs: { x: chromMotif },
  harmonicPlan: { sections: [{ label: 'A', progression: ['I'] }] },
  phrasePlan: { A: { lead: [{ motif: 'x', transform: 'literal', start_bar: 1, length_bars: 1 }] } },
  texturePlan: { A: { harmony: [], bass: [] } },
};
const chromTracks = realizeVoices(chromPlan);

['lead', 'harmony', 'bass'].forEach((voice) => {
  if (!Array.isArray(chromTracks[voice])) fail('stage6:tracks-shape', `${voice} is not an array`);
  chromTracks[voice].forEach((ev, i) => {
    if (ev.pitch !== null && !isPitch(ev.pitch)) fail('stage6:pitch', `${voice}[${i}] pitch malformed`);
    if (!(ev.duration > 0)) fail('stage6:duration', `${voice}[${i}] duration not positive`);
  });
});

const cMajorClasses = new Set(pitchSetForScale('major', 'C').map(pitchClassOf));
const chromaticNotes = chromTracks.lead.filter((ev) => ev.pitch && !cMajorClasses.has(pitchClassOf(ev.pitch)));
if (chromaticNotes.length === 0) {
  fail('stage6:chromatic', 'expected at least one out-of-scale (chromatic) lead pitch, found none');
}

// --- 4. end-to-end over every case -----------------------------------------

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
    let sounded = 0;
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
        sounded += 1;
      }
    });
    // Lead and bass must actually sound; harmony may legitimately rest in
    // bars without a parallel_thirds_below assignment, but our cases cover it.
    if (sounded === 0) fail(`e2e:${testCase.id}:${voice}`, 'track has no sounding notes');
  });

  // Track lengths (in beats) must agree so the voices stay aligned.
  const beats = (track) => track.reduce((s, e) => s + e[1], 0);
  const lengths = ['lead', 'harmony', 'bass'].map((v) => beats(jingle[v]));
  if (Math.max(...lengths) - Math.min(...lengths) > 1e-6) {
    fail(`e2e:${testCase.id}:align`, `track beat-lengths disagree: ${JSON.stringify(lengths)}`);
  }
});

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`verify-stage6 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`verify-stage6 PASSED — voice realization is consistent across ${CASES.length} cases.`);
