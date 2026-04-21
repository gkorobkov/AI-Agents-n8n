// Webhook checker — node run-check.mjs <url> [url2] ...
// Strategy: GET request only — no token spending.
// A registered n8n webhook returns exactly:
//   {"code":404,"message":"This webhook is not registered for GET requests..."}
// That specific response = webhook is active = GREEN.

const TIMEOUT_MS = 12000;
const N8N_GET_MARKER = 'This webhook is not registered for GET requests';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.log('Usage: node run-check.mjs <url> [url2] ...');
  process.exit(1);
}

async function fetchWithTimeout(url, opts, ms = TIMEOUT_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function isN8nGetMarker(json) {
  return json?.code === 404 && typeof json?.message === 'string'
    && json.message.includes('not registered for GET requests');
}

async function checkUrl(url) {
  console.log('\n' + '─'.repeat(70));
  console.log(`URL: ${url}`);
  console.log('─'.repeat(70));

  // ── OPTIONS (same logic as browser) ──
  process.stdout.write('OPTIONS → ');
  try {
    const r = await fetchWithTimeout(url, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST' },
    });
    if (r.status === 204) {
      console.log(`✅ ACTIVE  (204 — webhook registered)`);
    } else {
      console.log(`⚠️  ${r.status} ${r.statusText}`);
    }
  } catch(e) {
    console.log(`❌ ${e.name === 'AbortError' ? 'Timeout' : e.message}`);
  }

  // ── GET (detailed n8n status) ──
  process.stdout.write('GET     → ');
  try {
    const r = await fetchWithTimeout(url, { method: 'GET' });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (isN8nGetMarker(json)) {
      console.log(`✅ ACTIVE  (${r.status} — POST only, no tokens spent)`);
    } else if (r.ok) {
      console.log(`✅ ${r.status} ${r.statusText}  (${text.length} bytes)`);
      if (json?.text) console.log(`   text: ${String(json.text).slice(0, 200)}`);
    } else {
      console.log(`❌ ${r.status} ${r.statusText}`);
      if (json?.message) console.log(`   message: ${json.message}`);
      if (json?.hint)    console.log(`   hint:    ${json.hint}`);
    }
  } catch(e) {
    console.log(`❌ ${e.name === 'AbortError' ? 'Timeout' : e.message}`);
  }
}

for (const url of urls) {
  await checkUrl(url);
}
console.log('\n' + '─'.repeat(70));
