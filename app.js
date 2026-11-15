(() => {
  const $ = id => document.getElementById(id);
  const $$ = s => [...document.querySelectorAll(s)];
  const COLORS = 6;
  const DOW = ["일","월","화","수","목","금","토"];
  const MOODS = [["홈런","var(--m0)"],["안타","var(--m4)"],["볼넷","var(--m3)"],["삼진","var(--m1)"]];
  const NAMES = ["members","events","chores","notices","diary","shopping","messages","allowance"];
  const state = Object.fromEntries(NAMES.map(n => [n, []]));
  state.weather = [];
  const CFG = window.FAMILY_CONFIG || {};
  const won = n => "₩" + Math.round(n).toLocaleString("ko-KR");
  let db = null, me = null, filter = "", selDay = null, homeTab = "ev", evType = "", diMood = "안타";
  const evWho = new Set();
  let cursor = new Date(); cursor.setDate(1);

  try { me = localStorage.getItem("fam-me"); filter = localStorage.getItem("fam-filter") || ""; } catch(e) {}
  const store = (k,v) => { try { localStorage.setItem(k,v); } catch(e) {} };

  const pad = n => String(n).padStart(2,"0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  // a daily chore counts as done only on the day it was checked
  const fresh = c => c.daily && c.done && ymd(new Date(c.doneAt || 0)) !== todayStr() ? { ...c, done: false, doneBy: "", doneAt: 0 } : c;
  const pull = (st, n) => { const l = st ? st.list(n) : []; return n === "chores" ? l.map(fresh) : l; };
  const addDays = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
  const fmtDay = s => { const d = parseYmd(s); return `${d.getMonth()+1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; };
  const relDay = s => { const n = Math.round((parseYmd(s) - parseYmd(todayStr())) / 864e5); return n === 0 ? "오늘" : n === 1 ? "내일" : `${n}일 뒤`; };
  const ago = t => { const s = (Date.now()-t)/1000; if (s < 60) return "방금"; if (s < 3600) return `${Math.floor(s/60)}분 전`; if (s < 86400) return `${Math.floor(s/3600)}시간 전`; const d = new Date(t); return `${d.getMonth()+1}/${d.getDate()}`; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const icon = (id, size) => { const s = document.createElementNS("http://www.w3.org/2000/svg","svg"); s.setAttribute("class","i"); if (size) s.style.cssText = `width:${size}px;height:${size}px`; const u = document.createElementNS("http://www.w3.org/2000/svg","use"); u.setAttribute("href","#"+id); s.append(u); return s; };
  const member = id => state.members.find(m => m.id === id);
  const sortedMembers = () => [...state.members].sort((a,b) => ((a.kind==="parent")-(b.kind==="parent")) || ((a.createdAt||0)-(b.createdAt||0)));
  const kids = () => sortedMembers().filter(m => m.kind !== "parent");
  const colorVar = m => `var(--m${((m && m.color) || 0) % COLORS})`;
  const avatar = (m, sm) => { const a = el("span","av"+(sm?" sm":""), m ? m.name.slice(0,1) : "전"); if (m) a.style.background = colorVar(m); else a.classList.add("all"); a.title = m ? m.name : "가족 전체"; return a; };
  const who = e => Array.isArray(e.memberIds) ? e.memberIds : (e.memberId ? [e.memberId] : []);
  const visibleFor = ids => !filter || !ids.length || ids.includes(filter);
  const toast = msg => { const t = el("div","toast",msg); t.setAttribute("role","status"); document.body.append(t); setTimeout(() => t.remove(), 2400); };
  const fail = e => { console.error(e); toast(e && /42501|row-level|permission/.test((e.code||"") + (e.message||"")) ? "가족 비밀번호가 맞지 않아요. 다시 로그인해 주세요." : "저장하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요."); };
  const ready = () => { if (!db) { toast("아직 보드에 연결되지 않았어요."); return false; } return true; };
  const del = (col,id) => () => ready() && db.doc(`${col}/${id}`).delete().catch(fail);
  const xBtn = (label, fn) => { const x = el("button","x","×"); x.type = "button"; x.setAttribute("aria-label", label + " 삭제"); x.onclick = fn; return x; };
  const timeLabel = e => e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : "종일";
  const EV_TYPES = [["game","⚾","직관","var(--red)"],["church","⛪","교회","var(--m5)"],["school","🏫","학교","var(--m1)"],["academy","📚","학원","var(--m4)"],["trip","✈️","여행","var(--m3)"]];
  const typeOf = e => EV_TYPES.find(t => t[0] === (e.type || (e.game ? "game" : "")));
  const evColor = e => { const t = typeOf(e); return t ? t[3] : (who(e).length === 1 ? colorVar(member(who(e)[0])) : "var(--deep)"); };
  const sortEv = (a,b) => (a.date+(a.start||"99")).localeCompare(b.date+(b.start||"99"));

  // ---------- routing ----------
  const VIEWS = ["home","calendar","diary","todo","school","money","board","family"];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== v);
    $$("#nav a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
    window.scrollTo(0,0);
  }
  addEventListener("hashchange", route);

  // ---------- header ----------
  function renderFilter() {
    const s = $("filter"); s.replaceChildren(new Option("가족 전체", ""));
    sortedMembers().forEach(m => s.append(new Option(m.name, m.id)));
    if (!member(filter)) filter = "";
    s.value = filter;
  }
  $("filter").onchange = e => { filter = e.target.value; store("fam-filter", filter); renderAll(); };

  // ---------- calendar ----------
  function monthCells() {
    const first = new Date(cursor), start = addDays(first, -((first.getDay()+6)%7));
    return Array.from({length:42}, (_,i) => addDays(start, i));
  }
  function renderMonth(box, big) {
    box.replaceChildren();
    ["월","화","수","목","금","토","일"].forEach((d,i) => box.append(el("div","dw"+(i===6?" sun":""), d)));
    const t = todayStr(), cells = monthCells();
    const last = cells.slice(35).every(d => d.getMonth() !== cursor.getMonth()) ? 35 : 42;
    cells.slice(0,last).forEach(d => {
      const s = ymd(d), evs = state.events.filter(e => e.date === s && visibleFor(who(e))).sort(sortEv);
      const b = el("button","d"+(d.getMonth()!==cursor.getMonth()?" out":"")+(s===t?" today":"")+(s===selDay?" sel":"")+(d.getDay()===0?" sun":""));
      b.type = "button";
      b.append(el("span","n", d.getDate()));
      if (big) {
        const w = el("div","evs");
        evs.slice(0,3).forEach(e => { const p = el("div","ev", (typeOf(e) ? typeOf(e)[1] + " " : "") + e.title); p.style.background = evColor(e); w.append(p); });
        if (evs.length > 3) w.append(el("div","meta",`+${evs.length-3}`));
        b.append(w);
      } else {
        const dots = el("span","dots");
        evs.slice(0,4).forEach(e => { const dt = el("span","dot"); dt.style.background = evColor(e); dots.append(dt); });
        b.append(dots);
      }
      b.setAttribute("aria-label", `${fmtDay(s)}, 일정 ${evs.length}개`);
      b.onclick = () => { selDay = selDay === s ? null : s; $("ev-date").value = s; if (!big) homeTab = "ev"; renderCal(); };
      box.append(b);
    });
  }
  function evRow(e, opts = {}) {
    const r = el("div","ev-row");
    r.append(el("span","rel", relDay(e.date)), el("span","tm", timeLabel(e)));
    const tt = el("span","tt"); const ty = typeOf(e); if (ty) { const bd = el("span","badge", ty[1] + " " + ty[2]); bd.style.color = ty[3]; bd.style.background = `color-mix(in srgb, ${ty[3]} 14%, transparent)`; tt.append(bd); } tt.append(document.createTextNode(e.title)); r.append(tt);
    const st = el("span","stack"); const ids = who(e);
    (ids.length ? ids.map(member).filter(Boolean) : [null]).slice(0,4).forEach(m => st.append(avatar(m, true)));
    r.append(st);
    if (opts.del) r.append(xBtn(e.title, del("events", e.id)));
    return r;
  }
  function upcoming(days) {
    const t = todayStr(), end = days ? ymd(addDays(new Date(), days)) : "9999";
    return state.events.filter(e => e.date >= t && e.date < end && visibleFor(who(e))).sort(sortEv);
  }
  function renderCal() {
    $$(".mtitle").forEach(x => x.textContent = `${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`);
    renderMonth($("mini-month"), false); renderMonth($("big-month"), true);
    // home list
    $("tab-ev").setAttribute("aria-selected", String(homeTab==="ev")); $("tab-di").setAttribute("aria-selected", String(homeTab==="di"));
    const hl = $("home-list"); hl.replaceChildren();
    if (homeTab === "ev") {
      const list = selDay ? state.events.filter(e => e.date === selDay && visibleFor(who(e))).sort(sortEv) : upcoming(7);
      $("home-sub").textContent = selDay ? `${fmtDay(selDay)} · ${list.length}건` : `오늘부터 7일 · ${list.length}건`;
      list.forEach(e => hl.append(evRow(e)));
      if (!list.length) hl.append(el("div","empty", selDay ? "이 날은 일정이 없어요." : "다가오는 일주일은 일정이 비어 있어요."));
      $("home-more").href = "#calendar"; $("home-add").hidden = false;
    } else {
      const list = [...state.diary].filter(d => !filter || d.by === filter).sort((a,b) => (b.date||"").localeCompare(a.date||"") || b.createdAt - a.createdAt).slice(0,5);
      $("home-sub").textContent = `최근 일기 ${list.length}편`;
      list.forEach(d => hl.append(diaryCard(d, false)));
      if (!list.length) hl.append(el("div","empty","아직 쓴 일기가 없어요. 일기 메뉴에서 오늘 하루를 남겨 보세요."));
      $("home-more").href = "#diary"; $("home-add").hidden = true;
    }
    // calendar view list
    const cl = $("cal-list"); cl.replaceChildren();
    const list = selDay ? state.events.filter(e => e.date === selDay && visibleFor(who(e))).sort(sortEv) : upcoming(0).slice(0,40);
    $("cal-list-h").textContent = selDay ? fmtDay(selDay) : "다가오는 일정"; $("cal-clear").hidden = !selDay;
    list.forEach(e => cl.append(evRow(e, {del:true})));
    if (!list.length) cl.append(el("div","empty", selDay ? "이 날은 일정이 없어요. 오른쪽에서 추가해 보세요." : "아직 일정이 없어요."));
  }
  $$("[data-mnav]").forEach(b => b.onclick = () => { cursor.setMonth(cursor.getMonth() + Number(b.dataset.mnav)); renderCal(); });
  $("tab-ev").onclick = () => { homeTab = "ev"; renderCal(); };
  $("tab-di").onclick = () => { homeTab = "di"; renderCal(); };
  $("cal-clear").onclick = () => { selDay = null; renderCal(); };
  function renderTypeChips() {
    const box = $("ev-types"); box.replaceChildren();
    EV_TYPES.forEach(([id, emo, label]) => { const b = el("button","chip t", `${emo} ${label}`); b.type = "button"; b.setAttribute("aria-pressed", String(evType === id));
      b.onclick = () => { evType = evType === id ? "" : id; renderTypeChips(); }; box.append(b); });
  }
  renderTypeChips();

  function renderWhoChips() {
    const box = $("ev-who"); box.replaceChildren();
    [...evWho].forEach(id => { if (!member(id)) evWho.delete(id); });
    const all = el("button","chip t","가족 전체"); all.type = "button"; all.setAttribute("aria-pressed", String(evWho.size===0));
    all.onclick = () => { evWho.clear(); renderWhoChips(); }; box.append(all);
    sortedMembers().forEach(m => {
      const c = el("button","chip"); c.type = "button"; c.setAttribute("aria-pressed", String(evWho.has(m.id)));
      c.append(avatar(m,true), document.createTextNode(m.name));
      c.onclick = () => { evWho.has(m.id) ? evWho.delete(m.id) : evWho.add(m.id); renderWhoChips(); };
      box.append(c);
    });
  }

  // ---------- weather / side ----------
  function renderWeather() {
    const w = $("weather"); w.replaceChildren();
    const wx = (state.weather.find(d => d.id === "current")) || null;
    const top = el("div","small"); top.style.cssText = "display:flex;align-items:center;gap:6px;justify-content:space-between";
    const tl = el("span"); tl.style.cssText = "display:flex;align-items:center;gap:6px"; tl.append(icon("i-cloud",16), document.createTextNode("오늘 · 내일 날씨"));
    top.append(tl, el("span", null, wx ? "📍 " + wx.place : ""));
    w.append(top);
    const wIcon = (n, size) => icon("w-" + (["sun","partly","cloud","rain","snow","fog","thunder"].includes(n) ? n : "cloud"), size);
    if (wx && wx.now) {
      const nowRow = el("div","w-now");
      nowRow.append(wIcon(wx.now.icon), el("div","big-t", `${wx.now.temp}°`));
      const d = el("div","small"); d.append(el("div", null, `지금 · ${wx.now.sky}`), el("div", null, `체감 ${wx.now.feels}°`));
      nowRow.append(d); w.append(nowRow);
      const days = el("div","w-days");
      [["오늘", wx.today], ["내일", wx.tomorrow]].forEach(([lab, x]) => {
        if (!x) return;
        const b = el("div","w-day"); const h = el("div"); h.style.cssText = "display:flex;align-items:center;gap:4px"; h.append(el("b", null, lab), wIcon(x.icon, 16), document.createTextNode(x.sky));
        const tt = el("div","tt"); tt.append(document.createTextNode(`${x.max}°`), el("span", null, ` / ${x.min}°`));
        b.append(h, tt); days.append(b);
      });
      w.append(days);
      if (wx.tip) w.append(el("div","small", "옷차림 추천: " + wx.tip));
    } else {
      w.append(el("div","big-t","날씨 준비 중"));
      w.append(el("div","small","날씨를 불러오는 중이에요. 잠시 후 다시 확인해 주세요."));
    }
    const t = todayStr(), games = state.events.filter(e => (e.type === "game" || e.game) && e.date >= t).sort(sortEv);
    if (games.length) { const g = games[0]; w.append(el("div","w-game", `⚾ 직관 ${relDay(g.date)} · ${g.title}${g.start ? " " + g.start : ""}`)); }
    const foot = el("div","w-foot");
    const stale = wx && Date.now() - wx.updatedAt > 12 * 3600e3;
    foot.append(el("span", null, wx ? (wx.updatedLabel || "") + (stale ? " · 오래된 정보예요" : "") : ""));
    const a = el("a", null, "기상청 ↗"); a.href = "https://www.weather.go.kr/w/index.do"; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "color:inherit";
    const src = el("span"); if (wx) src.append(document.createTextNode((wx.source || "") + " · ")); src.append(a); foot.append(src);
    w.append(foot);
  }
  function shopRow(s, full) {
    const li = el("li", s.done ? "done" : "");
    const cb = el("input","check"); cb.type = "checkbox"; cb.checked = !!s.done; cb.setAttribute("aria-label", s.item);
    cb.onchange = () => ready() && db.doc("shopping/"+s.id).update({ done: cb.checked }).catch(fail);
    const g = el("div","grow"); g.append(el("div",null,s.item));
    const m = member(s.by); if (full && m) g.append(el("div","meta",`적은 사람: ${m.name}`));
    li.append(cb, g, xBtn(s.item, del("shopping", s.id)));
    return li;
  }
  function renderShopping() {
    const list = [...state.shopping].sort((a,b) => (a.done-b.done) || (a.createdAt-b.createdAt));
    const hs = $("home-shop"); hs.replaceChildren();
    const open = list.filter(s => !s.done);
    open.slice(0,5).forEach(s => hs.append(shopRow(s,false)));
    if (open.length > 5) hs.append(el("li","meta",`외 ${open.length-5}개`));
    if (!open.length) hs.append(el("li","empty","아직 부탁한 게 없어요. 먹고 싶은 걸 적어 봐요!"));
    const fs = $("shop-full"); fs.replaceChildren();
    list.forEach(s => fs.append(shopRow(s,true)));
    if (!list.length) fs.append(el("li","empty","떨어진 물건이 생기면 바로 적어 두세요."));
    $("sh-clear").hidden = !list.some(s => s.done);
  }

  // ---------- people ----------
  function jersey(m) {
    const j = el("div","jersey");
    const n = el("div","num", m.number != null && m.number !== "" ? m.number : m.name.slice(0,1)); n.style.color = colorVar(m);
    const w = el("div","who"); w.append(el("strong",null,m.name), el("span",null, (m.kind==="parent"?"어른":"아이") + (m.id===me ? " · 이 기기" : "")));
    j.append(n, w);
    if (m.kind !== "parent") { const b = el("a","jbal"); b.href = "#money"; b.append(el("span",null,"용돈"), el("strong",null, won(balanceOf(m.id)))); j.append(b); }
    return j;
  }
  function choreRow(c) {
    const li = el("li", c.done ? "done" : "");
    const cb = el("input","check"); cb.type = "checkbox"; cb.checked = !!c.done; cb.setAttribute("aria-label", c.title);
    cb.onchange = () => ready() && db.doc("chores/"+c.id).update({ done: cb.checked, doneBy: cb.checked ? (me||"") : "", doneAt: cb.checked ? Date.now() : 0 }).catch(fail);
    const g = el("div","grow"); const t = el("div"); if (c.daily) t.append(el("span","badge","매일")); t.append(c.title); g.append(t);
    if (c.done) { const by = member(c.doneBy); g.append(el("div","meta",`${by ? by.name : "누군가"} 완료 · ${ago(c.doneAt)}`)); }
    li.append(cb, g, xBtn(c.title, del("chores", c.id)));
    return li;
  }
  const catCls = c => c === "준비물" ? "prep" : c === "체크 항목" ? "chk" : "ann";
  function noticeRow(n) {
    const li = el("li", n.done ? "done" : "");
    const cb = el("input","check"); cb.type = "checkbox"; cb.checked = !!n.done; cb.setAttribute("aria-label", n.title);
    cb.onchange = () => ready() && db.doc("notices/"+n.id).update({ done: cb.checked }).catch(fail);
    const g = el("div","grow"); const line = el("div"); line.append(el("span","cat "+catCls(n.category), n.category), document.createTextNode(n.title)); g.append(line);
    if (n.date) g.append(el("div","meta", `${fmtDay(n.date)}까지`));
    li.append(cb, g, xBtn(n.title, del("notices", n.id)));
    return li;
  }
  const choresOf = id => state.chores.filter(c => c.memberId === id).sort((a,b) => (a.done-b.done) || (b.createdAt-a.createdAt));
  const noticesOf = id => state.notices.filter(n => n.memberId === id).sort((a,b) => (a.done-b.done) || ((a.date||"9").localeCompare(b.date||"9")));
  function secHead(ic, label, count, href) {
    const h = el("div","sec-h"); const l = el("span","l"); l.append(icon(ic,18), document.createTextNode(label));
    const r = el("a","more"); r.href = href; r.append(el("span","pill",count), icon("i-right",16));
    h.append(l, r); return h;
  }
  function renderPeople() {
    const box = $("people"); box.replaceChildren();
    const ms = sortedMembers().filter(m => !filter || m.id === filter);
    ms.forEach(m => {
      const c = el("div","card"); c.append(jersey(m));
      const ch = choresOf(m.id), open = ch.filter(x => !x.done);
      c.append(secHead("i-check","할 일", `${open.length}건 남음`, "#todo"));
      const ul = el("ul","list"); open.slice(0,3).forEach(x => ul.append(choreRow(x)));
      if (!open.length) ul.append(el("li","empty", ch.length ? "오늘 할 일 끝! 잘했어요." : "아직 할 일이 없어요."));
      c.append(ul);
      if (m.kind !== "parent") {
        c.append(el("hr","sep"));
        const ns = noticesOf(m.id), nOpen = ns.filter(x => !x.done);
        c.append(secHead("i-bag","가정통신문", `${nOpen.length}건`, "#school"));
        const ul2 = el("ul","list"); nOpen.slice(0,3).forEach(x => ul2.append(noticeRow(x)));
        if (!nOpen.length) ul2.append(el("li","empty","챙길 통신문이 없어요."));
        c.append(ul2);
      }
      box.append(c);
    });
    // todo columns
    const tc = $("todo-cols"); tc.replaceChildren();
    const shared = state.chores.filter(c => !c.memberId || !member(c.memberId));
    const cols = sortedMembers().filter(m => !filter || m.id === filter).map(m => [m, choresOf(m.id)]);
    if (!filter || shared.length) cols.push([null, shared.sort((a,b) => (a.done-b.done) || (b.createdAt-a.createdAt))]);
    cols.forEach(([m, list]) => {
      const c = el("div","card");
      if (m) c.append(jersey(m)); else { const j = el("div","jersey"); const n = el("div","num","★"); n.style.color = "var(--red)"; const w = el("div","who"); w.append(el("strong",null,"누구든"), el("span",null,"먼저 하는 사람이 체크")); j.append(n,w); c.append(j); }
      const ul = el("ul","list lined"); list.forEach(x => ul.append(choreRow(x)));
      if (!list.length) ul.append(el("li","empty","할 일이 없어요."));
      c.append(ul); tc.append(c);
    });
    // school columns
    const sc = $("school-cols"); sc.replaceChildren();
    const ks = kids().filter(m => !filter || m.id === filter);
    ks.forEach(m => {
      const c = el("div","card"); c.append(jersey(m));
      const ul = el("ul","list lined"); const ns = noticesOf(m.id); ns.forEach(x => ul.append(noticeRow(x)));
      if (!ns.length) ul.append(el("li","empty","가정통신문을 받으면 위에서 추가해 주세요."));
      c.append(ul); sc.append(c);
    });
    if (!ks.length) sc.append(el("div","empty","아이로 등록된 가족이 없어요. 가족 메뉴에서 ‘아이’로 등록해 주세요."));
  }
  function fillSelect(sel, opts, allLabel) {
    const prev = sel.value; sel.replaceChildren();
    if (allLabel) sel.append(new Option(allLabel, ""));
    opts.forEach(m => sel.append(new Option(m.name, m.id)));
    sel.value = opts.some(m => m.id === prev) ? prev : (filter && opts.some(m => m.id === filter) ? filter : (allLabel ? "" : (opts[0]?.id || "")));
  }

  // ---------- diary ----------
  function diaryCard(d, withDel) {
    const c = el("div","diary"), m = member(d.by);
    const hd = el("div","hd"); hd.append(avatar(m,true));
    const t = el("div","grow"); t.append(el("strong",null, m ? m.name : "가족"), el("span","meta", "  " + (d.date ? fmtDay(d.date) : ago(d.createdAt))));
    hd.append(t);
    const mood = MOODS.find(x => x[0] === d.mood); if (mood) { const b = el("span","mood", mood[0]); b.style.background = mood[1]; hd.append(b); }
    if (withDel) hd.append(xBtn("일기", del("diary", d.id)));
    c.append(hd, el("div","t", d.text));
    return c;
  }
  function renderDiary() {
    const mb = $("di-mood"); mb.replaceChildren();
    MOODS.forEach(([n]) => { const b = el("button","chip t", n); b.type = "button"; b.setAttribute("aria-pressed", String(diMood===n)); b.onclick = () => { diMood = n; renderDiary(); }; mb.append(b); });
    const list = [...state.diary].filter(d => !filter || d.by === filter).sort((a,b) => (b.date||"").localeCompare(a.date||"") || b.createdAt - a.createdAt);
    $("di-count").textContent = `${list.length}편`;
    const box = $("di-list"); box.replaceChildren();
    list.forEach(d => box.append(diaryCard(d, true)));
    if (!list.length) box.append(el("div","empty","첫 일기를 써 보세요. 기분은 홈런부터 삼진까지 골라요."));
  }

  // ---------- 수다방 (family chat) ----------
  const STICKERS = ["💖","😆","👍","🥹","🎉","😴","🍗","⚾","🐱","🌈"];
  function sendMsg(text, sticker) {
    if (!ready()) return Promise.resolve();
    return db.collection("messages").add({ text, sticker: !!sticker, by: me || "", hearts: [], createdAt: Date.now() }).then(async () => {
      if (state.messages.length >= 150) {
        const old = [...state.messages].sort((a,b) => a.createdAt - b.createdAt).slice(0, state.messages.length - 149);
        for (const o of old) await db.doc("messages/"+o.id).delete();
      }
    }).catch(fail);
  }
  function toggleHeart(mg) {
    if (!ready()) return;
    if (!member(me)) return toast("가족 메뉴에서 ‘이 기기는 나’를 먼저 눌러 주세요.");
    const h = new Set(mg.hearts || []); h.has(me) ? h.delete(me) : h.add(me);
    db.doc("messages/"+mg.id).update({ hearts: [...h] }).catch(fail);
  }
  function renderMsgs() {
    const list = [...state.messages].sort((a,b) => a.createdAt - b.createdAt);
    $("msg-count").textContent = list.length ? `수다 ${list.length}개` : "";
    [["home-msgs", list.slice(-5)], ["board-msgs", list]].forEach(([id, l]) => {
      const box = $(id); box.replaceChildren();
      let lastDay = null, lastBy = null;
      l.forEach(mg => {
        const d = new Date(mg.createdAt), dayKey = ymd(d);
        if (id === "board-msgs" && dayKey !== lastDay) { box.append(el("div","chat-day", fmtDay(dayKey))); lastDay = dayKey; lastBy = null; }
        const mine = !!me && mg.by === me, m = member(mg.by);
        const row = el("div","chat-row" + (mine ? " mine" : ""));
        const cont = lastBy === mg.by;
        if (!mine) { const a = avatar(m); if (cont) a.style.visibility = "hidden"; row.append(a); }
        const col = el("div","chat-col");
        if (!mine && !cont) col.append(el("div","chat-name", m ? m.name : "가족"));
        const line = el("div","chat-line");
        const b = el("div","chat-bubble" + (mg.sticker ? " sticker" : ""));
        if (!mg.sticker && !mine && m) b.style.setProperty("--who", colorVar(m));
        b.append(el("span","t", mg.text));
        b.ondblclick = () => toggleHeart(mg);
        const side = el("div","chat-side");
        const hearts = (mg.hearts || []).length;
        const hb = el("button","heart" + ((mg.hearts||[]).includes(me) ? " on" : ""), hearts ? `♥ ${hearts}` : "♡");
        hb.type = "button"; hb.setAttribute("aria-label","하트 누르기"); hb.onclick = () => toggleHeart(mg);
        side.append(hb, el("span","chat-time", `${d.getHours() < 12 ? "오전" : "오후"} ${((d.getHours()+11)%12)+1}:${pad(d.getMinutes())}`));
        if (mine) { const x = xBtn("메시지", del("messages", mg.id)); x.classList.add("chat-x"); side.append(x); }
        line.append(b, side);
        col.append(line); row.append(col); box.append(row);
        lastBy = mg.by;
      });
      if (!l.length) box.append(el("div","empty chat-empty","첫 수다를 시작해 보세요! 아래 스티커를 눌러도 돼요 💬"));
      box.scrollTop = box.scrollHeight;
    });
  }
  $$(".sticker-row").forEach(row => STICKERS.forEach(s => { const b = el("button","stk", s); b.type = "button"; b.setAttribute("aria-label", s + " 스티커 보내기"); b.onclick = () => sendMsg(s, true); row.append(b); }));

  // ---------- family ----------
  function renderFamily() {
    const box = $("fam-list"); box.replaceChildren();
    const ms = sortedMembers();
    if (!ms.length) box.append(el("div","empty","아직 등록된 가족이 없어요. 아래에서 첫 선수를 등록해 주세요."));
    ms.forEach(m => {
      const r = el("div","fam-row");
      const num = el("input"); num.type = "number"; num.min = 0; num.max = 99; num.value = m.number ?? ""; num.style.width = "70px"; num.setAttribute("aria-label", `${m.name} 등번호`); num.id = "num-"+m.id;
      num.onchange = () => ready() && db.doc("members/"+m.id).update({ number: num.value === "" ? "" : Math.max(0, Math.min(99, parseInt(num.value,10)||0)) }).catch(fail);
      const nm = el("input"); nm.value = m.name; nm.maxLength = 12; nm.style.flex = "1 1 100px"; nm.setAttribute("aria-label","이름"); nm.id = "name-"+m.id;
      nm.onchange = () => { const v = nm.value.trim(); if (v && ready()) db.doc("members/"+m.id).update({ name: v }).catch(fail); };
      const sws = el("div","chips");
      for (let i = 0; i < COLORS; i++) { const s = el("button","sw"); s.type = "button"; s.style.background = `var(--m${i})`; s.setAttribute("aria-label",`색 ${i+1}`); s.setAttribute("aria-pressed", String((m.color||0)%COLORS===i)); s.onclick = () => ready() && db.doc("members/"+m.id).update({ color: i }).catch(fail); sws.append(s); }
      const kind = el("button","chip t", m.kind === "parent" ? "어른" : "아이"); kind.type = "button"; kind.title = "눌러서 바꾸기";
      kind.onclick = () => ready() && db.doc("members/"+m.id).update({ kind: m.kind === "parent" ? "child" : "parent" }).catch(fail);
      const mine = el("button","chip t", m.id === me ? "✓ 이 기기 주인" : "이 기기는 나"); mine.type = "button"; mine.setAttribute("aria-pressed", String(m.id === me));
      mine.onclick = () => { me = m.id; store("fam-me", me); renderAll(); toast(`이 기기는 이제 ${m.name}의 기기예요`); };
      r.append(avatar(m), nm, num, kind, sws, mine, xBtn(m.name, del("members", m.id)));
      box.append(r);
    });
  }

  // ---------- status ----------
  function renderStatus() {
    const st = $("status");
    if (!db) return;
    st.replaceChildren();
    if (!state.members.length) {
      st.append(el("b",null,"처음 오셨네요. "), document.createTextNode("가족 메뉴에서 선수(가족)를 먼저 등록해 주세요. 각자 휴대폰에서 이 링크를 열고 ‘이 기기는 나’를 누르면 준비 끝이에요."));
      const r = el("div","row");
      const a = el("a","btn","가족 등록하러 가기"); a.href = "#family"; a.style.textDecoration = "none";
      const b = el("button","btn ghost","예시 데이터로 둘러보기"); b.type = "button"; b.onclick = seedExamples;
      r.append(a, b); st.append(r); st.hidden = false;
    } else if (!member(me)) {
      st.append(el("b",null,"이 기기는 누구 건가요? "), document.createTextNode("가족 메뉴에서 ‘이 기기는 나’를 눌러 주세요. 내가 쓴 글과 내 할 일이 표시돼요."));
      const r = el("div","row"); const a = el("a","btn navy","가족 메뉴 열기"); a.href = "#family"; a.style.textDecoration = "none"; r.append(a); st.append(r); st.hidden = false;
    } else st.hidden = true;
  }

  function renderAll() {
    $("today-date").textContent = fmtDay(todayStr());
    renderFilter(); renderWhoChips();
    fillSelect($("ch-who"), sortedMembers(), "누구든");
    fillSelect($("no-who"), kids(), null);
    renderCal(); renderWeather(); renderShopping(); renderPeople(); renderDiary(); renderMsgs(); renderMoney(); renderFamily(); renderStatus(); checkPop();
  }

  // ---------- forms ----------
  const guard = fn => async ev => { ev.preventDefault(); if (!ready()) return; try { await fn(ev.currentTarget); } catch(e) { fail(e); } };
  $("f-ev").addEventListener("submit", guard(async () => {
    const title = $("ev-title").value.trim(), date = $("ev-date").value; if (!title || !date) return;
    const data = { title, date, start: $("ev-start").value || "", end: $("ev-end").value || "", memberIds: [...evWho], type: evType, game: evType === "game", by: me || "", createdAt: Date.now() };
    $("ev-title").value = ""; $("ev-start").value = ""; $("ev-end").value = ""; evType = ""; renderTypeChips();
    await db.collection("events").add(data); toast("일정을 추가했어요");
  }));
  $("f-ch").addEventListener("submit", guard(async () => {
    const title = $("ch-title").value.trim(); if (!title) return; $("ch-title").value = ""; setTimeout(() => $("ch-daily").setAttribute("aria-pressed","false"));
    await db.collection("chores").add({ title, memberId: $("ch-who").value, daily: $("ch-daily").getAttribute("aria-pressed") === "true", done: false, doneBy: "", doneAt: 0, createdAt: Date.now() });
  }));
  $("f-no").addEventListener("submit", guard(async () => {
    const title = $("no-title").value.trim(), memberId = $("no-who").value; if (!title) return;
    if (!memberId) return toast("먼저 가족 메뉴에서 아이를 등록해 주세요.");
    $("no-title").value = "";
    await db.collection("notices").add({ title, category: $("no-cat").value, date: $("no-date").value || "", memberId, done: false, createdAt: Date.now() });
  }));
  $("f-di").addEventListener("submit", guard(async () => {
    const text = $("di-text").value.trim(); if (!text) return;
    await db.collection("diary").add({ text, date: $("di-date").value || todayStr(), mood: diMood, by: me || "", createdAt: Date.now() });
    $("di-text").value = ""; toast("일기를 저장했어요");
  }));
  $("f-mem").addEventListener("submit", guard(async () => {
    const name = $("mem-name").value.trim(); if (!name) return;
    const used = new Set(state.members.map(m => m.color));
    const color = [...Array(COLORS).keys()].find(i => !used.has(i)) ?? state.members.length % COLORS;
    const nv = $("mem-num").value;
    const ref = await db.collection("members").add({ name, number: nv === "" ? "" : Math.max(0, Math.min(99, parseInt(nv,10)||0)), kind: $("mem-kind").value, color, createdAt: Date.now() });
    $("mem-name").value = ""; $("mem-num").value = "";
    if (!member(me)) { me = ref.id; store("fam-me", me); }
    renderAll();
    toast(`${name} 선수 등록 완료`);
  }));
  $$('form[data-form="shop"]').forEach(f => f.addEventListener("submit", guard(async form => {
    const inp = form.querySelector("input"), item = inp.value.trim(); if (!item) return; inp.value = "";
    await db.collection("shopping").add({ item, done: false, by: me || "", createdAt: Date.now() });
  })));
  $$('form[data-form="msg"]').forEach(f => f.addEventListener("submit", ev => {
    ev.preventDefault(); const inp = f.querySelector("input"), text = inp.value.trim(); if (!text) return; inp.value = ""; sendMsg(text, false);
  }));
  $("sh-clear").onclick = async () => { if (!ready()) return; for (const s of state.shopping.filter(s => s.done)) { try { await db.doc("shopping/"+s.id).delete(); } catch(e) { fail(e); break; } } };

  async function seedExamples() {
    if (!ready()) return;
    const n = Date.now(), t = new Date(), X = { example: true };
    const add = (c, d) => db.collection(c).add({ ...d, ...X });
    const ppl = [["엄마",1,"parent",77],["아빠",2,"parent",10],["하늘",0,"child",1],["별이",3,"child",7]];
    const ids = [];
    for (const [name,color,kind,number] of ppl) ids.push((await add("members",{ name: name+" (예시)", color, kind, number, createdAt: n })).id);
    const evs = [[0,"18:30","19:30","가족 저녁 식사",[],false],[1,"16:00","16:30","도서관 책 반납",[ids[2]],false],[2,"18:30","21:30","사직 야구장 직관",[],true],[4,"10:30","11:20","학교 독서 발표",[ids[3]],false]];
    for (const [d,start,end,title,memberIds,game] of evs) await add("events",{ title, date: ymd(addDays(t,d)), start, end, memberIds, game, by: ids[0], createdAt: n });
    for (const [title,mi] of [["수학 익힘 48–51쪽",2],["하루 15분 책 읽기",2],["독서 카드에 감상 한 줄",3],["저녁에 책상 정리",3],["아침 약 먹기 💊",0],["분리수거 내놓기",1]]) await add("chores",{ title, memberId: ids[mi], daily: title.includes("약"), done: false, doneBy: "", doneAt: 0, createdAt: n });
    for (const [title,cat,mi] of [["미술 시간 색종이·풀","준비물",2],["가을 현장학습 안내","학교 공지",2],["현장학습 참가 여부 확인","체크 항목",3]]) await add("notices",{ title, category: cat, date: ymd(addDays(t,3)), memberId: ids[mi], done: false, createdAt: n });
    for (const item of ["우유 2개","계란 한 판","응원용 막대풍선"]) await add("shopping",{ item, done: false, by: ids[0], createdAt: n });
    await add("diary",{ text: "오늘 도서관에서 야구 만화책을 빌렸다. 주말 직관이 기다려진다!", date: todayStr(), mood: "홈런", by: ids[2], createdAt: n });
    await add("messages",{ text: "토요일 직관 가는 사람 저녁 6시까지 준비!", by: ids[1], hearts: [ids[2]], createdAt: n - 600e3 });
    await add("messages",{ text: "나 갈래!! 막대풍선 챙겨갈게", by: ids[2], hearts: [ids[1], ids[0]], createdAt: n - 300e3 });
    await add("messages",{ text: "🎉", sticker: true, by: ids[3], hearts: [], createdAt: n - 120e3 });
    await add("allowance",{ to: ids[2], from: ids[0], amount: 10000, kind: "in", memo: "11월 용돈", seen: true, createdAt: n - 864e5 * 5 });
    await add("allowance",{ to: ids[2], from: ids[2], amount: -3500, kind: "out", memo: "문구점 색종이·풀", seen: true, createdAt: n - 864e5 * 2 });
    await add("allowance",{ to: ids[3], from: ids[1], amount: 5000, kind: "in", memo: "독서 발표 준비 잘했어!", seen: true, createdAt: n - 3600e3 });
    if (!member(me)) { me = ids[0]; store("fam-me", me); }
    renderAll();
    toast("예시 데이터를 넣었어요. ‘(예시)’ 가족을 지우면 정리돼요.");
  }

  // ---------- weather (Open-Meteo, straight from the browser) ----------
  const PLACE = { name: "일산서구 탄현동", lat: 37.6935, lon: 126.77 };
  function wmo(code) {
    if (code === 0) return ["맑음","sun"];
    if (code === 1) return ["대체로 맑음","partly"];
    if (code === 2) return ["구름 조금","partly"];
    if (code === 3) return ["흐림","cloud"];
    if (code === 45 || code === 48) return ["안개","fog"];
    if (code >= 95) return ["뇌우","thunder"];
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ["눈","snow"];
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ["비","rain"];
    return ["구름","cloud"];
  }
  function outfit(lo, hi, wet) {
    const avg = (lo + hi) / 2;
    let t = avg >= 28 ? "민소매, 반바지처럼 아주 가볍게" : avg >= 23 ? "반팔, 얇은 셔츠" : avg >= 20 ? "얇은 가디건, 긴팔" : avg >= 17 ? "얇은 니트나 맨투맨"
      : avg >= 12 ? "자켓, 가디건, 맨투맨" : avg >= 9 ? "트렌치코트나 야상, 니트" : avg >= 5 ? "코트, 히트텍, 니트" : "패딩, 목도리, 장갑 꼭 챙기기";
    if (hi - lo >= 10) t += " · 일교차가 커요";
    if (wet) t += " · 우산 챙기기";
    return t;
  }
  function metSky(code) {
    const c = (code || "").split("_")[0];
    if (c.includes("thunder")) return ["뇌우","thunder"];
    if (c.includes("sleet") || c.includes("snow")) return [c.includes("sleet") ? "진눈깨비" : "눈","snow"];
    if (c.includes("rain")) return ["비","rain"];
    if (c === "fog") return ["안개","fog"];
    if (c === "cloudy") return ["흐림","cloud"];
    if (c === "partlycloudy") return ["구름 조금","partly"];
    if (c === "fair") return ["대체로 맑음","partly"];
    if (c === "clearsky") return ["맑음","sun"];
    return ["구름","cloud"];
  }
  const kstParts = t => { const d = new Date(new Date(t).getTime() + 9 * 3600e3); return { day: d.toISOString().slice(0,10), hour: d.getUTCHours() }; };
  async function fetchMet() {
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${PLACE.lat.toFixed(2)}&lon=${PLACE.lon.toFixed(2)}`);
    if (!r.ok) throw new Error("met " + r.status);
    const ts = (await r.json()).properties.timeseries;
    const nowMs = Date.now();
    const cur = ts.reduce((a, b) => Math.abs(new Date(b.time) - nowMs) < Math.abs(new Date(a.time) - nowMs) ? b : a);
    const det = cur.data.instant.details;
    const nx = cur.data.next_1_hours || cur.data.next_6_hours || {};
    const [nowSky, nowIcon] = metSky(nx.summary && nx.summary.symbol_code);
    const today = kstParts(nowMs).day, tomorrow = kstParts(nowMs + 864e5).day;
    const day = d => {
      const temps = [], codes = [];
      ts.forEach(t => { const p = kstParts(t.time); if (p.day !== d) return; temps.push(t.data.instant.details.air_temperature);
        const n = t.data.next_6_hours || t.data.next_1_hours; if (n && p.hour >= 6 && p.hour <= 21) codes.push(n.summary.symbol_code); });
      if (!temps.length) return null;
      const wetCodes = codes.filter(c => /rain|snow|sleet|thunder/.test(c));
      const counts = {}; codes.forEach(c => { const k = c.split("_")[0]; counts[k] = (counts[k] || 0) + 1; });
      const main = wetCodes[0] || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
      const [sky, icon] = metSky(main);
      return { max: Math.round(Math.max(...temps)), min: Math.round(Math.min(...temps)), sky, icon, wet: wetCodes.length > 0 };
    };
    const t = Math.round(det.air_temperature), v = (det.wind_speed || 0) * 3.6;
    const feels = det.air_temperature <= 10 && v > 4.8 ? Math.round(13.12 + 0.6215 * det.air_temperature - 11.37 * v ** 0.16 + 0.3965 * det.air_temperature * v ** 0.16) : t;
    const td = day(today) || { max: t, min: t, sky: nowSky, icon: nowIcon, wet: false };
    td.max = Math.max(td.max, t); td.min = Math.min(td.min, t);
    return { now: { temp: t, feels, sky: nowSky, icon: nowIcon, humidity: Math.round(det.relative_humidity || 0) }, today: td, tomorrow: day(tomorrow), source: "MET Norway" };
  }
  async function fetchOpenMeteo() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FSeoul&forecast_days=2`;
    const r = await fetch(url); if (!r.ok) throw new Error("weather " + r.status);
    const j = await r.json(), c = j.current, d = j.daily;
    const day = i => { const [sky, ic] = wmo(d.weather_code[i]); const wet = ic === "rain" || ic === "snow" || ic === "thunder" || (d.precipitation_probability_max[i] || 0) >= 50; return { max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), sky, icon: ic, wet }; };
    const [nowSky, nowIcon] = wmo(c.weather_code);
    return { now: { temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), sky: nowSky, icon: nowIcon, humidity: c.relative_humidity_2m }, today: day(0), tomorrow: day(1), source: "Open-Meteo" };
  }
  async function loadWeather() {
    try {
      const cached = JSON.parse(localStorage.getItem("fam-weather") || "null");
      if (cached) { state.weather = [cached]; renderWeather(); }
      if (cached && Date.now() - cached.updatedAt < 30 * 60000) return;
    } catch (e) {}
    let w = null;
    for (const f of [fetchMet, fetchOpenMeteo]) { try { w = await f(); break; } catch (e) { console.warn(e); } }
    if (!w) return;
    const now = new Date();
    const wx = { id: "current", place: PLACE.name, updatedAt: Date.now(), updatedLabel: `${pad(now.getHours())}:${pad(now.getMinutes())} 기준`, ...w, tip: outfit(w.today.min, w.today.max, w.today.wet) };
    state.weather = [wx]; store("fam-weather", JSON.stringify(wx)); renderWeather();
  }

  // ---------- allowance ----------
  const balanceOf = id => state.allowance.filter(a => a.to === id).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  let moneyAmt = 5000;
  function renderMoney() {
    const ks = kids();
    // balance cards
    const cards = $("money-cards"); cards.replaceChildren();
    ks.filter(m => !filter || m.id === filter).forEach(m => {
      const c = el("div","card money-card");
      const top = el("div","mc-top"); top.append(avatar(m), el("strong", null, m.name));
      const bal = el("div","mc-bal", won(balanceOf(m.id)));
      const last = state.allowance.filter(a => a.to === m.id).sort((a,b) => b.createdAt - a.createdAt)[0];
      c.append(top, el("div","meta","지금 가진 용돈"), bal, el("div","meta", last ? `최근: ${last.memo || (last.amount > 0 ? "용돈" : "사용")} ${last.amount > 0 ? "+" : ""}${won(last.amount)}` : "아직 기록이 없어요"));
      cards.append(c);
    });
    if (!ks.length) cards.append(el("div","empty","가족 메뉴에서 아이를 ‘아이’로 등록하면 용돈 통장이 생겨요."));
    // selects + chips
    fillSelect($("mo-to"), ks, null); fillSelect($("sp-who"), ks, null);
    $$("#mo-quick button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.amt) === moneyAmt && $("mo-amt").value == moneyAmt)));
    // history
    const hist = $("money-hist"); hist.replaceChildren();
    const list = [...state.allowance].filter(a => !filter || a.to === filter).sort((a,b) => b.createdAt - a.createdAt).slice(0, 60);
    list.forEach(a => {
      const li = el("li"), to = member(a.to), from = member(a.from);
      li.append(avatar(to, true));
      const g = el("div","grow"); g.append(el("div", null, a.memo || (a.amount > 0 ? "용돈" : "사용")));
      g.append(el("div","meta", `${to ? to.name : "?"} · ${a.amount > 0 ? (from ? "보낸 사람 " + from.name : "입금") : "씀"} · ${ago(a.createdAt)}`));
      li.append(g, el("span", "amt " + (a.amount > 0 ? "plus" : "minus"), (a.amount > 0 ? "+" : "") + won(a.amount)));
      li.append(xBtn("용돈 기록", del("allowance", a.id)));
      hist.append(li);
    });
    if (!list.length) hist.append(el("li","empty","용돈을 보내면 여기에 통장처럼 쌓여요."));
    $("noti-btn").hidden = !("Notification" in window) || Notification.permission === "granted";
  }
  $$("#mo-quick button").forEach(b => b.onclick = () => { moneyAmt = Number(b.dataset.amt); $("mo-amt").value = moneyAmt; renderMoney(); });
  $("f-money").addEventListener("submit", guard(async () => {
    const to = $("mo-to").value, amount = Math.round(Number($("mo-amt").value));
    if (!to) return toast("먼저 아이를 등록해 주세요.");
    if (!(amount > 0)) return toast("보낼 금액을 적어 주세요.");
    const memo = $("mo-memo").value.trim();
    await db.collection("allowance").add({ to, from: me || "", amount, kind: "in", memo, seen: false, createdAt: Date.now() });
    $("mo-memo").value = "";
    const m = member(to); toast(`${m ? m.name : ""}에게 ${won(amount)} 보냈어요 💌`);
  }));
  $("f-spend").addEventListener("submit", guard(async () => {
    const to = $("sp-who").value, amount = Math.round(Number($("sp-amt").value));
    if (!to || !(amount > 0)) return toast("누가 얼마를 썼는지 적어 주세요.");
    await db.collection("allowance").add({ to, from: to, amount: -amount, kind: "out", memo: $("sp-memo").value.trim(), seen: true, createdAt: Date.now() });
    $("sp-amt").value = ""; $("sp-memo").value = ""; toast("쓴 돈을 기록했어요");
  }));
  $("noti-btn").onclick = async () => { try { const p = await Notification.requestPermission(); toast(p === "granted" ? "알림을 켰어요" : "알림이 꺼져 있어요. 브라우저 설정에서 켤 수 있어요."); } catch (e) {} renderMoney(); };

  // popup for the person who received money
  const shownPop = new Set();
  function checkPop() {
    if (!db || !member(me) || !$("pop").hidden) return;
    const a = state.allowance.filter(x => x.to === me && x.from !== me && x.kind === "in" && !x.seen && !shownPop.has(x.id)).sort((x,y) => x.createdAt - y.createdAt)[0];
    if (!a) return;
    shownPop.add(a.id);
    const from = member(a.from);
    $("pop-amt").textContent = won(a.amount);
    $("pop-from").textContent = "용돈이 들어왔어요!";
    $("pop-memo").textContent = "보낸 사람 " + (from ? from.name : "가족") + (a.memo ? ` · “${a.memo}”` : "");
    $("pop-bal").textContent = `지금 내 용돈 ${won(balanceOf(me))}`;
    $("pop").hidden = false; $("pop-ok").focus();
    $("pop-ok").onclick = () => { $("pop").hidden = true; db.doc("allowance/" + a.id).update({ seen: true, seenAt: Date.now() }).catch(console.error); setTimeout(checkPop, 300); };
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try { navigator.serviceWorker?.ready.then(r => r.showNotification("용돈이 들어왔어요 💰", { body: `${from ? from.name : "가족"}: ${won(a.amount)} ${a.memo || ""}`, icon: "icons/icon-192.png", tag: a.id })); } catch (e) {}
    }
  }

  // ---------- connect ----------
  $("ev-date").value = todayStr(); $("di-date").value = todayStr();
  route(); renderAll(); loadWeather();
  $("ch-daily").onclick = e => { const b = e.currentTarget; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); };
  let dayNow = todayStr();
  setInterval(() => { if (todayStr() !== dayNow) { dayNow = todayStr(); if (db) { state.chores = pull(db, "chores"); renderAll(); } } }, 60000);

  async function connect(key, allowNew) {
    const st = await window.createFamilyStore(CFG, key, () => {
      NAMES.forEach(n => state[n] = pull(st, n));
      if (db) renderAll();
    });
    const n = await st.loadAll();
    NAMES.forEach(nm => state[nm] = pull(st, nm));
    if (n === 0 && !allowNew) return "empty";
    db = st; store("fam-key", key); renderAll();
    return "ok";
  }
  function showGate(msg) {
    $("gate").hidden = false; $("gate-msg").textContent = msg || ""; $("gate-new").hidden = true; $("gate-key").focus();
  }
  $("f-gate").addEventListener("submit", async ev => {
    ev.preventDefault();
    const key = $("gate-key").value.trim();
    if (key.length < 4) return showGate("비밀번호는 4글자 이상으로 정해 주세요.");
    $("gate-msg").textContent = "확인하는 중…";
    try {
      const r = await connect(key, false);
      if (r === "empty") { $("gate-msg").textContent = ""; $("gate-new").hidden = false; return; }
      $("gate").hidden = true;
    } catch (e) { console.error(e); showGate("연결하지 못했어요. 인터넷 연결을 확인해 주세요."); }
  });
  $("gate-create").onclick = async () => {
    try { await connect($("gate-key").value.trim(), true); $("gate").hidden = true; toast("우리 가족 보드를 만들었어요!"); }
    catch (e) { console.error(e); showGate("만들지 못했어요. 잠시 후 다시 해 주세요."); }
  };
  $("gate-retry").onclick = () => { $("gate-new").hidden = true; $("gate-key").select(); };
  $("logout").onclick = () => { try { localStorage.removeItem("fam-key"); } catch (e) {} location.reload(); };

  (async () => {
    if (!CFG.url || !CFG.anonKey) { showGate("아직 저장 공간(Supabase)이 연결되지 않았어요. config.js를 채워 주세요."); $("f-gate").hidden = true; return; }
    let key = null; try { key = localStorage.getItem("fam-key"); } catch (e) {}
    if (!key) return showGate();
    try { const r = await connect(key, true); if (r !== "ok") showGate(); }
    catch (e) { console.error(e); showGate("연결하지 못했어요. 다시 시도해 주세요."); }
  })();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && db) db.loadAll().catch(console.error); });
  setInterval(() => { if (db && !document.hidden) db.loadAll().catch(console.error); }, 60000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  setInterval(() => { renderCal(); loadWeather(); }, 30 * 60000);
})();
