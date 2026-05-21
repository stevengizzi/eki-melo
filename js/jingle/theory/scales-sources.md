# scales.json — verification sources

Every interval pattern in `scales.json` was cross-checked to sum to 12
(one octave) and verified against the references below. A scale was only
included when its interval pattern is unambiguous across sources; where a
name has competing definitions, the choice made is documented here.

The automated check in Session 1 confirmed all 47 patterns sum to 12 and
that every pitch the mode engine derives from them (across all 12 tonics,
degrees −9…+9) is a name `synth.js` `noteToFreq` can parse.

## Diatonic modes (7)
Rotations of the major scale `[2,2,1,2,2,2,1]`.
Ref: Wikipedia "Mode (music)"; any common-practice harmony text.
- major, dorian, phrygian, lydian, mixolydian, aeolian, locrian — the
  seven successive rotations, verified by rotation and by pitch set.

## Harmonic minor modes (7)
Rotations of harmonic minor `[2,1,2,2,1,3,1]` (natural minor, raised 7).
Ref: Wikipedia "Harmonic minor scale" and "Modes of the harmonic minor".
- harmonic_minor, locrian_n6, ionian_sharp5, dorian_sharp4,
  phrygian_dominant, lydian_sharp2, altered_dim (ultralocrian).
- phrygian_dominant cross-checked against E = E F G# A B C D.

## Melodic minor modes (7)
Rotations of ascending melodic minor `[2,1,2,2,2,2,1]`.
Ref: Wikipedia "Melodic minor scale" / "Jazz minor scale"; Mark Levine,
*The Jazz Theory Book*.
- melodic_minor, dorian_b2, lydian_augmented, lydian_dominant,
  mixolydian_b6, locrian_n2, altered (super locrian).
- lydian_dominant cross-checked against C = C D E F# G A Bb.
- altered cross-checked against C = C Db Eb Fb Gb Ab Bb.

## Harmonic major + 3 modes (4)
Parent harmonic major = major with b6 `[2,2,1,2,1,3,1]`.
Ref: Wikipedia "Harmonic major scale".
- harmonic_major (parent), dorian_b5, lydian_diminished (lydian b3),
  mixolydian_b2 — three of the seven modes, chosen because their names and
  intervals are stable across sources. The remaining modes were omitted to
  avoid shipping the more contested mode names.

## Double harmonic family (3)
Double harmonic major `[1,3,1,2,1,3,1]` (a.k.a. Byzantine / Gypsy major).
Ref: Wikipedia "Double harmonic scale".
- double_harmonic (parent), cross-checked C = C Db E F G Ab B.
- hungarian_minor `[2,1,3,1,1,3,1]` = mode 4 of double harmonic
  (= harmonic minor with #4); cross-checked C = C D Eb F# G Ab B. Filed
  under the double_harmonic family per the buildplan's grouping.
- oriental `[1,3,1,1,3,1,2]` = mode 5 of double harmonic; cross-checked
  C = C Db E F Gb A Bb.

## Neapolitan (2)
Ref: Wikipedia "Neapolitan scale".
- neapolitan_minor `[1,2,2,2,1,3,1]` = harmonic minor with b2.
- neapolitan_major `[1,2,2,2,2,2,1]` = melodic minor with b2.

## Hungarian major (1)
`[3,1,2,1,2,1,2]` = 1 #2 3 #4 5 6 b7. Ref: Wikipedia "Hungarian major
scale". Cross-checked C = C D# E F# G A Bb.

## Romanian minor (1)
`[2,1,3,1,2,1,2]` = 1 2 b3 #4 5 6 b7 (a.k.a. Ukrainian Dorian, Dorian #4).
Ref: Wikipedia "Ukrainian Dorian scale". Note: this is the same interval
set as `dorian_sharp4` (mode 4 of harmonic minor); both names are kept
intentionally because the buildplan requests each, and they carry
different family/idiom context.

## Pentatonics (6)
Ref: Wikipedia "Pentatonic scale" and "Japanese mode".
- major_pentatonic `[2,2,3,2,3]`, minor_pentatonic `[3,2,2,3,2]`.
- hirajoshi `[2,1,4,1,4]` (C D Eb G Ab) — the Kostka/Payne/Western-
  pedagogy form. Several conflicting hirajōshi definitions exist; this is
  the most commonly cited one. Flagged as a known variant ambiguity.
- in_sen `[1,4,2,3,2]` (C Db F G Bb) = 1 b2 4 5 b7.
- yo_scale `[2,3,2,2,3]` (C D F G A) = anhemitonic 1 2 4 5 6.
- iwato `[1,4,1,4,2]` (C Db F Gb Bb) = 1 b2 4 b5 b7 (mode of hirajoshi).

## Blues (2)
Ref: Wikipedia "Blues scale".
- blues_minor `[3,2,1,1,3,2]` = minor pentatonic + b5 (1 b3 4 b5 5 b7).
- blues_major `[2,1,1,3,2,3]` = major pentatonic + b3 (1 2 b3 3 5 6).

## Symmetric (4)
Ref: Wikipedia "Whole tone scale", "Octatonic scale", "Augmented scale".
- whole_tone `[2,2,2,2,2,2]` (6 notes).
- wh_diminished `[2,1,2,1,2,1,2,1]` (whole-half octatonic, 8 notes).
- hw_diminished `[1,2,1,2,1,2,1,2]` (half-whole octatonic, 8 notes).
- augmented `[3,1,3,1,3,1]` (hexatonic, 6 notes).

## Bebop (3)
Ref: Mark Levine, *The Jazz Theory Book* ("Bebop Scales"); Wikipedia
"Bebop scale". Each adds one chromatic passing tone to a parent mode, so
each is 8 notes summing to 12.
- bebop_dominant `[2,2,1,2,2,1,1,1]` = mixolydian + natural 7 passing
  tone (C D E F G A Bb B).
- bebop_major `[2,2,1,2,1,1,2,1]` = major + #5/b6 passing tone
  (C D E F G G# A B).
- bebop_dorian `[2,1,1,1,2,2,1,2]` = dorian + natural 3 passing tone
  between b3 and 4 (C D Eb E F G A Bb). The "bebop minor" with a passing
  tone on the b3→3 step; this is the most commonly cited Bebop Dorian.

## Deferred (not shipped this session)
melakarta (Carnatic), maqam (Arabic, many require quarter tones outside
12-TET), pelog/slendro (Indonesian), Enigmatic, Persian, Prometheus,
Tritone scale, and the four remaining harmonic-major modes. These are
either outside 12-TET, have contested interval patterns across sources, or
were scoped out by the buildplan for a later pass.
