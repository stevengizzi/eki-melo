/* =================================================================
   LLM CALL — the shared Anthropic Messages POST for the LLM stages (Stage 4
   motifs, Stage 5a phrase, Stage 5b texture, and Stage 3 harmony when it lands).

   Each stage used to carry its own near-identical fetch + error-handling copy.
   They now delegate here so the ONE transport concern they all share — surviving
   a transient overload / rate-limit / 5xx blip — is fixed in one place. This
   matters specifically because the fully-LLM path makes THREE (soon four)
   sequential calls per run, so a single transient 529 on any one of them would
   otherwise abort the whole generation.

     postMessages({ model, max_tokens, system, messages }, stageLabel?, options?)
       → the concatenated text content of the model's reply

   RETRY POLICY. A retryable response (429 / 500 / 502 / 503 / 504 / 529) or a
   network failure is retried up to `maxAttempts` times with exponential backoff
   + jitter. A non-retryable error (400 bad request, 413 too large, 422, …) throws
   immediately — those will not fix themselves. This transport retry is SEPARATE
   from each stage's validate-then-retry-once loop (which re-prompts on a
   well-formed-but-invalid response); the two compose.

   PORTABILITY. pipeline/ code — imports only js/env.js (for API_ENDPOINT, which
   resolves to the deployed /api/generate proxy or the artifact-runtime direct
   path). It does NOT touch api.js.
   ================================================================= */
import { API_ENDPOINT } from '../../env.js';

// Transient upstream conditions worth retrying. 529 is Anthropic's "overloaded";
// 429 is rate-limit; 5xx are gateway/server blips. Everything else (400/413/422/
// 401/403) is a request problem the same call will keep hitting, so we don't retry.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const DEFAULT_MAX_ATTEMPTS = 4; // 1 initial try + 3 retries
const DEFAULT_BASE_DELAY_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff with jitter: ~800, ~1600, ~3200 ms (+ up to 300ms jitter).
function backoffDelay(attempt, baseDelayMs) {
  return baseDelayMs * 2 ** (attempt - 1) + Math.random() * 300;
}

// Pull the text out of an Anthropic Messages success body.
function textFromMessagesResponse(data) {
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('')
    .trim();
}

/**
 * POST an Anthropic Messages request body through API_ENDPOINT, retrying
 * transient failures with backoff. Returns the reply's text content. Throws on a
 * non-retryable error, or after the final attempt on a retryable one.
 *
 * `stageLabel` ("Stage 4", …) prefixes error messages. `options` may override
 * `{ maxAttempts, baseDelayMs }` (the verifier passes tiny delays so the retry
 * path can be exercised without real waits).
 */
export async function postMessages({ model, max_tokens, system, messages }, stageLabel = 'LLM', options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const requestBody = JSON.stringify({ model, max_tokens, system, messages });

  let lastDetail = 'unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });
    } catch (networkError) {
      // A network-level failure (DNS, connection reset) is transient — retry.
      lastDetail = `network error: ${networkError && networkError.message ? networkError.message : 'unknown'}`;
      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt, baseDelayMs));
        continue;
      }
      throw new Error(`${stageLabel} LLM call failed after ${maxAttempts} attempts: ${lastDetail}`);
    }

    if (response.ok) {
      const data = await response.json();
      return textFromMessagesResponse(data);
    }

    const errText = await response.text().catch(() => '');
    lastDetail = `API ${response.status}: ${errText.slice(0, 160)}`;
    if (RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts) {
      await sleep(backoffDelay(attempt, baseDelayMs));
      continue;
    }
    // Non-retryable status, or the retryable one exhausted its attempts.
    const suffix = RETRYABLE_STATUSES.has(response.status) ? ` (after ${maxAttempts} attempts)` : '';
    throw new Error(`${stageLabel} LLM call failed${suffix}: ${lastDetail}`);
  }

  // Unreachable (the loop always returns or throws), but keeps the type honest.
  throw new Error(`${stageLabel} LLM call failed: ${lastDetail}`);
}
