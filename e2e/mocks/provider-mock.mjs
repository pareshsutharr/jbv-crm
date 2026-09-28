// Gmail returns a fresh id per sent message; mirror that so repeated sends don't collide.
let sentCount = 0;
// Messages received by the SMTP mock below (system email via Settings → SMTP).
const smtpMessages = [];
const SMTP_PORT = 1026;
// Fake WhatsApp service (whatsapp/server.mjs) under /wa: link → QR → connected after two status polls.
const WA_TOKEN = "mock-wa-token";
const wa = { status: "disconnected", phone: null, polls: 0, error: null, connectedAt: null };
const waMessages = [];
// Minimal mock of the Google (OAuth, Calendar, Gmail) and Microsoft (OAuth, Graph)
// endpoints the CRM uses. Started by Playwright; the CRM is pointed at it via env
// (see `npm run start:e2e`). GET /__log returns the requests it received.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4455);
const log = [];
const now = Date.now();
const H = 3_600_000;
const b64 = (s) => Buffer.from(s).toString("base64url");

const gmail = [
  { id: "g1", threadId: "gt1", from: "Anita Deshpande <anita.d@sahyadrirenewables.in>", to: "rohan@beipoready.com", subject: "Updated cap table for RHP", body: "Hi Rohan, sharing the updated cap table post pre-IPO placement.", at: now - 3 * H },
  { id: "g2", threadId: "gt2", from: "Ops Team <ops@sahyadrirenewables.in>", to: "rohan@beipoready.com", subject: "Plant visit schedule", body: "Plant visit for the anchor investors is confirmed for Thursday.", at: now - 5 * H },
  { id: "g3", threadId: "gt3", from: "A Friend <friend@gmail.com>", to: "rohan@beipoready.com", subject: "Dinner on Saturday?", body: "Personal email that must never be stored.", at: now - 2 * H },
  { id: "g4", threadId: "gt4", from: "Rohan Sharma <rohan@beipoready.com>", to: "Sneha Kulkarni <sneha@kulkarniagritech.com>", subject: "Pre-IPO readiness checklist", body: "Hi Sneha, as discussed, please find the readiness checklist below.", at: now - 1 * H },
];
const graph = [
  { id: "m1", conversationId: "mc1", subject: "Re: DRHP chapter drafts for review", from: ["latha.rao@kaveriagro.com", "Latha Rao"], to: [["priya@beipoready.com", "Priya Nair"]], body: "Priya, comments on risk factors attached. Business chapter looks good.", at: now - 4 * H },
];

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.setEncoding("latin1");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const objects = new Map(); // Supabase Storage mock: "<bucket>/<key>" → { type, data }

const authed = (req, prefix) => (req.headers.authorization ?? "").startsWith(`Bearer ${prefix}`);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    const body = await readBody(req);
    if (p !== "/__log") log.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? null, body });

    if (p === "/__log") return json(res, 200, log);
    if (p === "/__reset") return (log.length = 0), (smtpMessages.length = 0), (waMessages.length = 0), json(res, 200, { ok: true });
    if (p === "/__smtp") return json(res, 200, smtpMessages);
    if (p === "/__wa") return json(res, 200, waMessages);
    if (p === "/__wa/reset") return Object.assign(wa, { status: "disconnected", phone: null, polls: 0, error: null, connectedAt: null }), json(res, 200, { ok: true });
    if (p.startsWith("/wa/")) {
      if (req.headers.authorization !== `Bearer ${WA_TOKEN}`) return json(res, 401, { error: "Unauthorized" });
      const waBody = () => ({ status: wa.status, phone: wa.phone, qr: wa.status === "qr" ? "mock-qr-payload" : null, error: wa.error, connectedAt: wa.connectedAt, queued: 0 });
      if (p === "/wa/status") {
        if (wa.status === "qr" && ++wa.polls >= 2) Object.assign(wa, { status: "connected", phone: "919999900000", connectedAt: new Date().toISOString() });
        return json(res, 200, waBody());
      }
      if (p === "/wa/link" && req.method === "POST") return Object.assign(wa, { status: "qr", phone: null, polls: 0, error: null, connectedAt: null }), json(res, 200, waBody());
      if (p === "/wa/unlink" && req.method === "POST") return Object.assign(wa, { status: "disconnected", phone: null, polls: 0, connectedAt: null }), json(res, 200, { ok: true });
      if (p === "/wa/send" && req.method === "POST") {
        if (wa.status !== "connected") return json(res, 409, { error: "WhatsApp isn't linked" });
        const msg = JSON.parse(body || "{}");
        waMessages.push(msg);
        return json(res, 200, { sent: true, id: `wa-${waMessages.length}`, to: msg.phone });
      }
      return json(res, 404, { error: "Not found" });
    }

    // ── Supabase Storage ──
    const so = p.match(/^\/supabase\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (so) {
      if (req.headers.authorization !== "Bearer mock-service-key" || req.headers.apikey !== "mock-service-key") return json(res, 401, { message: "Invalid JWT" });
      const id = `${so[1]}/${decodeURIComponent(so[2])}`;
      if (req.method === "POST") {
        if (objects.has(id)) return json(res, 409, { message: "The resource already exists" });
        objects.set(id, { type: req.headers["content-type"], data: Buffer.from(body, "latin1") });
        return json(res, 200, { Key: id });
      }
      const o = objects.get(id);
      if (!o) return json(res, 404, { message: "Object not found" });
      res.writeHead(200, { "Content-Type": o.type, "Content-Length": o.data.length });
      return res.end(o.data);
    }

    // ── Google OAuth ──
    if (p === "/google/auth") {
      res.writeHead(302, { Location: `${url.searchParams.get("redirect_uri")}?code=gcode&state=${encodeURIComponent(url.searchParams.get("state"))}` });
      return res.end();
    }
    if (p === "/google/token" && req.method === "POST") {
      const f = new URLSearchParams(body);
      if (f.get("client_secret") !== "mock-google-secret") return json(res, 401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code" && f.get("code") !== "gcode") return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: `g-at-${Date.now()}`, refresh_token: "g-rt", expires_in: 3600, scope: "email calendar gmail" });
    }
    if (p === "/google/api/oauth2/v3/userinfo") return authed(req, "g-at") ? json(res, 200, { email: "rohan@beipoready.com" }) : json(res, 401, { error: "unauthorized" });

    // ── Google Calendar ──
    if (p === "/google/api/calendar/v3/calendars/primary/events" && req.method === "POST") {
      if (!authed(req, "g-at")) return json(res, 401, { error: { message: "Invalid Credentials" } });
      const ev = JSON.parse(body);
      return json(res, 200, { id: "gev-1", htmlLink: "https://calendar.google.com/event?eid=mock", ...(ev.conferenceData ? { hangoutLink: "https://meet.google.com/mock-abcd-efg" } : {}) });
    }
    if (p.startsWith("/google/api/calendar/v3/calendars/primary/events/") && req.method === "DELETE") return json(res, 204);

    // ── Gmail ──
    if (p === "/google/gmail/gmail/v1/users/me/messages") {
      if (!authed(req, "g-at")) return json(res, 401, { error: { message: "Invalid Credentials" } });
      return json(res, 200, { messages: gmail.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if (p === "/google/gmail/gmail/v1/users/me/messages/send" && req.method === "POST") return json(res, 200, { id: `gsent-${++sentCount}`, threadId: "gt-sent" });
    const gm = p.match(/^\/google\/gmail\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
    if (gm) {
      const m = gmail.find((x) => x.id === gm[1]);
      if (!m) return json(res, 404, { error: { message: "Not found" } });
      return json(res, 200, {
        id: m.id,
        threadId: m.threadId,
        snippet: m.body.slice(0, 60),
        internalDate: String(m.at),
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: m.from },
            { name: "To", value: m.to },
            { name: "Subject", value: m.subject },
          ],
          parts: [{ mimeType: "text/plain", body: { data: b64(m.body) } }],
        },
      });
    }

    // ── Microsoft OAuth ──
    if (/^\/ms\/[^/]+\/oauth2\/v2\.0\/authorize$/.test(p)) {
      res.writeHead(302, { Location: `${url.searchParams.get("redirect_uri")}?code=mcode&state=${encodeURIComponent(url.searchParams.get("state"))}` });
      return res.end();
    }
    if (/^\/ms\/[^/]+\/oauth2\/v2\.0\/token$/.test(p) && req.method === "POST") {
      const f = new URLSearchParams(body);
      if (f.get("client_secret") !== "mock-ms-secret") return json(res, 401, { error: "invalid_client" });
      return json(res, 200, { access_token: `m-at-${Date.now()}`, refresh_token: "m-rt", expires_in: 3600, scope: "Mail.Read Mail.Send Calendars.ReadWrite" });
    }

    // ── Microsoft Graph ──
    if (p.startsWith("/graph/") && !authed(req, "m-at")) return json(res, 401, { error: { message: "InvalidAuthenticationToken" } });
    if (p === "/graph/me") return json(res, 200, { mail: "priya@beipoready.com", userPrincipalName: "priya@beipoready.com" });
    if (p === "/graph/me/events" && req.method === "POST") {
      const ev = JSON.parse(body);
      return json(res, 201, { id: "mev-1", webLink: "https://outlook.office.com/calendar/item/mock", onlineMeeting: ev.isOnlineMeeting ? { joinUrl: "https://teams.microsoft.com/l/meetup-join/mock" } : null });
    }
    if (/^\/graph\/me\/events\/[^/]+\/cancel$/.test(p)) return json(res, 202);
    if (p === "/graph/me/sendMail" && req.method === "POST") return json(res, 202);
    if (p === "/graph/me/messages") {
      return json(res, 200, {
        value: graph.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          subject: m.subject,
          bodyPreview: m.body.slice(0, 60),
          body: { contentType: "text", content: m.body },
          from: { emailAddress: { address: m.from[0], name: m.from[1] } },
          toRecipients: m.to.map(([address, name]) => ({ emailAddress: { address, name } })),
          ccRecipients: [],
          sentDateTime: new Date(m.at).toISOString(),
          receivedDateTime: new Date(m.at).toISOString(),
        })),
      });
    }
    json(res, 404, { error: `mock: no route for ${req.method} ${p}` });
  })
  .listen(PORT, () => console.log(`provider mock on :${PORT}`));

// ─── SMTP mock ─────────────────────────────────────────────────────────────
// Enough of RFC 5321 for nodemailer: EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, QUIT.
import net from "node:net";
net
  .createServer((sock) => {
    let buffer = "";
    let inData = false;
    let auth = null; // "PLAIN" | "LOGIN_USER" | "LOGIN_PASS"
    let msg = { from: null, to: [], raw: "" };
    const reply = (s) => sock.write(`${s}\r\n`);
    reply("220 mock-smtp ESMTP ready");
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let i;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            smtpMessages.push(msg);
            msg = { from: null, to: [], raw: "" };
            reply("250 OK queued");
          } else msg.raw += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        if (auth === "PLAIN") { auth = null; reply("235 Authentication successful"); continue; }
        if (auth === "LOGIN_USER") { auth = "LOGIN_PASS"; reply("334 UGFzc3dvcmQ6"); continue; }
        if (auth === "LOGIN_PASS") { auth = null; reply("235 Authentication successful"); continue; }
        const [cmd, ...rest] = line.split(" ");
        switch (cmd.toUpperCase()) {
          case "EHLO":
          case "HELO":
            sock.write("250-mock-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
            break;
          case "AUTH":
            if (rest[0]?.toUpperCase() === "PLAIN") {
              if (rest[1]) reply("235 Authentication successful");
              else { auth = "PLAIN"; reply("334 "); }
            } else { auth = "LOGIN_USER"; reply("334 VXNlcm5hbWU6"); }
            break;
          case "MAIL":
            msg.from = /<([^>]*)>/.exec(line)?.[1] ?? null;
            reply("250 OK");
            break;
          case "RCPT":
            msg.to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
            reply("250 OK");
            break;
          case "DATA":
            inData = true;
            reply("354 End data with <CR><LF>.<CR><LF>");
            break;
          case "RSET":
          case "NOOP":
            reply("250 OK");
            break;
          case "QUIT":
            reply("221 Bye");
            sock.end();
            break;
          default:
            reply("500 Unknown command");
        }
      }
    });
    sock.on("error", () => undefined);
  })
  .listen(SMTP_PORT, () => console.log(`smtp mock on :${SMTP_PORT}`));
