// 오니가족 알림 보내기 (Supabase Edge Function "family-push")
// - GET  → { publicKey }  : 휴대폰이 알림을 구독할 때 쓰는 공개 키
// - POST → 가족 비밀번호(x-family-key 헤더)를 아는 기기만, 같은 가족의 다른 기기들에 Web Push 를 보내요.
// 외부 라이브러리 없이 WebCrypto 로 Web Push 암호화(RFC 8291)와 VAPID 서명(RFC 8292)을 직접 해요.
// VAPID 키는 처음 호출될 때 함수가 스스로 만들어 docs 테이블의 "__vapid" 행에 저장해요.
// (family 값이 sha256 해시가 아니라서 RLS 때문에 브라우저에서는 절대 읽을 수 없어요.)

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const hkdf = async (salt, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info },
  await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), len * 8));

// RFC 8291 aes128gcm body for one subscription
export async function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export async function vapidAuth(endpoint, vapid) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://wlgk666.github.io/family-dashboard/" })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export async function makeVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
}

export async function sendPush(sub, payload, vapid) {
  const body = await encryptPayload(sub, payload);
  return fetch(sub.endpoint, { method: "POST", body, headers: {
    Authorization: await vapidAuth(sub.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" } });
}

// ---------- database (service role, bypasses RLS) ----------
const env = (k) => Deno.env.get(k) || "";
const rest = (path, init = {}) => fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: {
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json", ...(init.headers || {}) } });
async function rows(q) { const r = await rest(`docs?${q}`); if (!r.ok) throw new Error("db " + r.status + " " + await r.text()); return r.json(); }

let vapidCache = null;
async function getVapid() {
  if (vapidCache) return vapidCache;
  let got = await rows("family=eq.__vapid&col=eq.cfg&id=eq.vapid&select=data");
  if (!got.length) {
    await rest("docs?on_conflict=family,col,id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ family: "__vapid", col: "cfg", id: "vapid", data: await makeVapid() }) });
    got = await rows("family=eq.__vapid&col=eq.cfg&id=eq.vapid&select=data");
  }
  return (vapidCache = got[0].data);
}
const sha256hex = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-family-key, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") return json({ publicKey: (await getVapid()).publicKey });
    const key = req.headers.get("x-family-key") || "";
    if (key.length < 4) return json({ error: "no key" }, 401);
    const fam = await sha256hex(key);
    if (!(await rows(`family=eq.${fam}&col=eq.members&select=id&limit=1`)).length) return json({ error: "unknown family" }, 403);
    const b = await req.json().catch(() => ({}));
    const to = Array.isArray(b.to) ? b.to.map(String) : null, except = String(b.except || "");
    const payload = JSON.stringify({ title: String(b.title || "오니가족🩷").slice(0, 80), body: String(b.body || "").slice(0, 200), url: String(b.url || "./").slice(0, 60), tag: String(b.tag || "").slice(0, 40) });
    const subs = (await rows(`family=eq.${fam}&col=eq.push&select=id,data`)).filter((r) => r.data && r.data.sub && r.data.sub.endpoint
      && (!except || r.data.memberId !== except) && (!to || to.includes(r.data.memberId)));
    const vapid = await getVapid();
    const results = await Promise.all(subs.map(async (r) => {
      try {
        const res = await sendPush(r.data.sub, payload, vapid);
        if (res.status === 404 || res.status === 410) await rest(`docs?family=eq.${fam}&col=eq.push&id=eq.${encodeURIComponent(r.id)}`, { method: "DELETE" });
        return res.status;
      } catch (e) { return String(e); }
    }));
    return json({ sent: results.filter((s) => s === 201 || s === 200).length, results });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handler);
