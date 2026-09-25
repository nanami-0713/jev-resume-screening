// Jev 简历匹配工作台 - 本地代理服务
// 零依赖，Node >= 18。仅监听 127.0.0.1，key 只在内存中转发，不落盘不打印。
// 用法: node server.mjs  (可选 PORT=8787)
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";
const TS_BASE = "https://api.typesafe.ai";
const MAX_BODY = 5 * 1024 * 1024;

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/criteria.js": ["criteria.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/demo-data.js": ["demo-data.js", "text/javascript; charset=utf-8"],
  "/vendor/pdf.min.js": ["vendor/pdf.min.js", "text/javascript; charset=utf-8"],
  "/vendor/pdf.worker.min.js": ["vendor/pdf.worker.min.js", "text/javascript; charset=utf-8"],
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function forwardJSON(url, init, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, text };
  } finally { clearTimeout(timer); }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  try {
    if (req.method === "GET" && STATIC[path]) {
      const [file, type] = STATIC[path];
      return send(res, 200, readFileSync(join(ROOT, file)), type);
    }
    if (path === "/favicon.ico") return send(res, 204, "");

    if (req.method === "POST" && path === "/api/jev") {
      const body = JSON.parse(await readBody(req));
      const { apiKey, payload } = body;
      if (!apiKey || !payload) return send(res, 400, JSON.stringify({ error: "需要 apiKey 和 payload" }));
      const out = await forwardJSON(`${TS_BASE}/v1/systemone`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log(`[jev] ${out.status} ${JSON.stringify(payload?.questions ? Object.keys(payload.questions).length : 0)}q`);
      return send(res, out.status, out.text);
    }

    if (req.method === "POST" && path === "/api/llm") {
      const body = JSON.parse(await readBody(req));
      const { baseUrl, apiKey, model, messages, temperature = 0.2, jsonMode = true } = body;
      if (!apiKey || !model || !messages) return send(res, 400, JSON.stringify({ error: "需要 baseUrl/apiKey/model/messages" }));
      const base = String(baseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
      const call = (withJsonMode) => forwardJSON(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, messages, temperature,
          ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      let out = await call(jsonMode);
      // 部分兼容端点不支持 response_format，回退重试一次
      if (out.status === 400 && jsonMode) out = await call(false);
      console.log(`[llm] ${out.status} ${model} @ ${base}`);
      return send(res, out.status, out.text);
    }

    return send(res, 404, JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error(`[error] ${path}: ${err.message}`);
    return send(res, 502, JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Jev 简历匹配工作台已启动: http://${HOST}:${PORT}`);
  console.log("仅监听本机回环地址；两把 key 均由浏览器经本代理转发，服务不存储任何密钥。");
});
