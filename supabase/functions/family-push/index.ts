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
// service key: legacy JWT (SUPABASE_SERVICE_ROLE_KEY) or new secret key (SUPABASE_SECRET_KEYS = {"default":"sb_secret_..."})
const serviceKey = () => { if (env("SUPABASE_SERVICE_ROLE_KEY")) return env("SUPABASE_SERVICE_ROLE_KEY"); try { return Object.values(JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}"))[0] || ""; } catch (e) { return ""; } };
const rest = (path, init = {}) => { const k = serviceKey(); return fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, { ...init, headers: {
  apikey: k, ...(k.startsWith("eyJ") ? { Authorization: `Bearer ${k}` } : {}), "Content-Type": "application/json", ...(init.headers || {}) } }); };
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

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-family-key, apikey, authorization, x-client-info, x-region", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function handler(req) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") return json({ publicKey: (await getVapid()).publicKey });
    const b = await req.json().catch(() => ({}));
    if (b.action === "morning") return json(await morningDigest(!!b.dry));
    const key = req.headers.get("x-family-key") || "";
    if (key.length < 4) return json({ error: "no key" }, 401);
    const fam = await sha256hex(key);
    if (!(await rows(`family=eq.${fam}&col=eq.members&select=id&limit=1`)).length) return json({ error: "unknown family" }, 403);
    if (typeof b.action === "string" && b.action.startsWith("naver-")) return json(await naverAction(fam, b));
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

// ======================= 매일 아침 알림: 오늘 일정 + 할 일 =======================
// GitHub Actions 가 매일 아침 7시(한국)쯤 부르면, 알림을 켠 가족 기기마다 그 사람의 오늘 일정·할 일을 보내요.
// 하루에 한 번만 돌도록 "__vapid" 행에 날짜를 남겨서, 누가 여러 번 불러도 알림이 겹치지 않아요.
// 매주 반복 일정(repeat = "weekly")은 첫날(date)과 같은 요일마다, until 까지, skip 에 없는 날 보여요 (app.js 와 같은 규칙)
function occursOn(e, day) {
  if (!e.date) return false;
  if (e.repeat !== "weekly") return e.date === day;
  const wd = (s) => new Date(s + "T00:00:00Z").getUTCDay();
  return day >= e.date && (!e.until || day <= e.until) && wd(day) === wd(e.date) && !(e.skip || []).includes(day);
}
async function morningDigest(dry) {
  const now = Date.now(), today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  const guard = (await rows("family=eq.__vapid&col=eq.cfg&id=eq.morning&select=data"))[0];
  if (!dry && guard && guard.data.day === today) return { skipped: true, day: today };
  if (!dry) await rest("docs?on_conflict=family,col,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ family: "__vapid", col: "cfg", id: "morning", data: { day: today, at: now } }) });
  const subs = await rows("col=eq.push&select=family,id,data&limit=2000");
  const fams = [...new Set(subs.map((r) => r.family))];
  const vapid = await getVapid(); let sent = 0; const preview = [];
  const kstDay = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
  for (const fam of fams) {
    const all = await rows(`family=eq.${fam}&col=in.(members,events,chores)&select=col,id,data&limit=5000`);
    const members = all.filter((r) => r.col === "members"), events = all.filter((r) => r.col === "events").map((r) => r.data), chores = all.filter((r) => r.col === "chores").map((r) => r.data);
    for (const s of subs.filter((r) => r.family === fam && r.data && r.data.sub)) {
      const m = members.find((x) => x.id === s.data.memberId); if (!m || m.data.kind === "grand") continue;
      const evs = events.filter((e) => occursOn(e, today) && (!(e.memberIds || []).length || e.memberIds.includes(m.id))).sort((a, c) => (a.start || "99").localeCompare(c.start || "99"));
      const todo = chores.filter((c) => (!c.memberId || c.memberId === m.id) && !(c.done && (!c.daily || kstDay(c.doneAt || 0) === today)));
      if (!evs.length && !todo.length) continue;
      const lines = [];
      if (evs.length) lines.push("📅 " + evs.slice(0, 4).map((e) => (e.start ? e.start + " " : "") + e.title).join(", ") + (evs.length > 4 ? ` 외 ${evs.length - 4}개` : ""));
      if (todo.length) lines.push(`✅ 할 일 ${todo.length}개: ` + todo.slice(0, 3).map((c) => c.title).join(", ") + (todo.length > 3 ? " …" : ""));
      const payload = JSON.stringify({ title: `☀️ ${m.data.name}의 오늘`, body: lines.join("\n").slice(0, 200), url: "./#home", tag: "morning" });
      if (dry) { preview.push({ evs: evs.length, todo: todo.length }); continue; }
      try { const res = await sendPush(s.data.sub, payload, vapid); if (res.status === 201 || res.status === 200) sent++; if (res.status === 404 || res.status === 410) await rest(`docs?family=eq.${fam}&col=eq.push&id=eq.${encodeURIComponent(s.id)}`, { method: "DELETE" }); } catch (e) {}
    }
  }
  return { ok: true, day: today, families: fams.length, sent, preview: dry ? preview : undefined };
}

// ======================= 네이버 캘린더 → 일정 (한 방향, 새 일정만 추가) =======================
// 네이버 아이디와 "앱 비밀번호"는 "__naver" 행에 저장돼요. family 값이 해시가 아니라서 브라우저에서는 읽을 수 없어요.
// 한 번 가져온 일정은 seen 목록에 남기 때문에, 보드에서 고치거나 지워도 다시 덮어쓰거나 다시 넣지 않아요.
const CALDAV = "https://caldav.calendar.naver.com";
const SYNC_EVERY = 2 * 3600e3;

const xmlDecode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, "\r").replace(/&#10;/g, "\n").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const tagRe = (name, flags = "") => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, flags);
const firstHref = (xml, inside) => { const m = xml.match(tagRe(inside)); const h = m && m[1].match(tagRe("href")); return h ? xmlDecode(h[1].trim()) : ""; };

let davTrace = [];
async function dav(method, url, auth, body, depth = "0") {
  const r = await fetch(url, { method, redirect: "follow", headers: { Authorization: auth, Depth: depth, "Content-Type": "application/xml; charset=utf-8", "User-Agent": "Mozilla/5.0 (family-dashboard CalDAV)" }, body });
  const text = await r.text();
  davTrace.push(`${method} ${url.replace(CALDAV, "")} -> ${r.status} ${text.replace(/\s+/g, " ").slice(0, 300)}`);
  if (r.status === 401 || r.status === 403) throw new Error("login");
  if (r.status >= 400) throw new Error(`${method} ${r.status}`);
  return text;
}
async function naverCalendars(auth, user = "") {
  const P = (props) => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;
  let principal = "";
  for (const u of [CALDAV + "/", CALDAV + "/.well-known/caldav", CALDAV + "/principals/", user && `${CALDAV}/principals/users/${user}/`].filter(Boolean)) {
    try { principal = firstHref(await dav("PROPFIND", u, auth, P("<d:current-user-principal/>")), "current-user-principal"); } catch (e) { if (e.message === "login") throw e; }
    if (principal) break;
  }
  if (!principal && user) principal = `/principals/users/${user}/`;
  if (!principal) throw new Error("no principal");
  let home = "";
  try { home = firstHref(await dav("PROPFIND", new URL(principal, CALDAV).href, auth, P("<c:calendar-home-set/>")), "calendar-home-set"); } catch (e) { if (e.message === "login") throw e; }
  if (!home && user) home = `/calendar/users/${user}/`;
  if (!home) throw new Error("no calendar home");
  const list = await dav("PROPFIND", new URL(home, CALDAV).href, auth, P("<d:resourcetype/><d:displayname/>"), "1");
  const out = [];
  for (const m of list.matchAll(tagRe("response", "g"))) {
    const resp = m[1], rt = resp.match(tagRe("resourcetype"));
    if (!rt || !/<(?:[\w-]+:)?calendar[\s/>]/.test(rt[1])) continue;
    const h = resp.match(tagRe("href")); if (h) out.push(new URL(xmlDecode(h[1].trim()), CALDAV).href);
  }
  return out;
}
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
async function naverEvents(auth, cal, from, to) {
  const H = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">`;
  const range = `<c:time-range start="${icsStamp(from)}" end="${icsStamp(to)}"/>`;
  const tries = [
    H + `<d:prop><d:getetag/><c:calendar-data><c:expand start="${icsStamp(from)}" end="${icsStamp(to)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
    H + `<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
    H + `<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`,
  ];
  const grab = (xml) => [...xml.matchAll(tagRe("calendar-data", "g"))].map((m) => xmlDecode(m[1])).filter((x) => x.includes("BEGIN:VEVENT"));
  for (const body of tries) {
    try { const got = grab(await dav("REPORT", cal, auth, body, "1")); if (got.length) return got; } catch (e) { if (e.message === "login") throw e; }
  }
  // last resort: list the .ics files and fetch them with calendar-multiget
  try {
    const list = await dav("PROPFIND", cal, auth, `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontenttype/></d:prop></d:propfind>`, "1");
    const hrefs = [...list.matchAll(tagRe("href", "g"))].map((m) => xmlDecode(m[1].trim())).filter((h) => new URL(h, CALDAV).href !== cal).slice(0, 500);
    if (!hrefs.length) return [];
    const mg = `<?xml version="1.0" encoding="utf-8"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.map((h) => `<d:href>${h.replace(/&/g, "&amp;")}</d:href>`).join("")}</c:calendar-multiget>`;
    return grab(await dav("REPORT", cal, auth, mg, "1"));
  } catch (e) { if (e.message === "login") throw e; return []; }
}

// --- iCalendar parsing (enough for Naver) ---
const icsUnescape = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
function parseVevents(ics) {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const evs = []; let cur = null, depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; } // VALARM inside
    if (line.startsWith("END:") && depth) { depth--; continue; }
    if (line === "END:VEVENT") { evs.push(cur); cur = null; continue; }
    if (depth) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    cur[name.toUpperCase()] = { v: line.slice(i + 1), p: params.join(";").toUpperCase() };
  }
  return evs;
}
// → { date: "YYYY-MM-DD", time: "HH:MM" | "" } in Korea time
function icsTime(prop) {
  if (!prop) return null;
  const v = prop.v.trim(), m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: "", allDay: true };
  let d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  if (!m[7]) d = new Date(d.getTime() - 9 * 3600e3); // floating / TZID → treat as Korea time
  const k = new Date(d.getTime() + 9 * 3600e3), p = (n) => String(n).padStart(2, "0");
  return { date: `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`, time: `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`, allDay: false };
}
const addDaysStr = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// simple RRULE expansion, used only when the server did not expand repeats itself
function expandRule(start, rule, fromStr, toStr) {
  const r = Object.fromEntries(rule.split(";").map((x) => x.split("=")));
  const freq = r.FREQ, step = Math.max(1, +(r.INTERVAL || 1)), count = r.COUNT ? +r.COUNT : 400;
  const until = r.UNTIL ? icsTime({ v: r.UNTIL }).date : "9999-12-31";
  const days = r.BYDAY ? r.BYDAY.split(",").map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(d.slice(-2))) : null;
  const out = []; let n = 0;
  for (let i = 0, d = start; i < 3000 && n < count && d <= until && d <= toStr; i++) {
    let hit = true;
    if (freq === "WEEKLY" && days) {
      const dow = new Date(d + "T00:00:00Z").getUTCDay(), wk = Math.floor((Date.parse(d) - Date.parse(start)) / (7 * 864e5));
      hit = days.includes(dow) && wk % step === 0;
      if (hit) { n++; if (d >= fromStr) out.push(d); }
      d = addDaysStr(d, 1); continue;
    }
    if (hit) { n++; if (d >= fromStr) out.push(d); }
    if (freq === "DAILY") d = addDaysStr(d, step);
    else if (freq === "WEEKLY") d = addDaysStr(d, 7 * step);
    else if (freq === "MONTHLY") { const x = new Date(start + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + step * n); d = x.toISOString().slice(0, 10); }
    else if (freq === "YEARLY") { const x = new Date(start + "T00:00:00Z"); x.setUTCFullYear(x.getUTCFullYear() + step * n); d = x.toISOString().slice(0, 10); }
    else break;
  }
  return out;
}
const guessType = (t) => /야구|직관|롯데|자이언츠|사직/.test(t) ? "game" : /교회|예배|주일|성경|구역/.test(t) ? "church" : /학원|과외|레슨/.test(t) ? "academy" : /학교|개학|방학|소풍|현장학습|학부모|상담/.test(t) ? "school" : /여행|휴가|캠핑|호텔|펜션|비행/.test(t) ? "trip" : "";

export function icsToBoardEvents(icsList, fromStr, toStr) {
  const out = [];
  for (const ics of icsList) for (const e of parseVevents(ics)) {
    if (!e.DTSTART || (e.STATUS && /CANCELLED/i.test(e.STATUS.v))) continue;
    const st = icsTime(e.DTSTART), en = icsTime(e.DTEND); if (!st) continue;
    let title = icsUnescape((e.SUMMARY && e.SUMMARY.v) || "(제목 없음)").slice(0, 80);
    let lastDay = en ? (en.allDay ? addDaysStr(en.date, -1) : en.date) : st.date;
    if (lastDay > st.date) title += ` (~${+lastDay.slice(5, 7)}/${+lastDay.slice(8, 10)})`;
    const uid = (e.UID && e.UID.v) || title + st.date;
    const dates = e.RRULE && !e["RECURRENCE-ID"] ? expandRule(st.date, e.RRULE.v.toUpperCase(), fromStr, toStr) : [st.date];
    for (const date of dates) {
      if (date < fromStr || date > toStr) continue;
      out.push({ key: `${uid}|${e["RECURRENCE-ID"] ? e["RECURRENCE-ID"].v : date}`, ev: { title, date, start: st.time, end: en && !en.allDay && en.date === st.date ? en.time : "", memberIds: [], type: guessType(title), game: guessType(title) === "game", by: "", src: "naver", createdAt: Date.now() } });
    }
  }
  return out;
}

const naverRow = async (fam) => (await rows(`family=eq.__naver&col=eq.cfg&id=eq.${fam}&select=data`))[0]?.data || null;
const saveNaverRow = (fam, data) => rest("docs?on_conflict=family,col,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ family: "__naver", col: "cfg", id: fam, data, updated_at: new Date().toISOString() }) });
const basic = (id, pw) => "Basic " + btoa(String.fromCharCode(...enc.encode(`${id}:${pw}`)));

async function naverSync(fam, cfg) {
  const auth = basic(cfg.id, cfg.pw), now = Date.now(); davTrace = [];
  const kst = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
  const fromStr = kst(now - 864e5), toStr = kst(now + 180 * 864e5);
  const cals = await naverCalendars(auth, cfg.id);
  const ics = []; for (const c of cals) ics.push(...await naverEvents(auth, c, new Date(now - 2 * 864e5), new Date(now + 181 * 864e5)));
  const found = icsToBoardEvents(ics, fromStr, toStr);
  console.log("naver sync", JSON.stringify({ calendars: cals.length, ics: ics.length, found: found.length }), davTrace.filter((t) => t.startsWith("REPORT") || t.startsWith("PROPFIND /calendar")).join(" | ").slice(0, 2500));
  const seen = new Set(cfg.seen || []), fresh = [];
  for (const f of found) { if (cfg.memberId) f.ev.memberIds = [cfg.memberId]; const h = (await sha256hex(f.key)).slice(0, 16); if (seen.has(h)) continue; seen.add(h); fresh.push({ family: fam, col: "events", id: "nv" + h, data: f.ev, updated_at: new Date().toISOString() }); }
  if (fresh.length) {
    const r = await rest("docs?on_conflict=family,col,id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(fresh) });
    if (!r.ok) throw new Error("save " + r.status);
  }
  await saveNaverRow(fam, { ...cfg, seen: [...seen].slice(-5000), lastSync: now, lastAdded: fresh.length, calendars: cals.length, error: "" });
  return { ok: true, added: fresh.length, calendars: cals.length, lastSync: now };
}

async function naverAction(fam, b) {
  const cfg = await naverRow(fam);
  if (b.action === "naver-status") return cfg ? { connected: true, naverId: cfg.id, memberId: cfg.memberId || "", lastSync: cfg.lastSync || 0, lastAdded: cfg.lastAdded || 0, calendars: cfg.calendars || 0, error: cfg.error || "" } : { connected: false };
  if (b.action === "naver-off") { await rest(`docs?family=eq.__naver&col=eq.cfg&id=eq.${fam}`, { method: "DELETE" }); return { connected: false }; }
  if (b.action === "naver-save") {
    const id = String(b.id || "").trim().replace(/@naver\.com$/i, ""), pw = String(b.pw || "").trim();
    if (!id || !pw) return { error: "아이디와 앱 비밀번호를 넣어 주세요." };
    davTrace = [];
    try { await naverCalendars(basic(id, pw), id); console.log("naver ok", davTrace.join(" | ").slice(0, 1500)); } catch (e) { console.error("naver connect failed:", e.message, davTrace.join(" | ").slice(0, 3000)); return { error: e.message === "login" ? "네이버 로그인이 안 돼요. 아이디와 앱 비밀번호를 다시 확인해 주세요." : "네이버 캘린더에 연결하지 못했어요. (" + e.message + ")" }; }
    // 처음 연결할 때 이미 있던 seen 은 유지 (다시 연결해도 지운 일정이 되살아나지 않게)
    const next = { id, pw, memberId: String(b.memberId || "").slice(0, 40), seen: cfg ? cfg.seen || [] : [], lastSync: 0 };
    await saveNaverRow(fam, next);
    return await naverSync(fam, next).catch((e) => ({ error: String(e.message || e) }));
  }
  if (b.action === "naver-sync") {
    if (!cfg) return { connected: false };
    if (!b.force && Date.now() - (cfg.lastSync || 0) < SYNC_EVERY) return { skipped: true, lastSync: cfg.lastSync };
    try { return await naverSync(fam, cfg); }
    catch (e) { await saveNaverRow(fam, { ...cfg, lastSync: Date.now(), error: e.message === "login" ? "login" : String(e.message || e) }); return { error: e.message === "login" ? "네이버 로그인이 풀렸어요. 앱 비밀번호를 다시 넣어 주세요." : String(e.message || e) }; }
  }
  return { error: "unknown action" };
}

if (typeof Deno !== "undefined" && Deno.serve) Deno.serve(handler);
