/* =================================================================
   STAGE 8 — CADENCE ENFORCEMENT (identity stub, buildplan Session 4).

   *** PLACEHOLDER. Implemented in Session 5. ***

   The real Stage 8 will walk the HarmonicPlan's per-section cadence types and
   overwrite the final 1–2 beats of lead, harmony, and bass with the output of
   the matching cadence formula (theory/cadence-formulas.js — PAC, IAC, half,
   deceptive, plagal, modal_iv_i, phrygian_ii_i). Cadence enforcement is
   non-negotiable and ignores whatever the upstream stages produced for those
   beats. For now it returns its input unchanged so the runner can thread all
   stages end-to-end.
   ================================================================= */

/**
 * Identity pass — returns VoiceTracks unchanged. `harmonicPlan` / `macroParams`
 * are accepted for signature stability with the Session-5 implementation.
 */
export function enforceCadences(voiceTracks /* , harmonicPlan, macroParams */) {
  // TODO(Session 5): overwrite each section's final beats per its cadence type.
  return voiceTracks;
}
