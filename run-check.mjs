// Node.js 18+ runner for webhook-check.js
// Usage: node run-check.mjs <url> [url2] [url3]

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Polyfills — use defineProperty because navigator is a read-only getter in Node 22
for (const [key, val] of [
  ['navigator',   { onLine: true }],
  ['localStorage', { getItem: () => null }],
  ['window',      undefined],
]) {
  Object.defineProperty(globalThis, key, { value: val, writable: true, configurable: true });
}

const __dir = dirname(fileURLToPath(import.meta.url));

// Find webhook-check.js: same dir or frontend/ subfolder
const candidates = [
  join(__dir, 'webhook-check.js'),
  join(__dir, 'frontend', 'webhook-check.js'),
];
const scriptPath = candidates.find(existsSync);
if (!scriptPath) {
  console.error('Cannot find webhook-check.js in', candidates);
  process.exit(1);
}

const code = readFileSync(scriptPath, 'utf8');

// Strip browser-only blocks (window registration + autoRun IIFE)
const patched = code
  .replace(/if \(typeof window !== 'undefined'\) \{[\s\S]*?\n\}/m, '')
  .replace(/\/\/ ── auto-run[\s\S]*?\}\)\(\);/m, '');

const { checkWebhook, checkWebhooks } = new Function(
  'navigator', 'localStorage',
  patched + '\nreturn { checkWebhook, checkWebhooks };'
)(globalThis.navigator, globalThis.localStorage);

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.log('Usage: node run-check.mjs <url> [url2] ...');
  process.exit(1);
}

await (urls.length === 1 ? checkWebhook(urls[0]) : checkWebhooks(urls));
