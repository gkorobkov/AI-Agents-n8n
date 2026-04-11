const DEBUG_ENABLED = true;

const DEBUG_FORMAT_CODE = "code"; 
const DEBUG_FORMAT_PRE = "pre"; 
const DEBUG_FORMAT_QUOTE = "quote"; 

const TELEGRAM_SOFT_LIMIT = 3500;
const DEBUG_JSON_MAX_LEN = 1800;
const DEBUG_JSON_MID_LEN = 1200;
const DEBUG_JSON_MIN_LEN = 700;


const raw = String($json.output ?? "").trim();

let obj = null;
let parse_error = "";
let schema_warning = "";
let reply_html = "";
let agent_logic = "";
let body = "";
let response_type = "text";

const first = raw.indexOf("{");
const last = raw.lastIndexOf("}");
const hasJsonCandidate = first !== -1 && last !== -1 && last > first;

const jsonText = hasJsonCandidate ? raw.slice(first, last + 1) : "";

function escHtml(s) {
 return String(s)
 .replace(/&/g, "&amp;")
 .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;");
}

function sanitizeTelegramHtml(input) {
 const s = String(input ?? "");
 const allowedTags = [];

 const protectedText = s.replace(/<\/?(b|i|u|code|pre)>/gi, (match) => {
 const token = `___TG_HTML_TAG_${allowedTags.length}___`;
 allowedTags.push(match.toLowerCase());
 return token;
 });

 let escaped = escHtml(protectedText);

 allowedTags.forEach((tag, index) => {
 const token = `___TG_HTML_TAG_${index}___`;
 escaped = escaped.replace(token, tag);
 });

 return escaped;
}

function safeStringify(value) {
 try {
 return JSON.stringify(value, null, 2);
 } catch (e) {
 return `[stringify_error] ${String(e)}\n\n${String(value)}`;
 }
}

function normalizeFormat(format) {
 const f = String(format || "pre").toLowerCase();

 if (f === "code") return "code";
 if (f === "pre") return "pre";

 if (f === "quote") return "pre";

 return "pre";
}

function shortenText(text, maxLen, suffix = "\n... [truncated]") {
 const s = String(text ?? "");
 if (!maxLen || s.length <= maxLen) return s;
 if (maxLen <= suffix.length) return s.slice(0, maxLen);
 return s.slice(0, maxLen - suffix.length) + suffix;
}

function withFormat(title, value, format = "pre", maxLen = 0) {
 const tag = normalizeFormat(format);
 const text = typeof value === "string" ? value : safeStringify(value);
 const shortened = maxLen > 0 ? shortenText(text, maxLen) : text;
 const escaped = escHtml(shortened);
 const titlePart = title ? `<b>${escHtml(title)}</b>\n` : "";
 return `${titlePart}<${tag}>${escaped}</${tag}>`;
}

function joinParts(parts) {
 return parts.filter(Boolean).join("\n\n");
}

function parseJsonMaybe(value) {
 if (value == null) return null;
 if (typeof value !== "string") return value;

 const text = value.trim();
 if (!text) return null;

 try {
 return JSON.parse(text);
 } catch (e) {
 return null;
 }
}

function getIntermediateStepsRaw() {
 return $json.intermediateSteps;
}

function getIntermediateSteps() {
 const rawSteps = getIntermediateStepsRaw();
 const parsedSteps = parseJsonMaybe(rawSteps);
 return Array.isArray(parsedSteps) ? parsedSteps : [];
}

function getToolArgs(step) {
 const toolCallArgs =
 step?.action?.messageLog?.[0]?.kwargs?.tool_calls?.[0]?.args;

 if (toolCallArgs && typeof toolCallArgs === "object") {
 return toolCallArgs;
 }

 if (step?.action?.toolInput && typeof step.action.toolInput === "object") {
 return step.action.toolInput;
 }

 return {};
}

function withoutId(args) {
 const nextArgs = { ...(args || {}) };
 delete nextArgs.id;
 return nextArgs;
}

function getRawToolName(step) {
 const rawTool = String(step?.action?.tool ?? "").trim();
 if (!rawTool) return "Unknown Tool";
 return rawTool;
}

function summarizeObservation(step) {
 const parsedObservation = parseJsonMaybe(step?.observation);
 const observationItem = Array.isArray(parsedObservation)
 ? parsedObservation[0]
 : parsedObservation;

 if (!observationItem || typeof observationItem !== "object") {
 return shortenText(String(step?.observation ?? ""), 120, "...");
 }

 if (observationItem.field_key != null) {
 return `saved ${observationItem.field_key}=${observationItem.field_value ?? ""}`;
 }

 const obsBody = observationItem.body;

 if (obsBody && typeof obsBody === "object") {
 if (Array.isArray(obsBody.results) && obsBody.results[0]) {
 const city = obsBody.results[0];
 return [
 `city=${city.name ?? ""}`,
 `lat=${city.latitude ?? ""}`,
 `lon=${city.longitude ?? ""}`,
 ].join("; ");
 }

 if (obsBody.type === "settlement") {
 return [
 `settlement=${obsBody.title ?? ""}`,
 `code=${obsBody.code ?? ""}`,
 `lat=${obsBody.lat ?? ""}`,
 `lng=${obsBody.lng ?? ""}`,
 ].join("; ");
 }

 if (obsBody.search && Array.isArray(obsBody.segments)) {
 return [
 `route=${obsBody.search?.from?.title ?? ""}->${obsBody.search?.to?.title ?? ""}`,
 `date=${obsBody.search?.date ?? ""}`,
 `trains=${obsBody.segments.length}`,
 `first_train=${obsBody.segments[0]?.thread?.number ?? ""}`,
 ].join("; ");
 }

 if (Array.isArray(obsBody.data) && obsBody.data[0]) {
 const minPrice = Math.min(
 ...obsBody.data
 .map((item) => Number(item?.price))
 .filter((value) => Number.isFinite(value))
 );
 const firstFlight = obsBody.data[0];
 return [
 `route=${firstFlight.origin ?? ""}->${firstFlight.destination ?? ""}`,
 `date=${String(firstFlight.departure_at ?? "").slice(0, 10)}`,
 `flights=${obsBody.data.length}`,
 `min_price=${Number.isFinite(minPrice) ? minPrice : ""}`,
 ].join("; ");
 }
 }

 return shortenText(safeStringify(observationItem), 120, "...");
}

function buildIntermediateStepsSummary(stepList) {
 if (!stepList.length) {
 return "No intermediate steps";
 }

 const lines = [];
 const seen = new Set();

 stepList.forEach((step) => {
 const tool = getRawToolName(step);
 const args = getToolArgs(step) || {};
 const argsText = JSON.stringify(args);
 const resultText = summarizeObservation(step);
 const lineKey = `${tool}|${JSON.stringify(withoutId(args))}|${resultText}`;

 if (seen.has(lineKey)) return;

 seen.add(lineKey);
 lines.push(
 `${lines.length + 1}. tool=${tool} | args=${argsText} | result=${resultText}`
 );
 });

 return lines.join("\n");
}

if (!raw) {
 response_type = "empty";
 body = "<b>Ошибка</b>\n\nПустой ответ от модели.";
} else if (!hasJsonCandidate) {
 response_type = "text";
 body = sanitizeTelegramHtml(raw);
} else {
 try {
 obj = JSON.parse(jsonText);
 response_type = "json";

 reply_html = String(obj.reply_html ?? "").trim();

 if (reply_html) {
 body = sanitizeTelegramHtml(reply_html);
 } else {
 schema_warning = "reply_html_empty";
 body = sanitizeTelegramHtml(raw);
 }

 agent_logic = String(obj.agent_logic ?? "").trim();

 if (agent_logic) {
 agent_logic = sanitizeTelegramHtml(agent_logic);
 }
 } catch (e) {
 response_type = "json_parse_failed";
 parse_error = String(e);
 body = sanitizeTelegramHtml(raw);
 }
}

const intermediateSteps = getIntermediateSteps();
const intermediateStepsRaw = getIntermediateStepsRaw();
const now = Date.now();
const ts_start_ms_obs = Number($('JSON Chat Memory').item.json.ts_start_ms || now);
const latency_ms = Math.max(0, now - ts_start_ms_obs);
const intermediate_steps_summary = buildIntermediateStepsSummary(intermediateSteps);
const intermediate_steps_json = safeStringify(
 intermediateStepsRaw == null ? intermediateSteps : intermediateStepsRaw
);
const success =
 response_type === "json" &&
 parse_error === "" &&
 Boolean(reply_html);

function buildDebugBlocks(fullJsonMaxLen = DEBUG_JSON_MAX_LEN, includeAgentLogic = true) {
 if (!DEBUG_ENABLED) return [];

 const blocks = [];

 if (parse_error) {
 blocks.push(withFormat("[debug] parse_error", parse_error, DEBUG_FORMAT_CODE));
 }

 if (schema_warning) {
 blocks.push(withFormat("[debug] schema_warning", schema_warning, DEBUG_FORMAT_CODE));
 }

 if (includeAgentLogic) {
 blocks.push(
 withFormat("Agent Logic", agent_logic, DEBUG_FORMAT_CODE, fullJsonMaxLen)
 );
 blocks.push(
 withFormat("Tools used", intermediate_steps_summary, DEBUG_FORMAT_CODE, fullJsonMaxLen)
 );
 }

 return blocks;
}

function buildOutput(fullJsonMaxLen = DEBUG_JSON_MAX_LEN, includeAgentLogic = true) {
 return joinParts([
 body,
 ...buildDebugBlocks(fullJsonMaxLen, includeAgentLogic),
 ]);
}

let output_clean = buildOutput(DEBUG_JSON_MAX_LEN, true);

if (output_clean.length > TELEGRAM_SOFT_LIMIT) {
 output_clean = buildOutput(DEBUG_JSON_MID_LEN, true);
}

if (output_clean.length > TELEGRAM_SOFT_LIMIT) {
 output_clean = buildOutput(DEBUG_JSON_MIN_LEN, true);
}

if (output_clean.length > TELEGRAM_SOFT_LIMIT) {
 output_clean = buildOutput(0, false);
}

if (output_clean.length > TELEGRAM_SOFT_LIMIT) {
 output_clean = body;
}

return [
 {
 ...$json,
 user_message_text: $('JSON Chat Memory').first().json.user_message_text,
sessionId: $('JSON Chat Memory').first().json.sessionId,
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
 },
];