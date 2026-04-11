const items = $input.all();
const sessionId = $json.sessionId; 

let user_message_text = '';
try { user_message_text = $('Set session key TG').first().json.user_message_text; } catch(e) {}
if (!user_message_text) {
  try { user_message_text = $('Set session key WH').first().json.user_message_text; } catch(e) {}
}

let message_source = '';
try { message_source = $('Set session key TG').first().json.message_source; } catch(e) {}
if (!message_source) {
  try { message_source = $('Set session key WH').first().json.message_source; } catch(e) {}
}

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
return [
  {
    json: {
      chat_history,
      sessionId,
      message_source,
      user_message_text,
      trace_id,
      ts,
      ts_start_ms,
    },
  },
];