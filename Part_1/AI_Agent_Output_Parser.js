const DEBUG_ENABLED = true;
const TELEGRAM_SOFT_LIMIT = 3500;
const DEBUG_JSON_MAX_LEN = 1800;
const DEBUG_JSON_MID_LEN = 1200;
const DEBUG_JSON_MIN_LEN = 700;

// ─── Debug section order ───────────────────────────────────────────────────────
// Remove or reorder entries to control what appears and in what order.
// Available: "agent_logic" | "tools_used" | "chat_history" | "latency" | "errors"
const DEBUG_SECTIONS_ORDER = [
  "chat_history",
  "tools_used",
  "agent_logic",
  "latency",
];

// ─── HTML utils ───────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeTelegramHtml(input) {
  const allowedTags = [];
  const protected_ = String(input ?? "").replace(/<\/?(b|i|u|code|pre)>|<a\b[^>]*>|<\/a>/gi, (m) => {
    allowedTags.push(m);
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

function buildStepsSummary(steps) {
  if (!steps.length) return "No intermediate steps";
  const seen = new Set();
  const lines = [];
  for (const step of steps) {
    const callId = step?.action?.toolCallId || '';
    const key = callId || `step_${lines.length}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const toolCall = step?.action?.messageLog?.[0]?.kwargs?.tool_calls?.[0];
    const toolName = toolCall?.name || step?.action?.tool || "Unknown Tool";
    const args = Object.fromEntries(
      Object.entries(toolCall?.args || {}).filter(([k]) => k !== "id")
    );
    lines.push(`${lines.length + 1}. tool=${toolName} | args=${JSON.stringify(args)}`);
  }
  return lines.join("\n");
}

// ─── Parse model output ───────────────────────────────────────────────────────

const raw = String($json.output ?? "").trim();
const agentError = $json.error ? String($json.error).trim() : null;
let obj = null, parse_error = "", schema_warning = "", reply_html = "", agent_logic = "", body = "", response_type = "text";

if (agentError) {
  response_type = "agent_error";
  body = sanitizeTelegramHtml(agentError);
} else if (!raw) {
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
const chatHistory = $('JSON Chat Memory').first().json.chat_history || {};
const success = response_type === "json" && !parse_error && Boolean(reply_html);
const is_agent_error = response_type === "agent_error";

const isWebhook = String(chatMemory.message_source ?? $json.message_source ?? "").toUpperCase() === "WH";

// ─── Build functions ──────────────────────────────────────────────────────────

function withDebugFormat(title, value, maxLen = 0) {
  const text = typeof value === "string" ? value : safeStringify(value);
  const shortened = maxLen > 0 ? shortenText(text, maxLen) : text;
  const titlePart = title ? `<b>${escHtml(title)}</b>\n` : "";
  return `${titlePart}<code>${escHtml(shortened)}</code>`;
}

// Debug-only section (без body) — используется для full_debug (WH) и inline TG
function buildDebugSection(maxLen = 0, forTg = false) {
  if (!DEBUG_ENABLED) return "";
  const noInfoTag = (text) => `<code>${text}</code>`;
  const blocks = [];

  if (parse_error)    blocks.push(withDebugFormat("[debug] parse_error", parse_error));
  if (schema_warning) blocks.push(withDebugFormat("[debug] schema_warning", schema_warning));

  for (const section of DEBUG_SECTIONS_ORDER) {
    if (section === "agent_logic") {
      blocks.push(withDebugFormat("Agent Logic", agent_logic, maxLen));

    } else if (section === "tools_used") {
      if (intermediateSteps.length > 0) {
        const stepsText = maxLen > 0 ? shortenText(intermediate_steps_summary, maxLen) : intermediate_steps_summary;
        blocks.push(`<b>Tools used</b>\n<code>${escHtml(stepsText)}</code>`);
      } else {
        blocks.push(`<b>Tools used</b>\n${noInfoTag("No intermediate steps")}`);
      }

    } else if (section === "chat_history") {
      if (Object.keys(chatHistory).length > 0) {
        blocks.push(withDebugFormat("Chat History for Agent", chatHistory, maxLen));
      } else {
        blocks.push(`<b>Chat History for Agent</b>\n${noInfoTag("No chat history")}`);
      }

    } else if (section === "latency") {
      const latencyStr = latency_ms < 1000
        ? `${latency_ms} ms`
        : `${(latency_ms / 1000).toFixed(1)} s`;
      blocks.push(`<b>Latency</b>\n<code>${latencyStr}</code>`);
    }
  }

  return blocks.filter(Boolean).join("\n\n");
}

// TG: body + debug inline, с каскадным сокращением
function buildTgOutput(maxLen = 0, includeDebug = true) {
  if (!includeDebug || !DEBUG_ENABLED) return body;
  return [body, buildDebugSection(maxLen, true)].filter(Boolean).join("\n\n");
}

// ─── Compute outputs ──────────────────────────────────────────────────────────

let output_clean, full_debug;

if (is_agent_error) {
  output_clean = "";
  full_debug = "";
} else if (isWebhook) {
  // WH: output_clean = только ответ модели; full_debug = отдельный debug-блок
  output_clean = body;
  full_debug = buildDebugSection(0, false);
} else {
  // TG: output_clean = body + debug inline, каскадное сокращение
  const candidates = [
    [DEBUG_JSON_MAX_LEN, true],
    [DEBUG_JSON_MID_LEN, true],
    [DEBUG_JSON_MIN_LEN, true],
    [0, false],
    null,
  ];
  output_clean = candidates.reduce((acc, p) =>
    acc.length <= TELEGRAM_SOFT_LIMIT ? acc : (p ? buildTgOutput(...p) : body),
    buildTgOutput(DEBUG_JSON_MAX_LEN, true)
  );
  full_debug = "";
}

// ─── Return ───────────────────────────────────────────────────────────────────

const output_short = shortenText(output_clean, 300);

return [{
  json: {
    ...$json,
    user_message_text: chatMemory.user_message_text,
    sessionId: chatMemory.sessionId,
    output_short,
    output_clean,
    full_debug,
    latency_ms,
    intermediate_steps_summary,
    chat_history: chatHistory,
    is_agent_error,
    success,
    agent_logic,
    parsed_object: obj,
    parse_error,
    schema_warning,
    response_type,
  }
}];
