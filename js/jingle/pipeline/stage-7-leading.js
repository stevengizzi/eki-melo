/* =================================================================
   STAGE 7 — VOICE-LEADING PASS (identity stub, buildplan Session 4).

   *** PLACEHOLDER. Implemented in Session 7. ***

   The real Stage 7 will scan VoiceTracks against a configurable voice-leading
   rule set (theory/voice-leading-rules.js — `chiptune_idiomatic` and
   `cpp_strict` presets) and apply repair operations: octave displacement for
   range violations, pitch substitution for parallel perfects (cpp_strict),
   snap-to-mode for out-of-mode accidentals unless anomaly-flagged. For now it
   returns its input unchanged so the runner can thread all stages end-to-end.
   ================================================================= */

/**
 * Identity pass — returns VoiceTracks unchanged. `config` is accepted for
 * signature stability with the Session-7 implementation.
 */
export function applyVoiceLeading(voiceTracks /* , config */) {
  // TODO(Session 7): scan and repair per voice_leading_strictness.
  return voiceTracks;
}
