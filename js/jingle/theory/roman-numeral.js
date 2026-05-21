/* =================================================================
   ROMAN NUMERAL — the full mode-aware chord resolver (buildplan Session 5).

   Replaces roman-numeral-stub.js (diatonic triads only). Drop-in compatible:
   same export signature, same diatonic behaviour, plus chromatic alterations,
   seventh/sixth chords, explicit quality markers, and the validation/listing
   helpers later stages need.

     resolveRoman(romanString, mode, tonic, octave = 4) →
       { root: Pitch, quality, members: [Pitch, …] }
     isValidInMode(romanString, mode, allowModalInterchange = false) → boolean
     listAvailableChords(mode) → array of canonical Roman strings for the mode

   PARSING. A numeral is
       [b|#]?  [ivIV]+  [°|o|ø|+|halfdim]?  [maj7|m7|7|6]?
   - A leading `b` lowers the root a chromatic semitone, `#` raises it.
   - Lowercase letters default the triad to minor, uppercase to major; an
     explicit `°`/`o` (diminished), `+` (augmented) or `ø`/`halfdim`
     (half-diminished) marker overrides the case default.
   - `7` is a dominant 7 on an uppercase numeral and a minor 7 on a lowercase
     one by default; `maj7` forces a major 7th, `m7` a minor triad + minor 7th,
     `6` adds a major 6th, `ø`/`halfdim` makes a half-diminished 7th.

   TWO REALIZATION STRATEGIES, by whether the numeral is altered:
   - DIATONIC (no leading accidental): the chord is stacked in thirds from the
     ACTIVE MODE's own degrees — d, d+2, d+4 (and d+6 / d+5 for sevenths and
     sixths). Its quality is derived from the resulting pitches, so modal
     spellings fall out for free: "II" in E phrygian-dominant is F-A-C (the
     famous bII sound) because degree 2 of that mode is F. This preserves the
     Session-4 stub's behaviour exactly.
   - CHROMATIC (leading accidental): the root is the MAJOR-scale degree of the
     tonic shifted a semitone (so bII in C is Db, bII in E is F regardless of
     mode), and the chord is then built as a major-or-minor (or dim/aug) triad
     in that altered root's own key — stacking thirds in MAJOR relative to the
     new root, per the buildplan. The quality comes from the case/marker, not
     from any mode.

   PORTABILITY. Imports only from theory/ (mode-engine.js, pitch.js).
   ================================================================= */
import { degreeToPitch } from './mode-engine.js';
import { toMidi, pitchFromLetterAndAccidental } from './pitch.js';

// Roman numeral core → scale degree (1-based). Case selects the default triad
// quality but never the degree.
const ROMAN_TO_DEGREE = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const DEGREE_TO_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// [leading accidental?][roman core][triad / half-dim marker?][seventh / sixth?]
const ROMAN_PATTERN = /^([b#])?([ivIV]+)(ø|halfdim|°|o|\+)?(maj7|m7|7|6)?$/;

// Marker glyph → the quality intent it forces.
const TRIAD_MARKER = { '°': 'diminished', o: 'diminished', '+': 'augmented', ø: 'halfdim', halfdim: 'halfdim' };

// Sharp-spelling fallback for the rare case where a chromatic shift would
// exceed a double accidental (see shiftSemitone). Audibly identical; only the
// theoretical letter differs.
const SHARP_SPELLING = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

function midiToPitch(midi) {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [letter, accidental] = SHARP_SPELLING[pitchClass];
  return pitchFromLetterAndAccidental(letter, accidental, octave);
}

// Shift a pitch `delta` semitones, preferring to keep the letter (nudge the
// accidental); fall back to a MIDI respelling only if that would need a triple
// accidental.
function shiftSemitone(pitch, delta) {
  if (delta === 0) return pitch;
  const adjusted = pitch.accidental + delta;
  if (adjusted >= -2 && adjusted <= 2) {
    return pitchFromLetterAndAccidental(pitch.letter, adjusted, pitch.octave);
  }
  return midiToPitch(toMidi(pitch) + delta);
}

/**
 * Parse a Roman-numeral string into its components. Throws on a malformed
 * string or an unrecognised numeral core. Internal — exported only for the
 * validation helpers and tests.
 */
export function parseRoman(romanString) {
  if (typeof romanString !== 'string') {
    throw new Error(`resolveRoman expects a Roman-numeral string, got ${typeof romanString}.`);
  }
  const match = romanString.trim().match(ROMAN_PATTERN);
  if (!match) {
    throw new Error(`Unparseable Roman numeral ${JSON.stringify(romanString)}. Expected e.g. "I", "ii", "V7", "bVI", "vii°".`);
  }
  const [, accidental = null, core, marker = null, seventh = null] = match;
  const degree = ROMAN_TO_DEGREE[core.toUpperCase()];
  if (degree === undefined) {
    throw new Error(`Unrecognised Roman numeral core ${JSON.stringify(core)} in ${JSON.stringify(romanString)}.`);
  }
  return {
    accidental,
    core,
    degree,
    isUpper: /[IV]/.test(core[0]),
    triadMarker: marker ? TRIAD_MARKER[marker] : null,
    seventhToken: seventh,
  };
}

// --- triad / quality machinery --------------------------------------------

// Triad quality from the two stacked-third sizes (semitones).
function triadQuality(rootToThird, thirdToFifth) {
  if (rootToThird === 4 && thirdToFifth === 3) return 'major';
  if (rootToThird === 3 && thirdToFifth === 4) return 'minor';
  if (rootToThird === 3 && thirdToFifth === 3) return 'diminished';
  if (rootToThird === 4 && thirdToFifth === 4) return 'augmented';
  return 'other';
}

function triadQualityOfMembers([root, third, fifth]) {
  return triadQuality(toMidi(third) - toMidi(root), toMidi(fifth) - toMidi(third));
}

// Bend the major third / perfect fifth of a major triad on `root` to land the
// requested quality, spelling each relative to the root's major scale.
const TRIAD_BEND = {
  major: { third: 0, fifth: 0 },
  minor: { third: -1, fifth: 0 },
  diminished: { third: -1, fifth: -1 },
  augmented: { third: 0, fifth: 1 },
  halfdim: { third: -1, fifth: -1 }, // a diminished triad; the 7th is added separately
};

function triadMembersOnRoot(root, quality) {
  const bend = TRIAD_BEND[quality] ?? TRIAD_BEND.major;
  const third = shiftSemitone(degreeToPitch('major', root, 3), bend.third);
  const fifth = shiftSemitone(degreeToPitch('major', root, 5), bend.fifth);
  return [root, third, fifth];
}

// Label a 3- or 4-note chord from its members' intervals above the root.
function chordQualityOfMembers(members) {
  const root = toMidi(members[0]);
  const t = toMidi(members[1]) - root;
  const f = toMidi(members[2]) - root;
  const triad = triadQuality(t, f - t);
  if (members.length < 4) return triad;
  const s = toMidi(members[3]) - root;
  const SEVENTH_LABEL = {
    'major:11': 'major7', 'major:10': 'dominant7',
    'minor:10': 'minor7', 'minor:11': 'minorMajor7',
    'diminished:10': 'halfdim7', 'diminished:9': 'dim7',
    'augmented:11': 'augMajor7', 'augmented:10': 'dominant7#5',
  };
  return SEVENTH_LABEL[`${triad}:${s}`] ?? 'seventh';
}

// Stack the seventh (or sixth) onto a resolved triad, returning the extended
// members and the chord's quality label. `isDiatonic` selects modal spelling
// for a plain `7`/`6`; otherwise the extension is spelled relative to the root.
function addExtension({ members, triadQualityLabel, seventhToken, isDiatonic, mode, tonic, degree, octave }) {
  const root = members[0];

  if (seventhToken === '6') {
    const sixth = isDiatonic
      ? degreeToPitch(mode, tonic, degree + 5, octave)
      : degreeToPitch('major', root, 6);
    return { members: [...members, sixth], quality: `${triadQualityLabel}6` };
  }

  let extended = members;
  let seventh;
  if (seventhToken === 'maj7') {
    seventh = degreeToPitch('major', root, 7);
  } else if (seventhToken === 'm7') {
    extended = triadMembersOnRoot(root, 'minor');
    seventh = shiftSemitone(degreeToPitch('major', root, 7), -1);
  } else {
    // plain '7': modal seventh when diatonic; dom7/min7-by-triad otherwise.
    seventh = isDiatonic
      ? degreeToPitch(mode, tonic, degree + 6, octave)
      : shiftSemitone(degreeToPitch('major', root, 7), triadQualityLabel === 'diminished' ? -2 : -1);
  }
  extended = [...extended, seventh];
  return { members: extended, quality: chordQualityOfMembers(extended) };
}

/**
 * Resolve `romanString` in `mode` rooted on `tonic` to its root, quality, and
 * members (all Pitch objects). `octave` (default 4) is the octave the root sits
 * in; higher chord tones stack ascending above it. See the module header for
 * the diatonic-vs-chromatic realization strategies and the parsing rules.
 *
 * Throws on a non-string numeral or an unrecognised numeral core.
 */
export function resolveRoman(romanString, mode, tonic, octave = 4) {
  const { accidental, degree, isUpper, triadMarker, seventhToken } = parseRoman(romanString);
  const halfDiminished = triadMarker === 'halfdim';

  let root;
  let members;
  let quality;

  if (!accidental) {
    // DIATONIC — stack thirds in the active mode; quality derived from pitches.
    root = degreeToPitch(mode, tonic, degree, octave);
    members = [root, degreeToPitch(mode, tonic, degree + 2, octave), degreeToPitch(mode, tonic, degree + 4, octave)];
    quality = triadQualityOfMembers(members);

    // An explicit triad marker that contradicts the modal quality re-spells the
    // triad to the marker (a chromatic alteration of the diatonic chord);
    // a matching marker keeps the modal spelling verbatim.
    const wantTriad = halfDiminished ? 'diminished' : triadMarker;
    if (wantTriad && wantTriad !== quality) {
      members = triadMembersOnRoot(root, wantTriad);
      quality = wantTriad;
    }
  } else {
    // CHROMATIC — root is the major-scale degree shifted a semitone, then a
    // triad built in the altered root's own key.
    const base = degreeToPitch('major', tonic, degree, octave);
    root = shiftSemitone(base, accidental === 'b' ? -1 : 1);
    quality = halfDiminished ? 'diminished' : triadMarker ?? (isUpper ? 'major' : 'minor');
    members = triadMembersOnRoot(root, quality);
  }

  // Half-diminished implies a minor 7th even if no explicit seventh token.
  const extension = halfDiminished ? '7' : seventhToken;
  if (extension) {
    const result = addExtension({
      members,
      triadQualityLabel: quality,
      seventhToken: extension,
      isDiatonic: !accidental,
      mode,
      tonic,
      degree,
      octave,
    });
    members = result.members;
    quality = result.quality;
  }

  return { root, quality, members };
}

// --- validation + listing --------------------------------------------------

// Modes whose tonic triad is major read as "major-ish" for the borrowed-chord
// vocabulary; everything else as "minor-ish". Cached per mode.
const MAJORNESS_CACHE = new Map();
function isMajorish(mode) {
  if (!MAJORNESS_CACHE.has(mode)) {
    MAJORNESS_CACHE.set(mode, resolveRoman('I', mode, 'C').quality === 'major');
  }
  return MAJORNESS_CACHE.get(mode);
}

// The standard modal-interchange / borrowed-chord vocabularies. A starting
// set (the buildplan's "bII, bVI, bVII in major; II, V, vii in minor; etc.");
// later sessions can widen these as the LLM harmonic stage needs.
const BORROWED_MAJORISH = new Set(['bII', 'bIII', 'iv', 'bVI', 'bVII', 'ii°', 'v', 'vii°']);
const BORROWED_MINORISH = new Set(['bII', 'II', 'V', 'IV', 'vii°', '#iv°', 'VII']);

/**
 * True when `romanString` is realizable in `mode`: either diatonically (the
 * chord stacks in thirds from the mode's own notes, with an explicit quality
 * marker that matches), or — when `allowModalInterchange` is set — as one of
 * the standard borrowed-chord types for the mode. The flag corresponds to
 * PipelineConfig.knobs.allow_modal_interchange; it defaults off, so the
 * two-argument form accepts only diatonic chords.
 */
export function isValidInMode(romanString, mode, allowModalInterchange = false) {
  let parsed;
  try {
    parsed = parseRoman(romanString);
  } catch {
    return false;
  }
  const { accidental, degree, triadMarker } = parsed;

  if (!accidental) {
    if (!triadMarker || triadMarker === 'halfdim') {
      // Plain numeral, or a half-diminished 7th — diatonic if the seventh stack
      // is in the mode (it always is for an in-mode degree).
      if (triadMarker === 'halfdim') {
        const diatonic = resolveRoman(DEGREE_TO_ROMAN[degree - 1], mode, 'C');
        return diatonic.quality === 'diminished'; // half-dim is diatonic only on a dim degree
      }
      return true;
    }
    // Explicit °/+ marker: diatonic only if it matches the modal triad quality.
    const diatonic = resolveRoman(DEGREE_TO_ROMAN[degree - 1], mode, 'C');
    if (diatonic.quality === triadMarker) return true;
    // Otherwise it is a chromatic alteration — fall through to the borrowed set.
  }

  const set = isMajorish(mode) ? BORROWED_MAJORISH : BORROWED_MINORISH;
  if (set.has(romanString.trim())) return allowModalInterchange;
  return false;
}

/**
 * The canonical diatonic Roman strings for `mode`, one per degree, cased and
 * marked by the modal triad quality (uppercase for major/augmented, lowercase
 * for minor/diminished, with `°`/`+` markers). For LLM-stage UI hints.
 * e.g. listAvailableChords("dorian") → ['i','ii','III','IV','v','vi°','VII'].
 */
export function listAvailableChords(mode) {
  return DEGREE_TO_ROMAN.map((base) => {
    const { quality } = resolveRoman(base, mode, 'C');
    const minorish = quality === 'minor' || quality === 'diminished';
    let label = minorish ? base.toLowerCase() : base;
    if (quality === 'diminished') label += '°';
    else if (quality === 'augmented') label += '+';
    return label;
  });
}
