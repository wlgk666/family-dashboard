(() => {
  const $ = id => document.getElementById(id);
  const $$ = s => [...document.querySelectorAll(s)];
  const COLORS = 6;
  const DOW = ["일","월","화","수","목","금","토"];
  const MOODS = [["홈런","var(--m0)"],["안타","var(--m4)"],["볼넷","var(--m3)"],["삼진","var(--m1)"]];
  const NAMES = ["members","events","chores","notices","diary","shopping","messages","allowance","push"];
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
  const isAdult = m => m.kind === "parent" || m.kind === "grand";
  const KIND_LABEL = { parent: "어른", grand: "조부모", child: "아이" };
  const kindLabel = m => KIND_LABEL[m.kind] || "아이";
  const sortedMembers = () => [...state.members].sort((a,b) => (isAdult(a)-isAdult(b)) || ((a.kind==="grand")-(b.kind==="grand")) || ((a.createdAt||0)-(b.createdAt||0)));
  const kids = () => sortedMembers().filter(m => !isAdult(m));
  // 조부모 기기는 간단 화면: 일정 · 수다방 · 용돈 보내기만, 글씨 크게
  const SIMPLE_VIEWS = ["calendar","allchat","money","family"];
  const isSimple = () => { const m = state.members.find(x => x.id === me); return !!m && m.kind === "grand"; };
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
  const VIEWS = ["home","calendar","diary","todo","money","board","allchat","family"];
  function route() {
    let v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    if (isSimple() && v === "board") v = "allchat";
    if (isSimple() && !SIMPLE_VIEWS.includes(v)) v = "calendar";
    const sec = v === "allchat" ? "board" : v; // 온가족방 uses the same chat screen
    if (sec === "board") { room = v === "allchat" ? "all" : "home"; renderMsgs(); }
    $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== sec);
    $$("#nav a, #more-sheet a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
    const mb = document.getElementById("more-btn"); if (mb) mb.classList.toggle("on", ["allchat","diary","school","money","family"].includes(v));
    const sh = document.getElementById("more-sheet"); if (sh) { sh.hidden = true; mb && mb.setAttribute("aria-expanded","false"); }
    window.scrollTo(0,0);
  }
  addEventListener("hashchange", route);
  // phones: 4 main tabs + 더보기 sheet with the rest
  (() => {
    const sheet = document.getElementById("more-sheet"), btn = document.getElementById("more-btn");
    document.querySelectorAll("#nav a.more-item").forEach(a => sheet.append(a.cloneNode(true)));
    btn.onclick = e => { e.stopPropagation(); const open = sheet.hidden; sheet.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
    sheet.onclick = e => { if (e.target.closest("a")) { sheet.hidden = true; btn.setAttribute("aria-expanded","false"); } };
    document.addEventListener("click", e => { if (!sheet.hidden && !sheet.contains(e.target) && e.target !== btn) { sheet.hidden = true; btn.setAttribute("aria-expanded","false"); } });
  })();

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
    if (e.src === "naver") { const nb = el("span","badge","N"); nb.title = "네이버 캘린더에서 가져온 일정"; nb.style.cssText = "color:#03a94d;background:#e3f7ea"; tt.prepend(nb); }
    if (opts.del) {
      const ed = el("button","x","✎"); ed.type = "button"; ed.setAttribute("aria-label", e.title + " 고치기"); ed.onclick = () => editEvent(e);
      r.append(ed, xBtn(e.title, del("events", e.id)));
    }
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
    const w = el("div","who"); w.append(el("strong",null,m.name), el("span",null, kindLabel(m) + (m.id===me ? " · 이 기기" : "")));
    j.append(n, w);
    if (!isAdult(m)) { const b = el("a","jbal"); b.href = "#money"; b.append(el("span",null,"용돈"), el("strong",null, won(balanceOf(m.id)))); j.append(b); }
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
      if (false && !isAdult(m)) { // 학교생활(가정통신문)은 메뉴에서 뺐어요. 데이터는 남겨 둬요.
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
  // 두 개의 방: "home" = 우리 넷, "all" = 할머니·할아버지까지 온 가족. 조부모 기기는 "all" 만 봐요.
  let room = "home";
  const curRoom = () => isSimple() ? "all" : room;
  const roomOf = mg => mg.room === "all" ? "all" : "home";
  const roomFor = node => node && node.closest('[data-view="board"]') ? curRoom() : "home";
  function sendMsg(text, sticker, photo, rm) {
    if (!ready()) return Promise.resolve();
    const r = rm === "all" ? "all" : "home";
    return db.collection("messages").add({ text, sticker: !!sticker, photo: photo || "", room: r, by: me || "", hearts: [], createdAt: Date.now() }).then(async () => {
      const w = member(me), to = r === "all" ? null : state.members.filter(m => m.kind !== "grand").map(m => m.id);
      notify({ to, except: me || "", title: `${r === "all" ? "💞 온 가족" : "🏠 우리집"} · ${w ? w.name : "가족"}`, body: photo ? "📷 사진을 보냈어요" + (text ? " · " + text : "") : text, url: r === "all" ? "./#allchat" : "./#board", tag: "chat-" + r });
      const inRoom = state.messages.filter(m => roomOf(m) === r);
      if (inRoom.length >= 150) {
        const old = [...inRoom].sort((a,b) => a.createdAt - b.createdAt).slice(0, inRoom.length - 149);
        for (const o of old) { await db.doc("messages/"+o.id).delete(); if (o.photo) await db.doc("photo/"+o.photo).delete().catch(() => {}); }
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
    const all = [...state.messages].sort((a,b) => a.createdAt - b.createdAt), cr = curRoom();
    const list = all.filter(m => roomOf(m) === cr), homeList = all.filter(m => roomOf(m) === "home");
    $("msg-count").textContent = list.length ? `수다 ${list.length}개` : "";
    $("board-title").textContent = cr === "all" ? "온 가족 수다방 💞" : "우리 가족 수다방 💬";
    $$("#room-tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.room === cr)));
    $("board-msg-in").placeholder = cr === "all" ? "할머니·할아버지께 한마디 💞" : "오늘 학교에서 무슨 일 있었어?";
    [["home-msgs", homeList.slice(-5)], ["board-msgs", list]].forEach(([id, l]) => {
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
        const b = el("div","chat-bubble" + (mg.sticker ? " sticker" : "") + (mg.photo ? " photo" : ""));
        if (!mg.sticker && !mg.photo && !mine && m) b.style.setProperty("--who", colorVar(m));
        if (mg.photo && Date.now() - mg.createdAt > PHOTO_DAYS * 864e5) {
          b.classList.remove("photo"); b.classList.add("expired"); b.append(el("span","t", "📷 사진 보관 기간(7일)이 지났어요" + (mg.text ? "\n" + mg.text : "")));
        } else if (mg.photo) {
          const im = el("img"); im.alt = `${m ? m.name : "가족"}이 보낸 사진`; im.decoding = "async";
          db && db.getPhoto(mg.photo).then(src => { if (src) im.src = src; else { im.replaceWith(el("span","t","📷 사진이 지워졌어요")); } });
          im.onclick = () => { if (!im.src) return; $("photo-big").src = im.src; $("photo-view").hidden = false; };
          b.append(im);
          if (mg.text) b.append(el("span","t", mg.text));
        } else b.append(el("span","t", mg.text));
        b.ondblclick = () => toggleHeart(mg);
        const side = el("div","chat-side");
        const hearts = (mg.hearts || []).length;
        const hb = el("button","heart" + ((mg.hearts||[]).includes(me) ? " on" : ""), hearts ? `♥ ${hearts}` : "♡");
        hb.type = "button"; hb.setAttribute("aria-label","하트 누르기"); hb.onclick = () => toggleHeart(mg);
        side.append(hb, el("span","chat-time", `${d.getHours() < 12 ? "오전" : "오후"} ${((d.getHours()+11)%12)+1}:${pad(d.getMinutes())}`));
        if (mine) { const x = xBtn("메시지", del("messages", mg.id)); x.classList.add("chat-x"); if (mg.photo) { const d0 = x.onclick; x.onclick = e => { d0 && d0(e); db && db.doc("photo/"+mg.photo).delete().catch(() => {}); }; } side.append(x); }
        line.append(b, side);
        col.append(line); row.append(col); box.append(row);
        lastBy = mg.by;
      });
      if (!l.length) box.append(el("div","empty chat-empty","첫 수다를 시작해 보세요! 아래 스티커를 눌러도 돼요 💬"));
      box.scrollTop = box.scrollHeight;
    });
  }
  const PHOTO_DAYS = 7;
  // photos: one hidden file input; on iPhone/iPad it offers 사진 보관함 / 사진 찍기 / 파일 선택
  async function shrinkPhoto(file, max = 1280) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return { img: c.toDataURL("image/jpeg", 0.72), w: c.width, h: c.height };
    } finally { URL.revokeObjectURL(url); }
  }
  let photoForm = null;
  $$("form.chat-input").forEach(f => {
    const pb = el("button","photo-btn","📷"); pb.type = "button"; pb.setAttribute("aria-label","사진 보내기");
    pb.onclick = () => { if (!ready()) return; photoForm = f; $("photo-in").value = ""; $("photo-in").click(); };
    f.prepend(pb);
  });
  $("photo-in").onchange = async () => {
    const file = $("photo-in").files[0]; if (!file || !ready()) return;
    const btns = $$(".photo-btn"); btns.forEach(b => b.disabled = true); toast("사진 올리는 중… 📷");
    try {
      const ph = await shrinkPhoto(file);
      const { id } = await db.collection("photo").add({ ...ph, by: me || "", createdAt: Date.now() });
      const inp = photoForm && photoForm.querySelector("input[type=text]"), cap = inp ? inp.value.trim() : "";
      if (inp) inp.value = "";
      await sendMsg(cap, false, id, roomFor(photoForm));
    } catch (e) { console.error(e); toast("사진을 보내지 못했어요. 다시 해 주세요."); }
    btns.forEach(b => b.disabled = false);
  };
  $("photo-view").onclick = () => { $("photo-view").hidden = true; };
  $$(".sticker-row").forEach(row => STICKERS.forEach(s => { const b = el("button","stk", s); b.type = "button"; b.setAttribute("aria-label", s + " 스티커 보내기"); b.onclick = () => sendMsg(s, true, "", roomFor(row)); row.append(b); }));
  $$("#room-tabs button").forEach(b => b.onclick = () => { location.hash = b.dataset.room === "all" ? "#allchat" : "#board"; });

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
      const kind = el("button","chip t", kindLabel(m)); kind.type = "button"; kind.title = "눌러서 바꾸기 (아이 → 어른 → 조부모)";
      kind.onclick = () => ready() && db.doc("members/"+m.id).update({ kind: m.kind === "parent" ? "grand" : m.kind === "grand" ? "child" : "parent" }).catch(fail);
      const mine = el("button","chip t", m.id === me ? "✓ 이 기기 주인" : "이 기기는 나"); mine.type = "button"; mine.setAttribute("aria-pressed", String(m.id === me));
      mine.onclick = () => { me = m.id; store("fam-me", me); renderAll(); syncPush(); toast(`이 기기는 이제 ${m.name}의 기기예요`); };
      const bells = state.push.filter(x => x.memberId === m.id).length;
      r.append(avatar(m), nm, num, kind, sws, mine);
      if (bells) { const b = el("span","pill", `🔔 ${bells}`); b.title = `알림 받는 기기 ${bells}대`; r.append(b); }
      r.append(xBtn(m.name, del("members", m.id)));
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
    const simple = isSimple(), wasSimple = document.body.classList.contains("simple");
    document.body.classList.toggle("simple", simple);
    if (simple !== wasSimple) route();
    $("today-date").textContent = fmtDay(todayStr());
    renderFilter(); renderWhoChips();
    fillSelect($("ch-who"), sortedMembers(), "누구든");
    fillSelect($("no-who"), kids(), null);
    renderCal(); renderWeather(); renderShopping(); renderPeople(); renderDiary(); renderMsgs(); renderMoney(); renderFamily(); renderStatus(); renderPush(); checkPop();
  }

  // ---------- forms ----------
  const guard = fn => async ev => { ev.preventDefault(); if (!ready()) return; try { await fn(ev.currentTarget); } catch(e) { fail(e); } };
  // editing: the form switches to "수정 저장"; imported Naver events become ordinary board events once saved
  let editingEv = null;
  function editEvent(e) {
    editingEv = e.id;
    $("ev-title").value = e.title; $("ev-date").value = e.date; $("ev-start").value = e.start || ""; $("ev-end").value = e.end || "";
    evWho.clear(); who(e).forEach(id => member(id) && evWho.add(id)); renderWhoChips();
    evType = (typeOf(e) || [""])[0]; renderTypeChips();
    $("ev-submit").textContent = "수정 저장"; $("ev-cancel").hidden = false;
    if (location.hash !== "#calendar") location.hash = "#calendar";
    setTimeout(() => { $("f-ev").scrollIntoView({ behavior: "smooth", block: "center" }); $("ev-title").focus(); }, 50);
  }
  function resetEvForm() {
    editingEv = null; $("ev-title").value = ""; $("ev-start").value = ""; $("ev-end").value = ""; evType = ""; renderTypeChips();
    $("ev-submit").textContent = "일정 추가"; $("ev-cancel").hidden = true;
  }
  $("ev-cancel").onclick = resetEvForm;
  $("f-ev").addEventListener("submit", guard(async () => {
    const title = $("ev-title").value.trim(), date = $("ev-date").value; if (!title || !date) return;
    const data = { title, date, start: $("ev-start").value || "", end: $("ev-end").value || "", memberIds: [...evWho], type: evType, game: evType === "game" };
    const id = editingEv; resetEvForm();
    if (id && state.events.some(x => x.id === id)) { await db.doc("events/" + id).update({ ...data, editedAt: Date.now() }); toast("일정을 고쳤어요"); }
    else { await db.collection("events").add({ ...data, by: me || "", createdAt: Date.now() }); toast("일정을 추가했어요"); }
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
    { const w = member(me), adults = state.members.filter(m => m.kind === "parent").map(m => m.id);
      notify({ to: adults, except: me || "", title: "🛒 사 주세요!", body: `${w ? w.name : "가족"}: ${item}`, url: "./#todo", tag: "shop" }); }
  })));
  $$('form[data-form="msg"]').forEach(f => f.addEventListener("submit", ev => {
    ev.preventDefault(); const inp = f.querySelector("input"), text = inp.value.trim(); if (!text) return; inp.value = ""; sendMsg(text, false, "", roomFor(f));
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
    fillSelect($("mo-to"), ks, null); fillSelect($("sp-who"), ks, null); fillSelect($("in-who"), ks, null);
    $$("#mo-quick button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.amt) === moneyAmt && $("mo-amt").value == moneyAmt)));
    // history
    const hist = $("money-hist"); hist.replaceChildren();
    const list = [...state.allowance].filter(a => !filter || a.to === filter).sort((a,b) => b.createdAt - a.createdAt).slice(0, 60);
    list.forEach(a => {
      const li = el("li"), to = member(a.to), from = member(a.from);
      li.append(avatar(to, true));
      const g = el("div","grow"); g.append(el("div", null, a.memo || (a.amount > 0 ? "용돈" : "사용")));
      g.append(el("div","meta", `${to ? to.name : "?"} · ${a.kind === "init" ? "잔액 맞춤" : a.amount > 0 ? (from ? "보낸 사람 " + from.name : "입금") : "씀"} · ${ago(a.createdAt)}`));
      li.append(g, el("span", "amt " + (a.amount > 0 ? "plus" : "minus"), (a.amount > 0 ? "+" : "") + won(a.amount)));
      li.append(xBtn("용돈 기록", del("allowance", a.id)));
      hist.append(li);
    });
    if (!list.length) hist.append(el("li","empty","용돈을 보내면 여기에 통장처럼 쌓여요."));
  }
  $$("#mo-quick button").forEach(b => b.onclick = () => { moneyAmt = Number(b.dataset.amt); $("mo-amt").value = moneyAmt; renderMoney(); });
  $("f-money").addEventListener("submit", guard(async () => {
    const to = $("mo-to").value, amount = Math.round(Number($("mo-amt").value));
    if (!to) return toast("먼저 아이를 등록해 주세요.");
    if (!(amount > 0)) return toast("보낼 금액을 적어 주세요.");
    const memo = $("mo-memo").value.trim();
    await db.collection("allowance").add({ to, from: me || "", amount, kind: "in", memo, seen: false, createdAt: Date.now() });
    { const f = member(me); notify({ to: [to], except: me || "", title: "용돈이 들어왔어요 💰", body: `${f ? f.name : "가족"}: ${won(amount)}${memo ? " · " + memo : ""}`, url: "./#money", tag: "money" }); }
    $("mo-memo").value = "";
    const m = member(to); toast(`${m ? m.name : ""}에게 ${won(amount)} 보냈어요 💌`);
  }));
  $("f-init").addEventListener("submit", guard(async () => {
    const to = $("in-who").value, target = Math.round(Number($("in-amt").value));
    if (!to || !(target >= 0) || $("in-amt").value === "") return toast("누구 통장에 얼마로 맞출지 적어 주세요.");
    const diff = target - balanceOf(to), m = member(to);
    if (!diff) return toast(`${m ? m.name : ""} 통장은 이미 ${won(target)}이에요.`);
    await db.collection("allowance").add({ to, from: me || "", amount: diff, kind: "init", memo: `잔액을 ${won(target)}으로 맞췄어요`, seen: true, createdAt: Date.now() });
    $("in-amt").value = ""; toast(`${m ? m.name : ""} 통장 잔액을 ${won(target)}으로 맞췄어요`);
  }));
  $("f-spend").addEventListener("submit", guard(async () => {
    const to = $("sp-who").value, amount = Math.round(Number($("sp-amt").value));
    if (!to || !(amount > 0)) return toast("누가 얼마를 썼는지 적어 주세요.");
    await db.collection("allowance").add({ to, from: to, amount: -amount, kind: "out", memo: $("sp-memo").value.trim(), seen: true, createdAt: Date.now() });
    $("sp-amt").value = ""; $("sp-memo").value = ""; toast("쓴 돈을 기록했어요");
  }));

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
  }

  // ---------- push notifications (works with the app closed) ----------
  const PUSH_URL = CFG && CFG.url ? CFG.url.replace(/\/$/, "") + "/functions/v1/family-push" : "";
  let famKey = "", myPushId = "";
  try { myPushId = localStorage.getItem("fam-push") || ""; } catch (e) {}
  const pushOK = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && "ontouchend" in document);
  const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const shortHash = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
  function notify(o) {
    if (!PUSH_URL || !db || !famKey) return;
    fetch(PUSH_URL, { method: "POST", headers: { "content-type": "application/json", "x-family-key": famKey, "x-region": "ap-northeast-2" }, body: JSON.stringify(o) }).catch(() => {});
  }
  async function saveSub(sub) {
    const id = await shortHash(sub.endpoint), ua = navigator.userAgent;
    myPushId = id; store("fam-push", id);
    const dev = /iPhone/.test(ua) ? "iPhone" : isApple() ? "iPad" : /Android/.test(ua) ? "Android" : "컴퓨터";
    await db.doc("push/" + id).set({ sub: sub.toJSON(), memberId: me, device: dev, updatedAt: Date.now() });
  }
  async function enablePush() {
    if (!ready()) return;
    if (!member(me)) return toast("가족 메뉴에서 ‘이 기기는 나’를 먼저 눌러 주세요.");
    if (!pushOK()) return toast(isApple() && !isStandalone() ? "홈 화면에 추가한 앱으로 열어야 알림을 켤 수 있어요." : "이 브라우저는 알림을 지원하지 않아요.");
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") { renderPush(); return toast("알림이 꺼져 있어요. 설정 → 알림 → 오니가족에서 켤 수 있어요."); }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await (await fetch(PUSH_URL)).json();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(publicKey) });
      }
      await saveSub(sub);
      toast("이 기기에 알림을 켰어요 🔔");
    } catch (e) { console.error(e); toast("알림을 켜지 못했어요. 잠시 뒤 다시 해 주세요."); }
    renderPush();
  }
  async function syncPush() {
    try {
      if (!db || !member(me) || !pushOK() || Notification.permission !== "granted") return;
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (!sub) return;
      const id = await shortHash(sub.endpoint), cur = state.push.find(x => x.id === id);
      if (!cur || cur.memberId !== me) await saveSub(sub); else if (myPushId !== id) { myPushId = id; store("fam-push", id); }
      renderPush();
    } catch (e) { console.warn(e); }
  }
  function renderPush() {
    const granted = "Notification" in window && Notification.permission === "granted";
    const on = granted && !!myPushId && state.push.some(x => x.id === myPushId && x.memberId === me);
    $$(".noti-btn").forEach(b => { b.hidden = on || !db; b.onclick = enablePush; });
    const st = $("push-status"); if (!st) return;
    const blocked = "Notification" in window && Notification.permission === "denied";
    st.textContent = on ? "이 기기는 알림을 받고 있어요. 매일 아침 오늘 일정·할 일, 용돈 입금, 사 주세요, 수다방 새 글을 앱이 꺼져 있어도 알려 줘요."
      : blocked ? "알림이 막혀 있어요. 아이폰·아이패드 설정 → 알림 → 오니가족에서 ‘알림 허용’을 켜 주세요."
      : !pushOK() && isApple() && !isStandalone() ? "Safari에서 공유 → 홈 화면에 추가한 뒤, 홈 화면의 오니가족 아이콘으로 열어서 켜 주세요."
      : "버튼을 누르면 매일 아침 오늘 일정·할 일, 용돈 입금, 사 주세요, 수다방 새 글을 앱이 꺼져 있어도 알려 줘요.";
  }

  // ---------- 네이버 캘린더 가져오기 (server does the work; the password never comes back to the browser) ----------
  let nvState = null;
  async function naverCall(action, extra = {}) {
    const r = await fetch(PUSH_URL, { method: "POST", headers: { "content-type": "application/json", "x-family-key": famKey, "x-region": "ap-northeast-2" }, body: JSON.stringify({ action, ...extra }) });
    return r.json();
  }
  const agoLabel = t => t ? ago(t) : "아직";
  function renderNaver() {
    const st = $("nv-status"), on = nvState && nvState.connected;
    $("f-nv").hidden = !!on; $("nv-off").hidden = !on; $("nv-sync").hidden = !on;
    if (on) st.textContent = `${nvState.naverId} 님 네이버 캘린더와 연결돼 있어요. 가져온 일정은 ${member(nvState.memberId) ? member(nvState.memberId).name + "의" : "가족 전체"} 일정으로 들어가요. 마지막 확인: ${agoLabel(nvState.lastSync)}${nvState.lastAdded ? ` · 새 일정 ${nvState.lastAdded}개` : ""}${nvState.error ? " · ⚠️ " + (nvState.error === "login" ? "로그인이 풀렸어요. 연결 끊기 후 앱 비밀번호를 다시 넣어 주세요." : nvState.error) : ""}. 앱을 열 때 2시간마다 새 일정을 확인해요.`;
  }
  async function naverRefresh(force) {
    if (!db || !famKey || !PUSH_URL || isSimple()) return;
    try {
      const r = await naverCall("naver-sync", { force: !!force });
      if (r.added) { await db.loadCol("events"); toast(`네이버에서 새 일정 ${r.added}개를 가져왔어요 📅`); }
      else if (force && r.ok) toast("새로 가져올 일정이 없어요");
      else if (r.error && force) toast(r.error);
      nvState = await naverCall("naver-status"); renderNaver();
    } catch (e) { console.warn(e); }
  }
  $("f-nv").addEventListener("submit", guard(async () => {
    const id = $("nv-id").value.trim(), pw = $("nv-pw").value.trim(); if (!id || !pw) return;
    $("nv-status").textContent = "네이버에 연결하는 중…";
    const r = await naverCall("naver-save", { id, pw, memberId: member(me) ? me : "" });
    $("nv-pw").value = "";
    if (r.error) { toast(r.error); nvState = await naverCall("naver-status"); renderNaver(); if (!nvState.connected) $("nv-status").textContent = "⚠️ " + r.error; return; }
    if (r.added) await db.loadCol("events");
    toast(`연결됐어요! 일정 ${r.added || 0}개를 가져왔어요 📅`);
    nvState = await naverCall("naver-status"); renderNaver();
  }));
  $("nv-sync").onclick = () => naverRefresh(true);
  // 연결 끊기 = 자동 가져오기를 멈추고, 네이버에서 가져온 일정도 모두 지워요
  $("nv-off").onclick = async () => {
    if (!ready()) return;
    nvState = await naverCall("naver-off"); renderNaver();
    const nv = state.events.filter(e => e.src === "naver");
    for (const e of nv) { try { await db.doc("events/" + e.id).delete(); } catch (x) { fail(x); break; } }
    toast(`네이버 연결을 끊고 가져온 일정 ${nv.length}개를 지웠어요`);
  };

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
    db = st; famKey = key; store("fam-key", key); renderAll(); syncPush();
    st.cleanupPhotos(PHOTO_DAYS * 864e5).catch(() => {});
    naverRefresh(false);
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden && db) { db.loadAll().catch(console.error); naverRefresh(false); } });
  setInterval(() => { if (db && !document.hidden) db.loadAll().catch(console.error); }, 60000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(r => r.update()).catch(() => {});
  // 새 버전이 올라오면 앱을 열 때 저절로 새로고침 (홈 화면 앱이 옛날 화면에 머무르지 않게)
  const APP_VERSION = "21";
  async function checkVersion() {
    try {
      const v = await (await fetch("version.json?t=" + Date.now(), { cache: "no-store" })).json();
      if (v && v.v && v.v !== APP_VERSION && sessionStorage.getItem("fam-reloaded") !== v.v) { sessionStorage.setItem("fam-reloaded", v.v); location.reload(); }
    } catch (e) {}
  }
  checkVersion();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
  setInterval(() => { renderCal(); loadWeather(); }, 30 * 60000);
})();
