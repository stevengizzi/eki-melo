/* =================================================================
   VERIFY-LLM-CALL — exit-criterion check for the shared LLM transport
   (js/jingle/pipeline/llm-call.js). RUNS FULLY OFFLINE — globalThis.fetch is
   stubbed, so no network and no real backoff waits (the test passes a 1ms base
   delay).

   It confirms postMessages:
     a. returns the reply text on a first-try 200 (one fetch).
     b. retries a transient 529 (overloaded) and succeeds when a later try is 200.
     c. does NOT retry a non-retryable status (413 too large) — throws at once.
     d. gives up after maxAttempts on a persistent 529, throwing with the status.
     e. retries a network-level throw, then succeeds.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts:
     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-llm-call.mjs
     rm js/jingle/package.json
   ================================================================= */
import { postMessages } from '../pipeline/llm-call.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);

const realFetch = globalThis.fetch;
let calls = 0;
// `script` is a list of step descriptors consumed one per fetch call:
//   { ok:true, text } | { status } (error) | { throwNetwork:true }
let script = [];
function installFetch(steps) {
  calls = 0;
  script = [...steps];
  globalThis.fetch = async () => {
    calls += 1;
    const step = script.shift() ?? { status: 500 };
    if (step.throwNetwork) throw new Error('simulated connection reset');
    if (step.ok) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: step.text ?? '' }] }),
      };
    }
    return {
      ok: false,
      status: step.status,
      text: async () => `{"error":"status ${step.status}"}`,
    };
  };
}

const BODY = { model: 'claude-sonnet-4-20250514', max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'hi' }] };
const FAST = { baseDelayMs: 1, maxAttempts: 4 };

// a. first-try success
installFetch([{ ok: true, text: 'ALPHA' }]);
try {
  const out = await postMessages(BODY, 'Test', FAST);
  if (out !== 'ALPHA') fail('a:success', `expected "ALPHA", got ${JSON.stringify(out)}`);
  if (calls !== 1) fail('a:success', `expected 1 fetch, got ${calls}`);
} catch (e) {
  fail('a:success', `unexpected throw: ${e.message}`);
}

// b. retry a transient 529, then succeed
installFetch([{ status: 529 }, { status: 529 }, { ok: true, text: 'BETA' }]);
try {
  const out = await postMessages(BODY, 'Test', FAST);
  if (out !== 'BETA') fail('b:retry-529', `expected "BETA", got ${JSON.stringify(out)}`);
  if (calls !== 3) fail('b:retry-529', `expected 3 fetches (2 retries), got ${calls}`);
} catch (e) {
  fail('b:retry-529', `unexpected throw: ${e.message}`);
}

// c. 413 is NOT retried — throws immediately after one call
installFetch([{ status: 413 }, { ok: true, text: 'SHOULD_NOT_REACH' }]);
try {
  await postMessages(BODY, 'Test', FAST);
  fail('c:no-retry-413', 'expected a throw on 413, but it resolved');
} catch (e) {
  if (calls !== 1) fail('c:no-retry-413', `expected 1 fetch (no retry), got ${calls}`);
  if (!e.message.includes('413')) fail('c:no-retry-413', `expected the error to mention 413: ${e.message}`);
}

// d. persistent 529 → gives up after maxAttempts
installFetch([{ status: 529 }, { status: 529 }, { status: 529 }, { status: 529 }, { status: 529 }]);
try {
  await postMessages(BODY, 'Test', FAST);
  fail('d:exhaust-529', 'expected a throw after exhausting retries, but it resolved');
} catch (e) {
  if (calls !== 4) fail('d:exhaust-529', `expected 4 fetches (maxAttempts), got ${calls}`);
  if (!e.message.includes('529')) fail('d:exhaust-529', `expected the error to mention 529: ${e.message}`);
  if (!e.message.toLowerCase().includes('attempt')) fail('d:exhaust-529', `expected the error to note the attempts: ${e.message}`);
}

// e. retry a network-level throw, then succeed
installFetch([{ throwNetwork: true }, { ok: true, text: 'GAMMA' }]);
try {
  const out = await postMessages(BODY, 'Test', FAST);
  if (out !== 'GAMMA') fail('e:retry-network', `expected "GAMMA", got ${JSON.stringify(out)}`);
  if (calls !== 2) fail('e:retry-network', `expected 2 fetches, got ${calls}`);
} catch (e) {
  fail('e:retry-network', `unexpected throw: ${e.message}`);
}

globalThis.fetch = realFetch;

if (failures.length > 0) {
  console.error(`verify-llm-call FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-llm-call PASSED — postMessages returns text on success, retries transient 529 / network errors with '
    + 'backoff, does NOT retry a non-retryable 413, and gives up after maxAttempts on a persistent overload.'
);
