/* =================================================================
   VERIFY-STAGE8 — exit-criterion check for the Roman-numeral resolver and
   cadence enforcement (buildplan Session 5).

   It confirms:
     1. roman-numeral — resolveRoman is stub-compatible on diatonic triads
        (modal spelling, derived quality), resolves chromatic alterations
        (bII/bVI/#iv), seventh and sixth chords, and reports validity /
        available chords correctly per mode.
     2. cadence-formulas — all SEVEN formulas, applied to representative
        sections, produce the expected Pitch-bearing overwrite events at the
        expected beats/durations (the closing chord of each spells correctly,
        the phrygian cadence lands its half-step descent).
     3. stage-8 — enforceCadences splices each section's declared cadence into
        the beat-stamped VoiceTracks, leaving every voice sorted and the
        cadence events present at the section's tail.
     4. end-to-end — runPipeline over every hand-written case (Stage 6 → 7-stub
        → 8 → toSynthString) yields a FinalJingle whose every event has a
        positive duration and (when not a rest) a synth string parsing through
        the real synth.js noteToFreq to a finite, positive frequency. No NaN
        reaches the synth, and the three voices stay beat-aligned.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage8.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import { resolveRoman, isValidInMode, listAvailableChords } from './roman-numeral.js';
import { CADENCE_FORMULAS } from './cadence-formulas.js';
import { toScoreString } from './pitch.js';
import { realizeVoices } from '../pipeline/stage-6-voice.js';
import { enforceCadences } from '../pipeline/stage-8-cadence.js';
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

// --- 1. roman-numeral resolver ---------------------------------------------

const members = (r, m, t, o) => resolveRoman(r, m, t, o).members.map(toScoreString);
const quality = (r, m, t) => resolveRoman(r, m, t).quality;

// Stub-compatible diatonic behaviour (must match the Session-4 anchors).
expect('roman:C-I', members('I', 'major', 'C', 3), ['C3', 'E3', 'G3']);
expect('roman:C-V', members('V', 'major', 'C', 4), ['G4', 'B4', 'D5']);
expect('roman:C-ii-quality', quality('ii', 'major', 'C'), 'minor');
expect('roman:Ephr-II', members('II', 'phrygian_dominant', 'E', 3), ['F3', 'A3', 'C4']);
expect('roman:Ephr-II-quality', quality('II', 'phrygian_dominant', 'E'), 'major');
expect('roman:Ephr-v-quality', quality('v', 'phrygian_dominant', 'E'), 'diminished');
expect('roman:Ddor-VII', members('VII', 'dorian', 'D', 3), ['C4', 'E4', 'G4']);

// Chromatic alterations: major-relative root, then a triad in the new key.
expect('roman:bII-major', members('bII', 'major', 'C', 3), ['Db3', 'F3', 'Ab3']);
expect('roman:bII-Ephr', members('bII', 'phrygian_dominant', 'E', 3), ['F3', 'A3', 'C4']); // == diatonic II
expect('roman:bVI-major', members('bVI', 'major', 'C', 3), ['Ab3', 'C4', 'Eb4']);
expect('roman:bVII-major', members('bVII', 'major', 'C', 3), ['Bb3', 'D4', 'F4']);
expect('roman:sharpIV-quality', quality('#iv', 'major', 'C'), 'minor'); // lowercase default

// Seventh / sixth chords.
expect('roman:V7', [members('V7', 'major', 'C', 4), quality('V7', 'major', 'C')], [['G4', 'B4', 'D5', 'F5'], 'dominant7']);
expect('roman:Imaj7-quality', quality('Imaj7', 'major', 'C'), 'major7');
expect('roman:ii7-quality', quality('ii7', 'major', 'C'), 'minor7');
expect('roman:viiHalfDim-quality', quality('viiø7', 'major', 'C'), 'halfdim7');
expect('roman:viiDim7-quality', quality('vii°7', 'harmonic_minor', 'A'), 'dim7');
expect('roman:I6-quality', quality('I6', 'major', 'C'), 'major6');

// Listing + validity.
expect('roman:list-dorian', listAvailableChords('dorian'), ['i', 'ii', 'III', 'IV', 'v', 'vi°', 'VII']);
expect('roman:list-major', listAvailableChords('major'), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
expect('roman:valid-V-major', isValidInMode('V', 'major'), true);
expect('roman:valid-viio-major', isValidInMode('vii°', 'major'), true);
expect('roman:invalid-vio-major', isValidInMode('vi°', 'major'), false); // ° contradicts diatonic minor
expect('roman:invalid-bVI-noflag', isValidInMode('bVI', 'major'), false);
expect('roman:valid-bVI-flag', isValidInMode('bVI', 'major', true), true);
expect('roman:valid-V-aeolian-flag', isValidInMode('V', 'aeolian', true), true);
expect('roman:invalid-garbage', isValidInMode('Q9', 'major', true), false);

// --- 2. cadence formulas, expected pitches ---------------------------------

// Render a formula's output for one voice as [score, beat, duration] tuples.
const voiceTuples = (events) => events.map((e) => [toScoreString(e.pitch), e.beat, e.duration]);

// A C-major section: A3 of an AABA, startBar 12, 4 bars, 4/4 → section end 64,
// so the cadence's final-two-beats window is beats 62–64. Called WITHOUT
// voiceTracks, so the formulas use the register-centre fallback voicing (the
// pre-revision pitches) — only the timing moved to the final two beats.
const C_MAJOR = { meter: { numerator: 4, denominator: 4 }, tonic: 'C', mode: 'major', register_center: 'C5' };
const C_SEC = { label: 'A3', startBar: 12, bars: 4 };

function expectCadence(name, params, section, expected) {
  const out = CADENCE_FORMULAS[name](params, section);
  for (const voice of ['lead', 'harmony', 'bass']) {
    expect(`cadence:${name}:${voice}`, voiceTuples(out[voice]), expected[voice]);
  }
}

expectCadence('PAC', C_MAJOR, C_SEC, {
  lead: [['D5', 62, 1], ['C5', 63, 1]],
  harmony: [['B4', 62, 1], ['E4', 63, 1]],
  bass: [['G3', 62, 1], ['C3', 63, 1]],
});
expectCadence('IAC', C_MAJOR, C_SEC, {
  lead: [['D5', 62, 1], ['E5', 63, 1]],
  harmony: [['B4', 62, 1], ['G4', 63, 1]],
  bass: [['G3', 62, 1], ['C3', 63, 1]],
});
expectCadence('half', C_MAJOR, C_SEC, {
  lead: [['C5', 62, 1], ['D5', 63, 1]],
  harmony: [['B4', 62, 1], ['B4', 63, 1]],
  bass: [['G3', 62, 1], ['G3', 63, 1]],
});
expectCadence('deceptive', C_MAJOR, C_SEC, {
  lead: [['D5', 62, 1], ['E5', 63, 1]],
  harmony: [['B4', 62, 1], ['C5', 63, 1]],
  bass: [['G3', 62, 1], ['A3', 63, 1]],
});
expectCadence('plagal', C_MAJOR, C_SEC, {
  lead: [['C5', 62, 1], ['C5', 63, 1]],
  harmony: [['A4', 62, 1], ['E4', 63, 1]],
  bass: [['F3', 62, 1], ['C3', 63, 1]],
});
expectCadence('modal_iv_i', C_MAJOR, C_SEC, {
  lead: [['F5', 62, 1], ['E5', 63, 1]],
  harmony: [['A4', 62, 1], ['G4', 63, 1]],
  bass: [['F3', 62, 1], ['C3', 63, 1]],
});
expectCadence('phrygian_ii_i', C_MAJOR, C_SEC, {
  lead: [['D5', 62, 1], ['C5', 63, 1]],
  harmony: [['F4', 62, 1], ['E4', 63, 1]],
  bass: [['Db3', 62, 1], ['C3', 63, 1]],
});

// The two mode-specific cadences the human checkpoint listens for: the
// phrygian half-step descent (bass F→E under lead F→E) and the modal iv→i.
// Section startBar 0, 4 bars → final-two-beats window is beats 14–16.
const E_PHR = { meter: { numerator: 4, denominator: 4 }, tonic: 'E', mode: 'phrygian_dominant', register_center: 'E5' };
expectCadence('phrygian_ii_i', E_PHR, { label: 'A', startBar: 0, bars: 4 }, {
  lead: [['F5', 14, 1], ['E5', 15, 1]], // F → E half-step descent in the lead
  harmony: [['A4', 14, 1], ['G#4', 15, 1]],
  bass: [['F3', 14, 1], ['E3', 15, 1]], // F → E half-step descent in the bass
});
const D_DOR = { meter: { numerator: 4, denominator: 4 }, tonic: 'D', mode: 'dorian', register_center: 'D5' };
expectCadence('modal_iv_i', D_DOR, { label: 'A', startBar: 0, bars: 4 }, {
  lead: [['G5', 14, 1], ['F5', 15, 1]],
  harmony: [['B4', 14, 1], ['A4', 15, 1]],
  bass: [['G3', 14, 1], ['D3', 15, 1]], // IV (G major in dorian) → i (D)
});

// --- 3. stage-8 splice behaviour -------------------------------------------

// On Sunrise Fanfare (A3 declares PAC), the post-cadence lead must end on the
// tonic at the section's final beats, and every voice must stay sorted by beat.
const sunrise = CASES.find((c) => c.id === 'c-major-aaba');
const tracks6 = realizeVoices(sunrise);
const tracks8 = enforceCadences(tracks6, sunrise.harmonicPlan, sunrise.macroParams);

for (const voice of ['lead', 'harmony', 'bass']) {
  const beats = tracks8[voice].map((e) => e.beat);
  const sorted = [...beats].sort((a, b) => a - b);
  expect(`stage8:sorted:${voice}`, beats, sorted);
  const overlaps = tracks8[voice].some((e, i) =>
    i > 0 && tracks8[voice][i - 1].beat + tracks8[voice][i - 1].duration > e.beat + 1e-9
  );
  if (overlaps) fail(`stage8:overlap:${voice}`, 'events overlap after the cadence splice');
}

// Sunrise A3 = PAC. After the cadence-manifestation revision the cadence
// overwrites only the final two beats (62–64): its last lead event resolves to
// the tonic C (in whatever octave the approaching melody placed it — no longer
// pinned to C5), and the A3 motif material in the first half of the final bar
// SURVIVES and leads into the cadence (the flow-in the Session-9 checkpoint asked
// for) instead of the whole bar going static.
const lastLead = tracks8.lead[tracks8.lead.length - 1];
if (!(lastLead.pitch && lastLead.pitch.letter === 'C' && lastLead.pitch.accidental === 0)) {
  fail('stage8:PAC-lands-on-tonic', `last lead event ${toScoreString(lastLead.pitch)} is not the tonic C (any octave)`);
}
if (!(lastLead.beat >= 62 - 1e-9)) {
  fail('stage8:PAC-final-beat', `last lead event starts at beat ${lastLead.beat}, expected the cadence window (≥62)`);
}
// Flow-in: the final bar (beats 60–64) keeps lead material before the cadence
// window (beats 60–62), rather than being wholly overwritten.
const leadsIntoCadence = tracks8.lead.some((e) => e.pitch && e.beat >= 60 - 1e-9 && e.beat < 62 - 1e-9);
if (!leadsIntoCadence) {
  fail('stage8:flow-in', 'expected lead material in the final bar before the cadence window (the melody leading into the cadence)');
}

// Stage 8 must not mutate its input (the Stage-6 tracks).
const tracks6Lead0 = realizeVoices(sunrise).lead[0];
expect('stage8:no-mutation', toScoreString(tracks6.lead[0].pitch), toScoreString(tracks6Lead0.pitch));

// Unknown cadence type throws loudly.
try {
  enforceCadences(tracks6, { sections: [{ label: 'A1', cadence: 'bogus' }] }, sunrise.macroParams);
  fail('stage8:unknown-cadence', 'expected a throw on an unknown cadence type');
} catch {
  /* expected */
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
  console.error(`verify-stage8 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `verify-stage8 PASSED — resolver + 7 cadence formulas + Stage 8 splice consistent across ${CASES.length} cases.`
);
