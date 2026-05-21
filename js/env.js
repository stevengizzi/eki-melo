/* =================================================================
   ENVIRONMENT ADAPTER — same code runs in Claude.ai artifact OR browser

   The Claude.ai artifact runtime provides:
     - window.storage     (async per-user KV store)
     - automatic API key injection on calls to api.anthropic.com

   A regular browser (deployed via Cloudflare Pages) provides:
     - localStorage       (sync per-origin storage)
     - a serverless proxy at /api/generate (key held server-side)

   Feature-detecting on window.storage picks the right backend for both.
   ================================================================= */
export const IS_ARTIFACT = (typeof window !== 'undefined') && (typeof window.storage !== 'undefined') && (window.storage !== null);

export const API_ENDPOINT = IS_ARTIFACT
  ? "https://api.anthropic.com/v1/messages"
  : "/api/generate";

// Avatars (v4) require the /api/avatar Pages Function — it holds the PixelLab
// key and orchestrates the Claude→PixelLab calls server-side. The Claude.ai
// artifact runtime has no Pages Function and can't reach PixelLab, so avatars
// are unavailable there. Gated on the same IS_ARTIFACT signal the rest of the
// app uses (more reliable than sniffing window.location.hostname, since the
// artifact iframe is not served from a claude.ai host).
export const AVATAR_ENDPOINT = IS_ARTIFACT ? null : "/api/avatar";

export const storageBackend = IS_ARTIFACT
  ? {
      async get(key) {
        try {
          const r = await window.storage.get(key);
          return (r && r.value) ? r.value : null;
        } catch (e) { return null; }
      },
      async set(key, value) {
        await window.storage.set(key, value);
      }
    }
  : {
      async get(key) {
        try { return localStorage.getItem(key); }
        catch (e) { return null; }
      },
      async set(key, value) {
        try { localStorage.setItem(key, value); }
        catch (e) { console.error('localStorage.setItem failed', e); }
      }
    };
