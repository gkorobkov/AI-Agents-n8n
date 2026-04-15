const items = $input.all();

const nodeSession = $('Get sessionId').first().json;
const user_message_text = nodeSession['user_message_text'];
const message_source    = nodeSession['message_source'];
const sessionId         = nodeSession['sessionId'];

const byKey = new Map();
for (const it of items) {
  const keyRaw = it.json.field_key;
  if (keyRaw == null) continue;
  const key = String(keyRaw).trim();
  if (!key) continue;
  const tsRaw = it.json.updatedAt ?? it.json.createdAt ?? null;
  const tsMs = tsRaw ? new Date(tsRaw).getTime() : 0;
  const prev = byKey.get(key);
  if (!prev || tsMs > prev.updatedAtMs) {
    byKey.set(key, {
      value: it.json.field_value ?? "",
      updatedAtMs: Number.isFinite(tsMs) ? tsMs : 0,
    });
  }
}

const chat_history = {};
for (const [key, rec] of byKey.entries()) {
  chat_history[key] = String(rec.value ?? "");
}

const ts_start_ms = Date.now();
const trace_id = `trc_${ts_start_ms}_${Math.floor(Math.random() * 100000)}`;
const ts = new Date(ts_start_ms).toISOString();

return [{ json: { 
  chat_history, 
  sessionId : sessionId, 
  user_message_text,
  message_source,
  trace_id, ts, ts_start_ms } }];