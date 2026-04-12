const DEBUG_ENABLED = true;
const TELEGRAM_SOFT_LIMIT = 3500;
const DEBUG_JSON_MAX_LEN = 1800;
const DEBUG_JSON_MID_LEN = 1200;
const DEBUG_JSON_MIN_LEN = 700;

// ─── HTML utils ───────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeTelegramHtml(input) {
  const allowedTags = [];
  const protected_ = String(input ?? "").replace(/<\/?(b|i|u|code|pre)>/gi, (m) => {
    allowedTags.push(m.toLowerCase());
    return `___TG_${allowedTags.length - 1}___`;
  });
  let out = escHtml(protected_);
  allowedTags.forEach((tag, i) => { out = out.replace(`___TG_${i}___`, tag); });
  return out;
}

function safeStringify(v) {
  try { return JSON.stringify(v, null, 2); }
  catch (e) { return `[stringify_error] ${e}\n\n${v}`; }
}

function shortenText(text, maxLen, suffix = "\n... [truncated]") {
  const s = String(text ?? "");
  if (!maxLen || s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
}

function withFormat(title, value, maxLen = 0) {
  const text = typeof value === "string" ? value : safeStringify(value);
  const shortened = maxLen > 0 ? shortenText(text, maxLen) : text;
  const titlePart = title ? `<b>${escHtml(title)}</b>\n` : "";
  return `${titlePart}<code>${escHtml(shortened)}</code>`;
}

// ─── JSON utils ───────────────────────────────────────────────────────────────

function parseJsonMaybe(value) {
  if (value == null || typeof value !== "string") return value ?? null;
  try { return JSON.parse(value.trim()); } catch { return null; }
}

// ─── Intermediate steps ───────────────────────────────────────────────────────

function getToolArgs(step) {
  const fromLog = step?.action?.messageLog?.[0]?.kwargs?.tool_calls?.[0]?.args;
  return (fromLog && typeof fromLog === "object") ? fromLog
       : (step?.action?.toolInput && typeof step.action.toolInput === "object") ? step.action.toolInput
       : {};
}

function summarizeObservation(step) {
  const parsed = parseJsonMaybe(step?.observation);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!item || typeof item !== "object") {
    return shortenText(String(step?.observation ?? ""), 120, "...");
  }
  if (item.field_key != null) return `saved ${item.field_key}=${item.field_value ?? ""}`;

  const b = item.body;
  if (b && typeof b === "object") {
    if (Array.isArray(b.results) && b.results[0]) {
      const c = b.results[0];
      return `city=${c.name ?? ""}; lat=${c.latitude ?? ""}; lon=${c.longitude ?? ""}`;
    }
    if (b.type === "settlement") {
      return `settlement=${b.title ?? ""}; code=${b.code ?? ""}; lat=${b.lat ?? ""}; lng=${b.lng ?? ""}`;
    }
    if (b.search && Array.isArray(b.segments)) {
      return `route=${b.search?.from?.title ?? ""}->${b.search?.to?.title ?? ""}; date=${b.search?.date ?? ""}; trains=${b.segments.length}; first_train=${b.segments[0]?.thread?.number ?? ""}`;
    }
    if (Array.isArray(b.data) && b.data[0]) {
      const prices = b.data.map((d) => Number(d?.price)).filter(Number.isFinite);
      const f = b.data[0];
      return `route=${f.origin ?? ""}->${f.destination ?? ""}; date=${String(f.departure_at ?? "").slice(0, 10)}; flights=${b.data.length}; min_price=${prices.length ? Math.min(...prices) : ""}`;
    }
  }
  return shortenText(safeStringify(item), 120, "...");
}

function buildStepsSummary(steps) {
  if (!steps.length) return "No intermediate steps";
  const seen = new Set();
  const lines = [];
  for (const step of steps) {
    const tool = String(step?.action?.tool ?? "Unknown Tool").trim();
    const args = getToolArgs(step);
    const result = summarizeObservation(step);
    const key = `${tool}|${JSON.stringify({ ...args, id: undefined })}|${result}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${lines.length + 1}. tool=${tool} | args=${JSON.stringify(args)} | result=${result}`);
  }
  return lines.join("\n");
}

// ─── Parse model output ───────────────────────────────────────────────────────

const raw = String($json.output ?? "").trim();
let obj = null, parse_error = "", schema_warning = "", reply_html = "", agent_logic = "", body = "", response_type = "text";

if (!raw) {
  response_type = "empty";
  body = "<b>Ошибка</b>\n\nПустой ответ от модели.";
} else {
  const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
  const jsonText = first !== -1 && last > first ? raw.slice(first, last + 1) : "";

  if (!jsonText) {
    response_type = "text";
    body = sanitizeTelegramHtml(raw);
  } else {
    try {
      obj = JSON.parse(jsonText);
      response_type = "json";
      reply_html = String(obj.reply_html ?? "").trim();
      body = reply_html ? sanitizeTelegramHtml(reply_html) : (schema_warning = "reply_html_empty", sanitizeTelegramHtml(raw));
      agent_logic = sanitizeTelegramHtml(String(obj.agent_logic ?? "").trim());
    } catch (e) {
      response_type = "json_parse_failed";
      parse_error = String(e);
      body = sanitizeTelegramHtml(raw);
    }
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

const chatMemory = $('Get sessionId').first().json;
const now = Date.now();
const latency_ms = Math.max(0, now - Number(chatMemory.ts_start_ms || now));
const intermediateSteps = (() => { const p = parseJsonMaybe($json.intermediateSteps); return Array.isArray(p) ? p : []; })();
const intermediate_steps_summary = buildStepsSummary(intermediateSteps);
const success = response_type === "json" && !parse_error && Boolean(reply_html);

// ─── Build output with cascading size limits ──────────────────────────────────

function buildOutput(maxLen = 0, includeAgentLogic = true) {
  if (!DEBUG_ENABLED) return body;
  const blocks = [body];
  if (parse_error)    blocks.push(withFormat("[debug] parse_error", parse_error));
  if (schema_warning) blocks.push(withFormat("[debug] schema_warning", schema_warning));
  if (includeAgentLogic) {
    blocks.push(withFormat("Agent Logic", agent_logic, maxLen));
    blocks.push(withFormat("Tools used", intermediate_steps_summary, maxLen));
  }
  return blocks.filter(Boolean).join("\n\n");
}

const candidates = [
  [DEBUG_JSON_MAX_LEN, true],
  [DEBUG_JSON_MID_LEN, true],
  [DEBUG_JSON_MIN_LEN, true],
  [0, false],
  null,
];

const output_clean = candidates.reduce((acc, p) =>
  acc.length <= TELEGRAM_SOFT_LIMIT ? acc : (p ? buildOutput(...p) : body),
  buildOutput(DEBUG_JSON_MAX_LEN, true)
);

// ─── Return ───────────────────────────────────────────────────────────────────

return [{
  ...$json,
  user_message_text: chatMemory.user_message_text,
  sessionId: chatMemory.sessionId,
  output_short: shortenText(output_clean, 300),
  output_clean,
  latency_ms,
  intermediate_steps_summary,
  success,
  agent_logic,
  parsed_object: obj,
  parse_error,
  schema_warning,
  response_type,
}];