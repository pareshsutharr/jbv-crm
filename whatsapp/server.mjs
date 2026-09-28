#!/usr/bin/env node
/**
 * Be IPO Ready CRM — WhatsApp service.
 *
 * A small standalone Node process that holds the firm's WhatsApp connection
 * (WhatsApp Web multi-device protocol via the open-source Baileys library),
 * kept OUTSIDE the Next.js app so the linked session survives every redeploy.
 * Run it under pm2 next to the CRM (see whatsapp/ecosystem.config.cjs).
 *
 *   WHATSAPP_SERVICE_TOKEN   shared secret the CRM sends as `Authorization: Bearer …` (required)
 *   WHATSAPP_SERVICE_PORT    default 3018       WHATSAPP_SERVICE_HOST   default 127.0.0.1
 *   WHATSAPP_SESSION_DIR     default ./whatsapp/session (keep it on persistent disk)
 *   WHATSAPP_GAP_MIN_MS / WHATSAPP_GAP_MAX_MS   pause between messages (default 3000–7000)
 *
 * Endpoints (JSON):  GET /health · GET /status · POST /link · POST /unlink · POST /send {phone,text}
 * Messages are queued and sent one at a time with a random 3–7 s gap.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Minimal .env loader (pm2 doesn't read .env); existing environment wins.
for (const file of [path.join(root, ".env"), path.join(root, ".env.local")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

const PORT = Number(process.env.WHATSAPP_SERVICE_PORT || 3018);
const HOST = process.env.WHATSAPP_SERVICE_HOST || "127.0.0.1";
const TOKEN = process.env.WHATSAPP_SERVICE_TOKEN;
const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || path.join(here, "session");
const GAP_MIN = Number(process.env.WHATSAPP_GAP_MIN_MS || 3000);
const GAP_MAX = Number(process.env.WHATSAPP_GAP_MAX_MS || 7000);
if (!TOKEN) {
  console.error("WHATSAPP_SERVICE_TOKEN is required (set it in .env or the environment)");
  process.exit(1);
}
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Connection ────────────────────────────────────────────────────────────
const state = { status: "disconnected", qr: null, phone: null, error: null, connectedAt: null };
let sock = null;
let creds = null;
let stopping = false;
let attempts = 0;
let timer = null;
/** A session counts only once the phone has finished pairing (creds.registered). */
const hasSession = () => {
  try {
    return existsSync(path.join(SESSION_DIR, "creds.json")) && JSON.parse(readFileSync(path.join(SESSION_DIR, "creds.json"), "utf8")).registered === true;
  } catch {
    return false;
  }
};
const phoneOf = (jid) => (jid ? jid.split(":")[0].split("@")[0].replace(/\D/g, "") || null : null);
const forgetSession = () => {
  rmSync(SESSION_DIR, { recursive: true, force: true });
  state.phone = null;
  state.connectedAt = null;
};

async function connect() {
  if (timer) clearTimeout(timer), (timer = null);
  mkdirSync(SESSION_DIR, { recursive: true });
  const auth = await useMultiFileAuthState(SESSION_DIR);
  creds = auth.state.creds;
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined;
  }
  stopping = false;
  state.status = "connecting";
  state.qr = null;
  state.error = null;
  const s = makeWASocket({
    auth: auth.state,
    version,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  sock = s;
  s.ev.on("creds.update", auth.saveCreds);
  s.ev.on("connection.update", (u) => {
    if (u.qr) {
      state.status = "qr";
      state.qr = u.qr;
    }
    if (u.connection === "open") {
      state.status = "connected";
      state.qr = null;
      state.error = null;
      attempts = 0;
      state.phone = phoneOf(s.user?.id);
      state.connectedAt = new Date().toISOString();
      log("connected as", state.phone);
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode ?? u.lastDisconnect?.error?.data?.statusCode;
      state.status = "disconnected";
      state.qr = null;
      sock = null;
      if (stopping) return;
      if (code === DisconnectReason.loggedOut) {
        state.error = "WhatsApp was unlinked from the phone. Link it again.";
        forgetSession();
        log("logged out on the phone");
        return;
      }
      // 515 = restart required: normal right after the QR is scanned. Reconnect to finish pairing.
      if (code === DisconnectReason.restartRequired) return reconnect(500);
      if (!creds?.registered) {
        state.error = code === DisconnectReason.timedOut ? "The QR code expired before it was scanned. Start again." : `Linking stopped (${code ?? "connection closed"}). Start again.`;
        log(state.error);
        return;
      }
      attempts += 1;
      reconnect(Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)));
    }
  });
}
function reconnect(delay) {
  state.status = "connecting";
  timer = setTimeout(() => {
    connect().catch((e) => {
      state.status = "disconnected";
      state.error = e.message;
      log("reconnect failed:", e.message);
    });
  }, delay);
}
async function end({ logout }) {
  stopping = true;
  if (timer) clearTimeout(timer), (timer = null);
  const s = sock;
  sock = null;
  try {
    if (logout && s && state.status === "connected") await s.logout();
    else s?.end(undefined);
  } catch {
    /* already closed */
  }
  state.status = "disconnected";
  state.qr = null;
  if (logout) forgetSession();
}

// ─── Send queue (one at a time, 3–7 s apart) ───────────────────────────────
const queue = [];
let draining = false;
const digitsOf = (phone) => {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`; // local Indian mobile
  return d.length >= 8 && d.length <= 15 ? d : null;
};
async function waitConnected(ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (state.status === "connected" && sock) return sock;
    if (state.status === "disconnected") {
      if (!hasSession()) throw new Error("WhatsApp isn't linked");
      if (!timer) connect().catch(() => undefined);
    }
    await sleep(250);
  }
  throw new Error(state.error || "WhatsApp is reconnecting — try again in a moment");
}
async function sendNow(phone, text) {
  const digits = digitsOf(phone);
  if (!digits) throw new Error("Invalid phone number");
  const s = await waitConnected();
  let jid = `${digits}@s.whatsapp.net`;
  try {
    const [found] = (await s.onWhatsApp(jid)) ?? [];
    if (found && found.exists === false) throw Object.assign(new Error(`+${digits} doesn't seem to be on WhatsApp`), { permanent: true });
    if (found?.jid) jid = found.jid;
  } catch (e) {
    if (e.permanent) throw e; // lookup unavailable: try sending anyway
  }
  const r = await s.sendMessage(jid, { text });
  return { id: r?.key?.id ?? null, to: `+${digits}` };
}
function enqueue(phone, text) {
  const job = { id: randomUUID(), phone, text };
  const promise = new Promise((resolve, reject) => Object.assign(job, { resolve, reject }));
  queue.push(job);
  void drain();
  return { job, promise };
}
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        job.resolve(await sendNow(job.phone, job.text));
        log("sent", job.id, "→", job.phone);
      } catch (e) {
        job.reject(e);
        log("send failed", job.id, "→", job.phone, ":", e.message);
      }
      if (queue.length) await sleep(GAP_MIN + Math.random() * Math.max(0, GAP_MAX - GAP_MIN));
    }
  } finally {
    draining = false;
  }
}

// ─── HTTP API ──────────────────────────────────────────────────────────────
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readJson = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b || "{}"));
      } catch {
        resolve({});
      }
    });
  });
const statusBody = () => ({ status: state.status, phone: state.phone, qr: state.status === "qr" ? state.qr : null, error: state.error, connectedAt: state.connectedAt, queued: queue.length });

http
  .createServer(async (req, res) => {
    const p = new URL(req.url, "http://localhost").pathname;
    if (p === "/health") return json(res, 200, { ok: true, status: state.status, queued: queue.length });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: "Unauthorized" });
    try {
      if (req.method === "GET" && p === "/status") return json(res, 200, statusBody());
      if (req.method === "POST" && p === "/link") {
        await end({ logout: false });
        forgetSession();
        state.error = null;
        await connect();
        for (let i = 0; i < 25 && state.status === "connecting"; i++) await sleep(400);
        return json(res, 200, statusBody());
      }
      if (req.method === "POST" && p === "/unlink") {
        await end({ logout: true });
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && p === "/send") {
        const { phone, text } = await readJson(req);
        if (!phone || !text) return json(res, 400, { error: "phone and text are required" });
        if (state.status === "disconnected" && !hasSession()) return json(res, 409, { error: "WhatsApp isn't linked" });
        const { job, promise } = enqueue(phone, text);
        const position = queue.length;
        // Wait for this message's turn for a while; a long queue answers "queued" instead.
        const outcome = await Promise.race([promise.then((r) => ({ sent: true, ...r })).catch((e) => ({ error: e.message })), sleep(20_000).then(() => ({ queued: true, id: job.id, position, to: `+${digitsOf(phone)}` }))]);
        if (outcome.error) return json(res, 502, { error: outcome.error });
        return json(res, 200, outcome);
      }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  })
  .listen(PORT, HOST, () => log(`WhatsApp service listening on http://${HOST}:${PORT} (session dir: ${SESSION_DIR})`));

if (hasSession()) connect().catch((e) => log("startup connect failed:", e.message));
process.on("SIGTERM", () => end({ logout: false }).finally(() => process.exit(0)));
process.on("SIGINT", () => end({ logout: false }).finally(() => process.exit(0)));
