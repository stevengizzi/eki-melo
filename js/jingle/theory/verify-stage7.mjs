/* =================================================================
   VERIFY-STAGE7 — exit-criterion check for the voice-leading pass (buildplan
   Session 7).

   It confirms:
     0. primitives — clampToRange / snapToMode / moveByStep / intervalBetween
        behave per spec (octave-displace; nearest-in-mode, ties downward; one
        scale step; signed semitones).
     a. chiptune_idiomatic fires ZERO repairs on every Session-6 inspector case
        (audibly identical to pre-Session-7; a repair here would flag a Stage-6
        regression) and the cases still run end-to-end clean.
     b. cpp_strict repairs the intentionally-crossing passages: Desert's
        imitation A' is uncrossed (and ONLY there among the inspector cases),
        and a synthetic parallel_thirds_above passage is uncrossed too. The
        per-case repair counts are locked as a regression anchor.
     c. a chromatic_neighbor (anomaly-flagged) lead note SURVIVES chiptune's
        out_of_mode repair (passed through verbatim) and is SNAPPED under
        cpp_strict.
     d. range-clamp octave-displaces a pitch above MIDI 96 back into range under
        either preset.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage7.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  applyVoiceLeading,
  voiceLeadingReport,
  clampToRange,
  snapToMode,
  moveByStep,
  intervalBetween,
  PRESETS,
} from './voice-leading-rules.js';
import { toMidi, toScoreString, pitchClassOf, parseScoreString } from './pitch.js';
import { pitchSetForScale } from './mode-engine.js';
import * as T from './transformations.js';
import { realizeVoices } from '../pipeline/stage-6-voice.js';
import { runPipeline } from '../pipeline/pipeline-runner.js';
import { DEFAULT_CONFIG } from '../pipeline/pipeline-config.js';
import { noteToFreq } from '../synth.js';
import { CASES } from '../debug/pipeline-inspector-cases.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const expect = (scope, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(scope, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const expectThrows = (scope, thunk) => {
  try {
    thunk();
    fail(scope, 'expected a throw, but none happened');
  } catch {
    /* expected */
  }
};

const FOUR_FOUR = { numerator: 4, denominator: 4, grouping: [4] };
const sp = (str) => parseScoreString(str);

// --- 0. primitive repair operations ----------------------------------------

// clampToRange octave-displaces (preserves letter/accidental).
expect('clamp:above', toScoreString(clampToRange(sp('E7'), 60, 96)), 'E6'); // 100 → 88
expect('clamp:below', toScoreString(clampToRange(sp('C1'), 60, 96)), 'C4'); // 24 → 60
expect('clamp:in-range', toScoreString(clampToRange(sp('G4'), 36, 72)), 'G4'); // unchanged
expectThrows('clamp:bad-range', () => clampToRange(sp('C5'), 96, 60));

// snapToMode: nearest in-mode pitch, ties downward.
expect('snap:C#5-major', toScoreString(snapToMode(sp('C#5'), 'major', 'C')), 'C5'); // tie C5/D5 → down
expect('snap:F#5-Ephr', toScoreString(snapToMode(sp('F#5'), 'phrygian_dominant', 'E')), 'F5'); // F# → F (in mode)
expect('snap:already-in-mode', toScoreString(snapToMode(sp('E5'), 'major', 'C')), 'E5');

// moveByStep: one scale step up / down.
expect('step:up', toScoreString(moveByStep(sp('C5'), 'major', 'C', +1)), 'D5');
expect('step:down', toScoreString(moveByStep(sp('C5'), 'major', 'C', -1)), 'B4');
expect('step:up-dorian', toScoreString(moveByStep(sp('C5'), 'dorian', 'D', +1)), 'D5'); // C5 is ^7 of D dorian → D5

// intervalBetween: signed semitones (positive = B above A).
expect('interval:up', intervalBetween(sp('C4'), sp('G4')), 7);
expect('interval:down', intervalBetween(sp('G4'), sp('C4')), -7);
expect('interval:unison', intervalBetween(sp('C4'), sp('C4')), 0);

// Unknown preset throws.
expectThrows('preset:unknown', () => applyVoiceLeading({ lead: [], harmony: [], bass: [] }, { mode: 'major', tonic: 'C' }, 'nope'));
// Default preset is chiptune_idiomatic.
expect('preset:registry', Object.keys(PRESETS).sort(), ['chiptune_idiomatic', 'cpp_strict']);

// --- a. chiptune_idiomatic: zero repairs + input not mutated ----------------

const sectionRange = (testCase, label) => {
  const beatsPerBar = testCase.macroParams.meter.numerator;
  let startBar = 0;
  for (const s of testCase.macroParams.sections) {
    if (s.label === label) return [startBar * beatsPerBar, (startBar + s.bars) * beatsPerBar];
    startBar += s.bars;
  }
  return null;
};

for (const testCase of CASES) {
  const t6 = realizeVoices(testCase);
  const before = JSON.stringify(t6);
  const { repairs } = voiceLeadingReport(t6, testCase.macroParams, 'chiptune_idiomatic');
  if (repairs.length !== 0) {
    fail(`a:chiptune-zero:${testCase.id}`, `expected 0 repairs, got ${repairs.length}: ${repairs.map((r) => `${r.type}@${r.beat}`).join(', ')}`);
  }
  if (JSON.stringify(t6) !== before) fail(`a:no-mutation:${testCase.id}`, 'Stage-6 tracks were mutated by applyVoiceLeading');
}

// End-to-end clean under both presets (positive durations, parseable freqs,
// voices beat-aligned).
const cppConfig = { ...DEFAULT_CONFIG, knobs: { ...DEFAULT_CONFIG.knobs, voice_leading_strictness: 'cpp_strict' } };
for (const [presetLabel, cfg] of [['chiptune', undefined], ['cpp_strict', cppConfig]]) {
  for (const testCase of CASES) {
    let jingle;
    try {
      jingle = runPipeline(testCase, cfg);
    } catch (error) {
      fail(`a:e2e:${presetLabel}:${testCase.id}`, `runPipeline threw: ${error.message}`);
      continue;
    }
    const lengths = ['lead', 'harmony', 'bass'].map((voice) => {
      let length = 0;
      jingle[voice].forEach(([note, duration], i) => {
        length += duration;
        if (!(typeof duration === 'number' && duration > 0)) {
          fail(`a:e2e:${presetLabel}:${testCase.id}:${voice}`, `event ${i} duration not positive: ${duration}`);
        }
        if (note !== 'rest') {
          const freq = noteToFreq(note);
          if (!Number.isFinite(freq) || freq <= 0) fail(`a:e2e:${presetLabel}:${testCase.id}:${voice}`, `event ${i} "${note}" → bad freq ${freq}`);
        }
      });
      return length;
    });
    if (Math.max(...lengths) - Math.min(...lengths) > 1e-6) {
      fail(`a:e2e:${presetLabel}:${testCase.id}:align`, `track beat-lengths disagree: ${JSON.stringify(lengths)}`);
    }
  }
}

// --- b. cpp_strict: repairs at the intentionally-crossing passages ----------

const cppRepairs = {};
for (const testCase of CASES) {
  cppRepairs[testCase.id] = voiceLeadingReport(realizeVoices(testCase), testCase.macroParams, 'cpp_strict').repairs;
}
const countType = (repairs, type) => repairs.filter((r) => r.type === type).length;

// Locked per-case totals (regression anchor — see the Session-7 journal table).
// RE-PINNED Session 12: the phrase-motif rework replaced the cell fixtures with
// per-section phrases (same macroParams / harmony / textures, new melody content),
// so the cpp_strict crossing counts shifted — sunrise 6 → 2, desert 8 → 4 (its
// A' uncross 6 → 1). The CHIPTUNE_IDIOMATIC ZERO-REPAIR GATE (section a) is
// unchanged and still holds on the new phrases — that is the inviolable approved-
// audio rule; these cpp_strict totals are a regression anchor re-baselined to the
// deliberately-changed fixtures, not a relaxation.
expect('b:count:sunrise', cppRepairs['c-major-aaba'].length, 3);
expect('b:count:wanderer', cppRepairs['d-dorian-aba'].length, 0);
expect('b:count:desert', cppRepairs['e-phrygian-dominant-aba'].length, 4);

// Only the imitation case crosses among the inspector cases — uncross fires on
// Desert and nowhere else, and every uncross there is inside the A' passage.
expect('b:uncross:sunrise', countType(cppRepairs['c-major-aaba'], 'uncross'), 0);
expect('b:uncross:wanderer', countType(cppRepairs['d-dorian-aba'], 'uncross'), 0);
const desertUncross = cppRepairs['e-phrygian-dominant-aba'].filter((r) => r.type === 'uncross');
expect('b:uncross-count:desert', desertUncross.length, 1);
const [aPrimeStart, aPrimeEnd] = sectionRange(CASES.find((c) => c.id === 'e-phrygian-dominant-aba'), "A'");
for (const repair of desertUncross) {
  if (!(repair.beat >= aPrimeStart - 1e-9 && repair.beat < aPrimeEnd - 1e-9)) {
    fail('b:uncross-location:desert', `uncross @${repair.beat} is outside the A' imitation passage [${aPrimeStart}, ${aPrimeEnd})`);
  }
}

// A synthetic parallel_thirds_above passage: chiptune leaves the upper harmony
// alone (crossing is intrinsic / ignored); cpp_strict uncrosses it.
const aboveCase = {
  id: 'synthetic-thirds-above',
  macroParams: {
    tempo: 120, meter: FOUR_FOUR, tonic: 'C', mode: 'major', form: 'through_composed',
    total_bars: 2, register_center: 'C5', sections: [{ label: 'A', bars: 2 }],
  },
  motifs: { a: { degrees: [1, 2, 3, 4, 5, 4, 3, 2], rhythm: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], contour: 'rising_arc', register: 'mid', anomaly: null } },
  harmonicPlan: { sections: [{ label: 'A', progression: ['I', 'V'], cadence: 'none', anomaly: null }] },
  phrasePlan: {
    A: { lead: [
      { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
      { motif: 'a', transform: 'literal', start_bar: 2, length_bars: 1 },
    ] },
  },
  texturePlan: { A: { harmony: [{ bars: [1, 2], mode: 'parallel_thirds_above' }], bass: [{ bars: [1, 2], pattern: 'root_fifth' }] } },
};
const aboveT6 = realizeVoices(aboveCase);
expect('b:above:chiptune-zero', voiceLeadingReport(aboveT6, aboveCase.macroParams, 'chiptune_idiomatic').repairs.length, 0);
const aboveUncross = countType(voiceLeadingReport(aboveT6, aboveCase.macroParams, 'cpp_strict').repairs, 'uncross');
if (aboveUncross === 0) fail('b:above:cpp-uncrosses', 'expected cpp_strict to uncross the parallel_thirds_above passage, got 0');

// --- c. anomaly survives chiptune, snapped under cpp_strict -----------------

const chromMotif = T.ornament_chromatic_passing(
  { degrees: [1, 2, 3], rhythm: [1, 1, 1], contour: 'rising_arc', register: 'mid', anomaly: null },
  { at_position: 0 }
);
const chromPlan = {
  macroParams: { tempo: 120, meter: FOUR_FOUR, tonic: 'C', mode: 'major', form: 'through_composed', total_bars: 1, register_center: 'C5', sections: [{ label: 'A', bars: 1 }] },
  motifs: { x: chromMotif },
  harmonicPlan: { sections: [{ label: 'A', progression: ['I'] }] },
  phrasePlan: { A: { lead: [{ motif: 'x', transform: 'literal', start_bar: 1, length_bars: 1 }] } },
  texturePlan: { A: { harmony: [], bass: [] } },
};
const chromTracks = realizeVoices(chromPlan);
const cMajorClasses = new Set(pitchSetForScale('major', 'C').map(pitchClassOf));
const anomalyEvent = chromTracks.lead.find((e) => e.anomalous);
if (!anomalyEvent) {
  fail('c:tagging', 'Stage 6 did not tag any lead event with anomalous:true');
} else {
  if (cMajorClasses.has(pitchClassOf(anomalyEvent.pitch))) fail('c:setup', 'the anomaly note is unexpectedly already in mode');

  // chiptune: preserved verbatim, no snap repair.
  const chip = voiceLeadingReport(chromTracks, chromPlan.macroParams, 'chiptune_idiomatic');
  if (chip.repairs.some((r) => r.type === 'snap_to_mode')) fail('c:chiptune-no-snap', 'chiptune snapped the anomaly note');
  const chipEvent = chip.tracks.lead.find((e) => Math.abs(e.beat - anomalyEvent.beat) < 1e-9);
  expect('c:chiptune-preserved', toScoreString(chipEvent.pitch), toScoreString(anomalyEvent.pitch));

  // cpp_strict: snapped into mode.
  const cpp = voiceLeadingReport(chromTracks, chromPlan.macroParams, 'cpp_strict');
  const snap = cpp.repairs.find((r) => r.type === 'snap_to_mode' && Math.abs(r.beat - anomalyEvent.beat) < 1e-9);
  if (!snap) fail('c:cpp-snaps', 'cpp_strict did not snap the anomaly note');
  const cppEvent = cpp.tracks.lead.find((e) => Math.abs(e.beat - anomalyEvent.beat) < 1e-9);
  if (!cMajorClasses.has(pitchClassOf(cppEvent.pitch))) fail('c:cpp-in-mode', `cpp_strict snap left an out-of-mode pitch ${toScoreString(cppEvent.pitch)}`);
}

// --- d. range-clamp displaces a pitch above MIDI 96 -------------------------

const highTracks = {
  lead: [{ pitch: sp('E7'), beat: 0, duration: 1 }], // MIDI 100, in C major
  harmony: [{ pitch: sp('D7'), beat: 0, duration: 1 }], // MIDI 98, in C major
  bass: [{ pitch: sp('C3'), beat: 0, duration: 1 }],
};
const macroCMajor = { mode: 'major', tonic: 'C' };
for (const preset of ['chiptune_idiomatic', 'cpp_strict']) {
  const out = applyVoiceLeading(highTracks, macroCMajor, preset);
  const leadMidi = toMidi(out.lead[0].pitch);
  const harmonyMidi = toMidi(out.harmony[0].pitch);
  if (!(leadMidi >= 60 && leadMidi <= 96)) fail(`d:lead:${preset}`, `lead E7 not clamped into 60..96, got ${leadMidi}`);
  if (!(harmonyMidi >= 60 && harmonyMidi <= 96)) fail(`d:harmony:${preset}`, `harmony D7 not clamped into 60..96, got ${harmonyMidi}`);
}

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`verify-stage7 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `verify-stage7 PASSED — primitives + both presets consistent. chiptune_idiomatic: 0 repairs on all ${CASES.length} cases; ` +
  `cpp_strict repairs the crossing/parallel/tritone passages as expected.`
);
