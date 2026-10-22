// dsh-deepworker (DeepWorker) node half.
//
// The client half ships through exports["./client"]. This host half exposes one
// stateless endpoint: a selected passage + optional question in, one short model
// answer out. It never creates or reads a session, so the request carries no
// conversation history.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const QUICK_PATH = "/dsh-deepworker/quick-explain";
const WORKSPACE_PATH = "/dsh-deepworker/workspace-changes";
const MAX_BODY = 24 * 1024;
const SYSTEM_RULES = [
  "你是随手百科。",
  "只回答当前问题，用一到三句话解释；不展开、不举例、不追问、不引用任何对话历史。",
  "不知道就直说不知道，不要编造。"
].join("\n");

function isLoopback(req) {
  const address = req && req.socket ? String(req.socket.remoteAddress || "") : "";
  return address === "" || address === "127.0.0.1" || address === "::1"
    || address.startsWith("::ffff:127.") || address.startsWith("127.");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        if (typeof req.destroy === "function") req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function quickExplain(ctx, text, question, override) {
  const fallback = ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === "function"
    ? ctx.agentDefaultModel.currentSelection()
    : null;
  const selection = override && typeof override.provider === "string" && typeof override.model === "string"
    && override.provider !== "" && override.model !== ""
    ? { provider: override.provider, model: override.model }
    : fallback;
  if (!selection || typeof selection.provider !== "string" || typeof selection.model !== "string") {
    throw new Error("no default model selection");
  }
  const prompt = "选中内容：\n" + text + "\n\n问题：\n" + (question || "请解释这段内容。");
  const messages = [
    { role: "system", content: [{ type: "text", text: SYSTEM_RULES }] },
    { role: "user", content: [{ type: "text", text: prompt }] }
  ];
  let answer = "";
  let failure = null;
  for await (const chunk of ctx.llm.stream({
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    maxTokens: 320,
    messages
  })) {
    if (chunk && chunk.type === "text-delta" && typeof chunk.text === "string") answer += chunk.text;
    if (chunk && chunk.type === "finish" && chunk.reason && chunk.reason.kind !== "stop") failure = chunk.reason;
  }
  if (failure !== null) throw new Error("model finish: " + (failure.kind || "unknown"));
  answer = answer.trim();
  if (answer === "") throw new Error("empty model answer");
  return answer;
}

function parsePorcelainZ(stdout) {
  const records = String(stdout || "").split("\0");
  const entries = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === "" || record.length < 4) continue;
    const status = record.slice(0, 2);
    let path = record.slice(3);
    let origPath;
    if (status.includes("R") || status.includes("C")) {
      const original = records[i + 1];
      if (typeof original === "string" && original !== "") {
        origPath = original;
        i += 1;
      }
    }
    entries.push({ status, path, ...(origPath ? { origPath } : {}) });
    if (entries.length >= 500) break;
  }
  return entries;
}

async function workspaceChanges(cwd) {
  const directory = await stat(cwd);
  if (!directory.isDirectory()) throw new Error("cwd is not a directory");
  let root;
  try {
    const top = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 5000, maxBuffer: 64 * 1024 });
    root = String(top.stdout || "").trim();
  } catch (e) {
    return { git: false, root: "", entries: [] };
  }
  const result = await execFileAsync("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { timeout: 5000, maxBuffer: 256 * 1024 });
  return { git: true, root, entries: parsePorcelainZ(result.stdout) };
}

function apply(ctx) {
  ctx.inject(["webServer", "llm", "agentDefaultModel"], function (webCtx) {
    webCtx.effect(function () {
      return webCtx.webServer.register({
        kind: "exact",
        path: QUICK_PATH,
        handler: async function (req, res) {
          if (!isLoopback(req)) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
          if (req.method !== "POST") { sendJson(res, 405, { ok: false, error: "method not allowed" }); return; }
          let body;
          try { body = await readJson(req); }
          catch (e) { sendJson(res, 400, { ok: false, error: String(e && e.message || e) }); return; }
          const text = typeof body.text === "string" ? body.text.trim() : "";
          const question = typeof body.question === "string" ? body.question.trim() : "";
          if (text === "") { sendJson(res, 400, { ok: false, error: "text is required" }); return; }
          if (text.length > 6000) { sendJson(res, 413, { ok: false, error: "text is too long" }); return; }
          if (question.length > 1000) { sendJson(res, 413, { ok: false, error: "question is too long" }); return; }
          try {
            const override = {
              provider: typeof body.provider === "string" ? body.provider.slice(0, 200) : "",
              model: typeof body.model === "string" ? body.model.slice(0, 200) : ""
            };
            const answer = await quickExplain(webCtx, text, question, override);
            sendJson(res, 200, { ok: true, answer });
          } catch (e) {
            sendJson(res, 502, { ok: false, error: String(e && e.message || e) });
          }
        }
      });
    }, "dsh-deepworker: POST " + QUICK_PATH);
    webCtx.effect(function () {
      return webCtx.webServer.register({
        kind: "exact",
        path: WORKSPACE_PATH,
        handler: async function (req, res) {
          if (!isLoopback(req)) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
          if (req.method !== "GET") { sendJson(res, 405, { ok: false, error: "method not allowed" }); return; }
          let cwd = "";
          try { cwd = new URL(req.url || "/", "http://localhost").searchParams.get("cwd") || ""; }
          catch (e) { cwd = ""; }
          if (cwd === "" || !cwd.startsWith("/")) { sendJson(res, 400, { ok: false, error: "cwd must be an absolute path" }); return; }
          try {
            const value = await workspaceChanges(cwd);
            sendJson(res, 200, { ok: true, ...value, count: value.entries.length });
          } catch (e) {
            sendJson(res, 200, { ok: false, error: String(e && e.message || e) });
          }
        }
      });
    }, "dsh-deepworker: GET " + WORKSPACE_PATH);
  });
}

export { apply };
