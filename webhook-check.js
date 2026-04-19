/**
 * webhook-check.js
 *
 * Standalone diagnostic tool for checking n8n webhook availability.
 * Implements all probe strategies and logs results to the browser console.
 *
 * Usage (browser console):
 *   const url = 'https://your-n8n.com/webhook/xxxx';
 *   checkWebhook(url);
 *
 * Usage (check multiple URLs at once):
 *   checkWebhooks([url1, url2, url3]);
 *
 * Usage (run against URLs saved in localStorage by the chat app):
 *   checkSavedWebhooks();
 */

const TIMEOUT_MS = 6000;

// ── helpers ──────────────────────────────────────────────────────────────────

function mkAbortCtrl(ms) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(tid) };
}

function label(url) {
  return /test/i.test(url) ? 'TEST' : 'PROD';
}

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── individual probes ─────────────────────────────────────────────────────────

async function probeOnline() {
  return {
    method: 'navigator.onLine',
    ok: navigator.onLine,
    status: navigator.onLine ? 'Browser reports network available' : 'Browser reports offline',
    note: 'Only checks browser connectivity — not the specific endpoint',
  };
}

async function probeHead(url) {
  const a = mkAbortCtrl(TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: a.signal });
    a.cancel();
    return {
      method: 'HEAD (cors)',
      ok: res.ok,
      status: `HTTP ${res.status} ${res.statusText}`,
      note: res.ok ? 'Server responded to HEAD' : 'Server responded but with error status',
    };
  } catch (e) {
    a.cancel();
    return {
      method: 'HEAD (cors)',
      ok: false,
      status: e.name === 'AbortError' ? 'Timeout' : e.message,
      note: 'n8n webhooks typically do not support HEAD — expect CORS/405 failure here',
    };
  }
}

async function probeGetCors(url) {
  const a = mkAbortCtrl(TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: a.signal });
    a.cancel();
    let body = null;
    try { body = await res.text(); } catch { /* ignore */ }
    return {
      method: 'GET (cors)',
      ok: res.ok,
      status: `HTTP ${res.status} ${res.statusText}`,
      body: body ? body.slice(0, 200) : null,
      note: res.ok
        ? 'Server is reachable and returned a readable response'
        : 'Server responded but with an error status code',
    };
  } catch (e) {
    a.cancel();
    const isTimeout = e.name === 'AbortError';
    const isCors = e.name === 'TypeError' && !isTimeout;
    return {
      method: 'GET (cors)',
      ok: false,
      status: isTimeout ? `Timeout after ${TIMEOUT_MS / 1000}s` : e.message,
      note: isCors
        ? 'Likely CORS block — server may still be up (falling back to no-cors probe)'
        : isTimeout
          ? 'No response within timeout'
          : 'Network error',
    };
  }
}

async function probeGetNoCors(url) {
  const a = mkAbortCtrl(TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', mode: 'no-cors', signal: a.signal });
    a.cancel();
    return {
      method: 'GET (no-cors)',
      ok: true,
      status: `Opaque response (type="${res.type}", status=0 — always in no-cors mode)`,
      note: 'Fetch resolved without network error → server is reachable. Cannot read HTTP status due to CORS.',
    };
  } catch (e) {
    a.cancel();
    const isTimeout = e.name === 'AbortError';
    return {
      method: 'GET (no-cors)',
      ok: false,
      status: isTimeout ? `Timeout after ${TIMEOUT_MS / 1000}s` : e.message,
      note: isTimeout ? 'No response within timeout' : 'Server appears unreachable (DNS failure or connection refused)',
    };
  }
}

// ── strategy: run all probes, derive verdict ─────────────────────────────────

async function runAllProbes(url) {
  const results = {};

  results.online  = await probeOnline();
  results.head    = await probeHead(url);
  results.getCors = await probeGetCors(url);

  // Only run no-cors probe if cors GET failed (avoid double-hitting the server)
  if (!results.getCors.ok) {
    results.getNoCors = await probeGetNoCors(url);
  }

  return results;
}

function deriveVerdict(probes) {
  const { online, getCors, getNoCors } = probes;

  if (!online.ok)       return { icon: '🔴', text: 'OFFLINE — browser has no network' };
  if (getCors.ok)       return { icon: '🟢', text: `REACHABLE — ${getCors.status}` };
  if (getNoCors?.ok)    return { icon: '🟡', text: 'REACHABLE (CORS blocked — server is up, HTTP status unreadable)' };
  if (getNoCors && !getNoCors.ok) {
    const isTimeout = getNoCors.status.startsWith('Timeout');
    return { icon: '🔴', text: isTimeout ? 'UNREACHABLE — connection timed out' : 'UNREACHABLE — connection refused or DNS failure' };
  }
  // getCors failed without running getNoCors (shouldn't happen with current logic)
  return { icon: '🔴', text: `UNREACHABLE — ${getCors.status}` };
}

// ── console output ────────────────────────────────────────────────────────────

function printReport(url, probes, verdict) {
  const tag = label(url);
  const bar = '─'.repeat(60);

  console.group(`%c${verdict.icon} Webhook Check  [${tag}]  ${ts()}`, 'font-weight:bold;font-size:13px');
  console.log(`%cURL: %c${url}`, 'color:gray', 'color:#4fffb0;font-family:monospace');
  console.log(`%cVerdict: %c${verdict.text}`, 'color:gray', verdict.icon === '🟢' ? 'color:#4fffb0;font-weight:bold' : verdict.icon === '🟡' ? 'color:#f0a500;font-weight:bold' : 'color:#ff4f6b;font-weight:bold');
  console.log(bar);

  for (const [key, probe] of Object.entries(probes)) {
    const icon = probe.ok ? '✅' : '❌';
    console.group(`${icon}  ${probe.method}`);
    console.log('  Status :', probe.status);
    console.log('  Note   :', probe.note);
    if (probe.body != null) {
      console.log('  Body   :', probe.body);
    }
    console.groupEnd();
  }

  console.groupEnd();
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Check a single webhook URL and print a detailed console report.
 * @param {string} url
 * @returns {Promise<{verdict: object, probes: object}>}
 */
async function checkWebhook(url) {
  if (!url || !url.startsWith('http')) {
    console.error('[webhook-check] Invalid URL:', url);
    return;
  }
  const probes  = await runAllProbes(url);
  const verdict = deriveVerdict(probes);
  printReport(url, probes, verdict);
  return { verdict, probes };
}

/**
 * Check multiple webhook URLs in parallel and print individual reports.
 * @param {string[]} urls
 */
async function checkWebhooks(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    console.warn('[webhook-check] Pass an array of URLs');
    return;
  }
  console.group(`%c🔍 Checking ${urls.length} webhook(s)…`, 'font-weight:bold');
  const results = await Promise.all(urls.map(checkWebhook));
  console.groupEnd();

  // Summary table
  const rows = urls.map((url, i) => ({
    url: url.length > 60 ? url.slice(0, 57) + '…' : url,
    type: label(url),
    verdict: results[i]?.verdict?.text ?? '—',
  }));
  console.table(rows);
  return results;
}

/**
 * Read URLs stored by the chat app (localStorage key: n8n_wh_history)
 * and check each one.
 */
async function checkSavedWebhooks() {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('n8n_wh_history') || '[]');
  } catch {
    console.error('[webhook-check] Could not read n8n_wh_history from localStorage');
    return;
  }
  if (history.length === 0) {
    console.log('[webhook-check] No saved webhook URLs found in localStorage.');
    return;
  }
  const urls = history.map(e => e.url);
  console.log(`%c[webhook-check] Found ${urls.length} URL(s) in history`, 'color:#00c8ff');
  return checkWebhooks(urls);
}

// Make functions available globally when loaded via <script> tag
if (typeof window !== 'undefined') {
  window.checkWebhook      = checkWebhook;
  window.checkWebhooks     = checkWebhooks;
  window.checkSavedWebhooks = checkSavedWebhooks;
}

// ── auto-run if URL is in query string: ?check=https://... ───────────────────
(function autoRun() {
  if (typeof window === 'undefined') return;
  const param = new URLSearchParams(window.location.search).get('check');
  if (param) {
    console.log('[webhook-check] Auto-run from ?check= query param');
    checkWebhook(decodeURIComponent(param));
  }
})();


checkWebhook('https://your-n8n.com/webhook/xxxx');
