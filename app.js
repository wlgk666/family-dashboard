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
  // 매주 반복 일정: 한 번 저장(date = 첫날, repeat = "weekly", until = 끝나는 날(없으면 계속), skip = 뺀 날들)하고 화면에서 요일마다 펼쳐 보여요
  const repeats = e => e.repeat === "weekly";
  const occ = (e, s) => repeats(e) ? { ...e, date: s, seriesStart: e.date } : e;
  function eventsBetween(from, to) { // from 포함, to 미포함 ("9999" = 끝 없음: 반복은 4주까지만 펼쳐요)
    const out = [], horizon = to === "9999" ? ymd(addDays(parseYmd(from), 28)) : to;
    state.events.forEach(e => {
      if (!e.date || !visibleFor(who(e))) return;
      if (!repeats(e)) { if (e.date >= from && e.date < to) out.push(e); return; }
      const wd = parseYmd(e.date).getDay(); let d = parseYmd(e.date > from ? e.date : from);
      d = addDays(d, (wd - d.getDay() + 7) % 7);
      for (let s = ymd(d); s < horizon && (!e.until || s <= e.until); d = addDays(d, 7), s = ymd(d)) if (!(e.skip || []).includes(s)) out.push(occ(e, s));
    });
    return out.sort(sortEv);
  }
  const eventsOn = s => eventsBetween(s, ymd(addDays(parseYmd(s), 1)));

  // ---------- routing ----------
  const VIEWS = ["home","calendar","diary","todo","money","board","allchat","family"];
  function route() {
    let v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
    if (isSimple() && v === "board") v = "allchat";
    if (isSimple() && !SIMPLE_VIEWS.includes(v)) v = "calendar";
    const sec = v === "allchat" ? "board" : v; // 온가족방 uses the same chat screen
    if (sec === "board") { room = v === "allchat" ? "all" : "home"; renderMsgs(); }
    $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== sec);
    if (sec === "board") requestAnimationFrame(chatToEnd); // 숨겨진 상태에선 스크롤이 안 되므로, 화면이 보인 뒤 맨 아래(최근 글)로
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
      const s = ymd(d), evs = eventsOn(s);
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
    if (repeats(e)) { const rb = el("span","badge","🔁"); rb.title = e.until ? `${fmtDay(e.until)}까지 매주` : "매주 반복"; rb.style.cssText = "color:var(--m5);background:color-mix(in srgb, var(--m5) 14%, transparent)"; tt.prepend(rb); }
    if (e.src === "naver") { const nb = el("span","badge","N"); nb.title = "네이버 캘린더에서 가져온 일정"; nb.style.cssText = "color:#03a94d;background:#e3f7ea"; tt.prepend(nb); }
    if (opts.del) {
      const ed = el("button","x","✎"); ed.type = "button"; ed.setAttribute("aria-label", e.title + " 고치기"); ed.onclick = () => editEvent(e);
      r.append(ed, xBtn(e.title, repeats(e) ? () => delRepeat(e) : del("events", e.id)));
    }
    return r;
  }
  async function delRepeat(e) {
    if (!ready()) return;
    const c = await ask(`‘${e.title}’ 지우기`, `매주 반복되는 일정이에요. ${fmtDay(e.date)}만 지울까요, 매주 전부 지울까요?`,
      [["one", `${fmtDay(e.date)}만 지우기`], ["all", "매주 일정 전부 지우기", "ghost"], ["", "취소", "ghost"]]);
    const cur = state.events.find(x => x.id === e.id); if (!c || !cur) return;
    try {
      if (c === "all") { await db.doc("events/" + e.id).delete(); toast("반복 일정을 모두 지웠어요"); }
      else { await db.doc("events/" + e.id).update({ skip: [...new Set([...(cur.skip || []), e.date])] }); toast(`${fmtDay(e.date)} 일정만 뺐어요`); }
    } catch (x) { fail(x); }
  }
  // 고르기 창: ask(제목, 설명, [[값, 글자, "ghost"?], ...]) → 누른 값 (바깥을 누르면 "")
  function ask(title, sub, opts) {
    return new Promise(res => {
      const box = $("ask"), btns = $("ask-btns");
      $("ask-title").textContent = title; $("ask-sub").textContent = sub || ""; btns.replaceChildren();
      const done = v => { box.hidden = true; box.onclick = null; res(v); };
      opts.forEach(([v, label, cls]) => { const b = el("button", "btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.onclick = ev => { ev.stopPropagation(); done(v); }; btns.append(b); });
      box.onclick = ev => { if (ev.target === box) done(""); };
      box.hidden = false; btns.firstChild && btns.firstChild.focus();
    });
  }
  function upcoming(days) {
    const t = todayStr(), end = days ? ymd(addDays(new Date(), days)) : "9999";
    return eventsBetween(t, end);
  }
  function renderCal() {
    $$(".mtitle").forEach(x => x.textContent = `${cursor.getFullYear()}년 ${cursor.getMonth()+1}월`);
    renderMonth($("mini-month"), false); renderMonth($("big-month"), true);
    // home list
    $("tab-ev").setAttribute("aria-selected", String(homeTab==="ev")); $("tab-di").setAttribute("aria-selected", String(homeTab==="di"));
    const hl = $("home-list"); hl.replaceChildren();
    if (homeTab === "ev") {
      const list = selDay ? eventsOn(selDay) : upcoming(7);
      $("home-sub").textContent = selDay ? `${fmtDay(selDay)} · ${list.length}건` : `오늘부터 7일 · ${list.length}건`;
      list.forEach(e => hl.append(evRow(e)));
      if (!list.length) hl.append(el("div","empty", selDay ? "이 날은 일정이 없어요." : "다가오는 일주일은 일정이 비어 있어요."));
      $("home-more").href = "#calendar"; $("home-add").hidden = false;
    } else if (diaryLocked()) {
      $("home-sub").textContent = "🔒 잠겨 있어요";
      const b = el("div","empty"); const a = el("a",null,"일기장 열기"); a.href = "#diary";
      b.append(document.createTextNode("일기장이 잠겨 있어요. "), a); hl.append(b);
      $("home-more").href = "#diary"; $("home-add").hidden = true;
    } else {
      const list = [...state.diary].filter(d => !!me && d.by === me) /* 일기는 이 기기 주인 것만 */.sort(newestDiary).slice(0,5);
      $("home-sub").textContent = `최근 일기 ${list.length}편`;
      list.forEach(d => hl.append(diaryCard(d, false)));
      if (!list.length) hl.append(el("div","empty","아직 쓴 일기가 없어요. 일기 메뉴에서 오늘 하루를 남겨 보세요."));
      $("home-more").href = "#diary"; $("home-add").hidden = true;
    }
    // calendar view list
    const cl = $("cal-list"); cl.replaceChildren();
    const list = selDay ? eventsOn(selDay) : upcoming(0).slice(0,40);
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
  let evRepeat = false;
  function renderRepeat() { $("ev-repeat").setAttribute("aria-pressed", String(evRepeat)); $("ev-until-wrap").hidden = !evRepeat; }
  $("ev-repeat").onclick = () => { evRepeat = !evRepeat; renderRepeat(); };

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
    const t = todayStr(), games = eventsBetween(t, "9999").filter(e => e.type === "game" || e.game);
    if (games.length) { const g = games[0]; w.append(el("div","w-game", `⚾ 직관 ${relDay(g.date)} · ${g.title}${g.start ? " " + g.start : ""}`)); }
    const foot = el("div","w-foot");
    const stale = wx && Date.now() - wx.updatedAt > 12 * 3600e3;
    foot.append(el("span", null, wx ? (wx.updatedLabel || "") + (stale ? " · 오래된 정보예요" : "") : ""));
    const a = el("a", null, "기상청 ↗"); a.href = "https://www.weather.go.kr/w/index.do"; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "color:inherit";
    const src = el("span"); if (wx) src.append(document.createTextNode((wx.source || "") + " · ")); src.append(a); foot.append(src);
    w.append(foot);
  }
  // 저녁메뉴 및 사주세요: 먹고 싶은 메뉴와 필요한 물건을 한 목록에. 누가 부탁했는지, 같이 원하는 사람(나도!)이 보여요.
  // 앞쪽 단어가 먼저 맞춰져요: "김치찌개"는 "김치"보다, "닭갈비"는 "닭"보다 앞에 둬야 해요.
  const FOOD_EMO = [
    // 찌개·국·탕·찜·전골
    ["김치찌개","🍲"],["된장찌개","🍲"],["순두부","🍲"],["부대찌개","🍲"],["청국장","🍲"],["동태찌개","🍲"],["고추장찌개","🍲"],["찌개","🍲"],
    ["김치찜","🥘"],["갈비찜","🥘"],["찜닭","🥘"],["아구찜","🥘"],["계란찜","🥚"],["달걀찜","🥚"],["찜","🥘"],
    ["미역국","🥣"],["떡국","🥣"],["콩나물국","🥣"],["북엇국","🥣"],["육개장","🍲"],["감자탕","🍲"],["갈비탕","🍲"],["삼계탕","🍲"],["곰탕","🍲"],["설렁탕","🍲"],["매운탕","🍲"],["해장국","🍲"],["샤브샤브","🍲"],["전골","🍲"],["탕","🍲"],["국","🥣"],
    // 고기·볶음·구이
    ["닭갈비","🍗"],["닭볶음탕","🍲"],["치킨","🍗"],["닭강정","🍗"],["닭","🍗"],
    ["불고기","🥩"],["제육","🥓"],["삼겹","🥓"],["목살","🥓"],["보쌈","🥬"],["족발","🍖"],["갈비","🍖"],["스테이크","🥩"],["고기","🥩"],
    ["오징어볶음","🦑"],["오징어","🦑"],["낙지","🐙"],["쭈꾸미","🐙"],["주꾸미","🐙"],["생선","🐟"],["고등어","🐟"],["갈치","🐟"],["연어","🐟"],["새우","🍤"],["튀김","🍤"],
    // 밥·면·분식
    ["비빔밥","🍚"],["볶음밥","🍳"],["김치볶음밥","🍳"],["오므라이스","🍳"],["덮밥","🍚"],["카레","🍛"],["죽","🥣"],["김밥","🍙"],["주먹밥","🍙"],["유부초밥","🍙"],["초밥","🍣"],["회","🍣"],
    ["떡볶이","🌶️"],["순대","🌭"],["어묵","🍢"],["오뎅","🍢"],["만두","🥟"],["전","🥞"],["파전","🥞"],["부침개","🥞"],["잡채","🍜"],
    ["라면","🍜"],["짜장","🍜"],["짬뽕","🍜"],["냉면","🍜"],["칼국수","🍜"],["국수","🍜"],["우동","🍜"],["쌀국수","🍜"],["마라","🌶️"],["스파게티","🍝"],["파스타","🍝"],
    ["돈가스","🍱"],["돈까스","🍱"],["도시락","🍱"],["탕수육","🥡"],["피자","🍕"],["햄버거","🍔"],["버거","🍔"],["핫도그","🌭"],["감자튀김","🍟"],["샌드위치","🥪"],["토스트","🍞"],["타코","🌮"],
    // 간식·과일·음료
    ["바나나우유","🥛"],["딸기우유","🥛"],["초코우유","🥛"],["탄산수","🫧"],["보리차","🍵"],["녹차","🍵"],["핫초코","☕"],["코코아","☕"],["식혜","🍶"],["이온음료","🥤"],["레모네이드","🍋"],["아이스티","🧋"],["두유","🥛"],["요거트","🥛"],["생수","💧"],["물","💧"],["팝콘","🍿"],["와플","🧇"],["푸딩","🍮"],["마카롱","🍬"],["수제비","🥣"],["쫄면","🍜"],["소시지","🌭"],["소세지","🌭"],["붕어빵","🐟"],["호떡","🥞"],["케이크","🍰"],["도넛","🍩"],["아이스크림","🍦"],["빙수","🍧"],["과자","🍪"],["쿠키","🍪"],["초콜릿","🍫"],["사탕","🍬"],["젤리","🍬"],["탕후루","🍡"],["떡","🍡"],["빵","🍞"],["붕어빵","🐟"],["호떡","🥞"],["고구마","🍠"],["옥수수","🌽"],["감자","🥔"],
    ["딸기","🍓"],["수박","🍉"],["포도","🍇"],["귤","🍊"],["사과","🍎"],["배","🍐"],["바나나","🍌"],["복숭아","🍑"],["참외","🍈"],["망고","🥭"],
    ["김치","🥬"],["계란","🥚"],["달걀","🥚"],["두부","🧈"],["우유","🥛"],["요구르트","🥛"],["주스","🧃"],["콜라","🥤"],["사이다","🥤"],["음료","🥤"],
    ["색연필","🖍️"],["연필","✏️"],["지우개","🧽"],["공책","📓"],["스케치북","🎨"],["물감","🎨"],["색종이","📄"],["가위","✂️"],["테이프","📎"],["풀","🧴"],["실내화","👟"],["마스크","😷"],["풍선","🎈"]];
  // 한 글자(배·전·국·탕·회·죽·찜)는 끝에 올 때만: "광어회" O, "배추" X
  const shopEmo = t => { t = t.replace(/\s*\d+\s*(개|봉지?|팩|병|통|판|인분|마리|kg|g)?\s*$/,"").trim(); return (FOOD_EMO.find(([k]) => k.length > 1 ? t.includes(k) : t === k || t.endsWith(k)) || [,"🛒"])[1]; };
  // 빠른 고르기: 음식 / 간식 / 준비물 버튼을 누르면 그 안의 이모지 메뉴가 펼쳐져요
  const SHOP_QUICK = [
    ["음식","🍚",["김치찌개","된장찌개","순두부찌개","부대찌개","김치찜","갈비찜","닭볶음탕","미역국","떡국","삼계탕","감자탕","불고기","제육볶음","삼겹살","닭갈비","족발","생선구이","비빔밥","김치볶음밥","오므라이스","카레","김밥","유부초밥","잡채","떡볶이","치킨","돈가스","탕수육","라면","우동","짜장면","짬뽕","칼국수","잔치국수","냉면","쫄면","쌀국수","스파게티","피자","햄버거","초밥"]],
    ["간식","🍪",["아이스크림","과자","팝콘","젤리","초콜릿","케이크","빵","도넛","와플","푸딩","탕후루","붕어빵","호떡","고구마","딸기","귤","바나나","사과","포도","수박","우유","바나나우유","초코우유","요구르트","주스","탄산수","사이다","콜라"]],
    ["준비물","✏️",["연필","색연필","지우개","공책","스케치북","색종이","풀","가위","테이프","물감","실내화","마스크"]]];
  const nameOf0 = id => (member(id) || {}).name || "";
  function shopRow(s, full) {
    const li = el("li", "shop-row" + (s.done ? " done" : ""));
    const cb = el("input","check"); cb.type = "checkbox"; cb.checked = !!s.done; cb.setAttribute("aria-label", s.item + " 샀어요");
    cb.onchange = () => ready() && db.doc("shopping/"+s.id).update({ done: cb.checked, doneBy: cb.checked ? (me||"") : "", doneAt: cb.checked ? Date.now() : 0 }).catch(fail);
    const g = el("div","grow"), ask = el("div","ask");
    ask.append(document.createTextNode(s.item + " "), el("em", null, s.done ? "샀어요!" : "사주세요!"));
    g.append(ask);
    const fans = [s.by, ...(s.metoo || []).filter(id => id !== s.by)].filter(id => member(id));
    if (fans.length || full) {
      const by = el("div","by meta");
      fans.forEach(id => by.append(avatar(member(id), true)));
      const when = s.done && s.doneAt ? `${nameOf0(s.doneBy) ? "산 사람 " + nameOf0(s.doneBy) + " " : ""}${ago(s.doneAt)}` : (s.createdAt ? ago(s.createdAt) : "");
      by.append(document.createTextNode(" " + [fans.map(nameOf0).join(", "), when].filter(Boolean).join(" · ")));
      g.append(by);
    }
    li.append(cb, el("span","emo",shopEmo(s.item)), g);
    if (!s.done && member(me) && s.by !== me) {
      const on = (s.metoo || []).includes(me), b = el("button","metoo", on ? "나도! ✓" : "나도!");
      b.type = "button"; b.setAttribute("aria-pressed", String(on)); b.title = "나도 이거 원해요";
      b.onclick = () => ready() && db.doc("shopping/"+s.id).update({ metoo: on ? (s.metoo||[]).filter(x => x !== me) : [...(s.metoo||[]), me] }).catch(fail);
      li.append(b);
    }
    li.append(xBtn(s.item, del("shopping", s.id)));
    return li;
  }
  $$(".shop-quick").forEach(box => {
    const tabs = el("div","sq-tabs"), pick = el("div","sq-pick"); pick.hidden = true;
    const inp = box.parentElement.querySelector('form[data-form="shop"] textarea');
    let cur = null;
    const show = cat => {
      cur = cur === cat ? null : cat;
      [...tabs.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cat === cur)));
      pick.replaceChildren(); pick.hidden = !cur; if (!cur) return;
      SHOP_QUICK.find(c => c[0] === cur)[2].forEach(item => {
        const b = el("button","sq-item"); b.type = "button"; b.append(el("span","e",shopEmo(item)), el("span","n",item));
        b.onclick = () => { inp.value = item; fitMsgBox(inp); inp.focus(); [...pick.children].forEach(x => x.classList.toggle("on", x === b)); };
        pick.append(b);
      });
    };
    SHOP_QUICK.forEach(([cat, e]) => { const b = el("button","chip t", e + " " + cat); b.type = "button"; b.dataset.cat = cat; b.setAttribute("aria-pressed","false"); b.onclick = () => show(cat); tabs.append(b); });
    box.append(tabs, pick);
  });
  function renderShopping() {
    const list = [...state.shopping].sort((a,b) => (a.done-b.done) || (a.done ? (b.doneAt||0)-(a.doneAt||0) : (b.createdAt||0)-(a.createdAt||0)));
    const hs = $("home-shop"); hs.replaceChildren();
    const open = list.filter(s => !s.done);
    open.slice(0,5).forEach(s => hs.append(shopRow(s,false)));
    if (open.length > 5) hs.append(el("li","meta",`외 ${open.length-5}개`));
    if (!open.length) hs.append(el("li","empty","먹고 싶은 거나 필요한 걸 적으면 “김치찌개 사주세요!”처럼 올라가요 😋"));
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
  // 가장 최근에 쓴 일기가 맨 위, 예전 글은 아래로 (날짜를 지난 날로 골라 써도 쓴 순서대로)
  const newestDiary = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.date || "").localeCompare(a.date || "");
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
  // ---------- 일기 잠금 (4자리 비밀번호) ----------
  // 비밀번호는 members 문서에 sha256 값(pin)으로만 저장해요. 열어 둔 일기장은 앱을 내리거나, 10분이 지나거나, 기기 주인이 바뀌면 다시 잠겨요.
  const pinHash = async (id, pin) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`diary:${id}:${pin}`)))].map(b => b.toString(16).padStart(2,"0")).join("");
  let diaryOpenFor = "", diaryOpenAt = 0, lockTimer = 0;
  let pinMode = "unlock", pinBuf = "", pinFirst = "", pinFails = 0, pinWaitUntil = 0;
  const hasPin = () => { const m = member(me); return !!(m && m.pin); };
  const diaryLocked = () => hasPin() && !(diaryOpenFor === me && Date.now() - diaryOpenAt < 600e3);
  function lockDiary() { diaryOpenFor = ""; clearTimeout(lockTimer); pinMode = "unlock"; pinBuf = ""; if (db) { renderDiary(); renderCal(); renderBackupNote(); } }
  function openDiary() { diaryOpenFor = me; diaryOpenAt = Date.now(); clearTimeout(lockTimer); lockTimer = setTimeout(lockDiary, 600e3); }
  document.addEventListener("visibilitychange", () => { if (document.hidden && diaryOpenFor) lockDiary(); });
  const PIN_TEXT = {
    unlock: ["일기장이 잠겨 있어요", "비밀번호 4자리를 눌러 주세요"],
    set1: ["일기 비밀번호 만들기", "새 비밀번호 4자리를 눌러 주세요"],
    set2: ["한 번 더 눌러 주세요", "똑같이 한 번 더 눌러 주세요"],
  };
  (() => {
    const pad = $("pin-pad");
    ["1","2","3","4","5","6","7","8","9","clr","0","back"].forEach(k => {
      const b = el("button", k.length > 1 ? "fn" : null, k === "clr" ? "모두 지우기" : k === "back" ? "⌫" : k); b.type = "button";
      b.setAttribute("aria-label", k === "clr" ? "모두 지우기" : k === "back" ? "하나 지우기" : k);
      b.onclick = () => pinKey(k); pad.append(b);
    });
    $("pin-cancel").onclick = () => { pinMode = "unlock"; pinBuf = ""; renderDiary(); };
  })();
  function pinShow(msg) {
    const [t, sub] = PIN_TEXT[pinMode]; $("pin-title").textContent = t; $("pin-sub").textContent = sub;
    $$("#pin-dots span").forEach((d, i) => d.classList.toggle("on", i < pinBuf.length));
    if (msg != null) $("pin-msg").textContent = msg;
    $("pin-cancel").hidden = pinMode === "unlock"; $("pin-forgot").hidden = pinMode !== "unlock";
  }
  function pinWrong(msg) { const d = $("pin-dots"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake"); pinBuf = ""; pinShow(msg); }
  async function pinKey(k) {
    if (k === "clr") pinBuf = ""; else if (k === "back") pinBuf = pinBuf.slice(0, -1);
    else if (pinBuf.length < 4) pinBuf += k;
    pinShow(""); if (pinBuf.length < 4) return;
    const m = member(me); if (!m || !ready()) return;
    const entered = pinBuf;
    if (pinMode === "unlock") {
      if (Date.now() < pinWaitUntil) return pinWrong(`잠깐! ${Math.ceil((pinWaitUntil - Date.now()) / 1000)}초 뒤에 다시 눌러 주세요.`);
      if (await pinHash(m.id, entered) === m.pin) { pinFails = 0; pinBuf = ""; openDiary(); renderDiary(); renderCal(); renderBackupNote(); return; }
      pinFails++; if (pinFails >= 5) { pinFails = 0; pinWaitUntil = Date.now() + 30e3; return pinWrong("5번 틀렸어요. 30초 뒤에 다시 해 주세요."); }
      return pinWrong("비밀번호가 달라요. 다시 눌러 주세요.");
    }
    if (pinMode === "set1") { pinFirst = entered; pinBuf = ""; pinMode = "set2"; return pinShow(""); }
    if (entered !== pinFirst) { pinMode = "set1"; pinFirst = ""; return pinWrong("두 번 누른 번호가 달라요. 처음부터 다시 해 주세요."); }
    try { await db.doc("members/" + m.id).update({ pin: await pinHash(m.id, entered), pinAt: Date.now() }); }
    catch (x) { pinMode = "unlock"; pinBuf = ""; fail(x); renderDiary(); return; }
    pinMode = "unlock"; pinBuf = ""; pinFirst = ""; openDiary(); renderDiary(); renderBackupNote();
    toast("일기 비밀번호를 정했어요 🔒 꼭 기억해 주세요!");
  }
  function startSetPin() { pinMode = "set1"; pinBuf = ""; pinFirst = ""; renderDiary(); window.scrollTo(0, 0); }
  async function removePin() {
    const m = member(me); if (!m || !ready()) return;
    const c = await ask("일기 비밀번호를 끌까요?", "끄면 이 기기에서 ‘이 기기는 나’를 고른 사람 누구나 내 일기를 볼 수 있어요.", [["yes", "비밀번호 끄기"], ["", "취소", "ghost"]]);
    if (c !== "yes") return;
    try { await db.doc("members/" + m.id).update({ pin: "", pinAt: Date.now() }); toast("일기 비밀번호를 껐어요"); } catch (x) { fail(x); }
  }
  function renderLockRow() {
    const row = $("di-lockrow"); row.replaceChildren(); if (!member(me)) return;
    const b = (label, fn, cls) => { const x = el("button", "btn " + (cls || "ghost"), label); x.type = "button"; x.onclick = fn; row.append(x); };
    if (!hasPin()) { row.append(el("span","sub","일기장에 비밀번호를 걸면 다른 가족이 이 기기에서 열어도 못 봐요.")); b("🔒 비밀번호 만들기", startSetPin, "navy"); return; }
    b("🔒 지금 잠그기", lockDiary, "navy"); b("비밀번호 바꾸기", startSetPin); b("비밀번호 끄기", removePin);
  }

  function renderDiary() {
    const setting = pinMode !== "unlock", locked = setting || diaryLocked();
    $("di-lock").hidden = !locked; $("di-main").hidden = locked;
    if (locked) { pinShow(); return; }
    renderLockRow();
    const mb = $("di-mood"); mb.replaceChildren();
    MOODS.forEach(([n]) => { const b = el("button","chip t", n); b.type = "button"; b.setAttribute("aria-pressed", String(diMood===n)); b.onclick = () => { diMood = n; renderDiary(); }; mb.append(b); });
    const list = [...state.diary].filter(d => !!me && d.by === me) /* 일기는 이 기기 주인 것만 */.sort(newestDiary);
    $("di-count").textContent = `${list.length}편`;
    const box = $("di-list"); box.replaceChildren();
    list.forEach(d => box.append(diaryCard(d, true)));
    if (!list.length) box.append(el("div","empty", member(me) ? "첫 일기를 써 보세요. 내 일기는 나만 볼 수 있어요 🔒" : "가족 메뉴에서 ‘이 기기는 나’를 먼저 골라 주세요. 일기는 각자 자기 것만 보여요."));
  }

  // ---------- 수다방 (family chat) ----------
  const STICKERS = ["💖","😆","👍","🥹","🎉","😴","🍗","⚾","🐱","🌈"];
  // 두 개의 방: "home" = 우리 넷, "all" = 할머니·할아버지까지 온 가족. 조부모 기기는 "all" 만 봐요.
  let room = "home";
  const curRoom = () => isSimple() ? "all" : room;
  const roomOf = mg => mg.room === "all" ? "all" : "home";
  const roomFor = node => node && node.closest('[data-view="board"]') ? curRoom() : "home";
  function sendMsg(text, sticker, photo, rm, nPhotos = 1) { // 여러 장 보낼 때: 0 = 알림 생략, 2 이상 = "사진 N장" 알림 한 번
    if (!ready()) return Promise.resolve();
    const r = rm === "all" ? "all" : "home";
    return db.collection("messages").add({ text, sticker: !!sticker, photo: photo || "", room: r, by: me || "", hearts: [], createdAt: Date.now() }).then(async () => {
      if (!nPhotos) return;
      const w = member(me), to = r === "all" ? null : state.members.filter(m => m.kind !== "grand").map(m => m.id);
      notify({ to, except: me || "", title: `${r === "all" ? "💞 온 가족" : "🏠 우리집"} · ${w ? w.name : "가족"}`, body: photo ? `📷 사진${nPhotos > 1 ? " " + nPhotos + "장" : ""}을 보냈어요` + (text ? " · " + text : "") : text, url: r === "all" ? "./#allchat" : "./#board", tag: "chat-" + r });
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
          im.onload = () => { box.scrollTop = box.scrollHeight; }; // 사진이 늦게 뜨며 밀려난 최근 글이 다시 보이게
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
    requestAnimationFrame(chatToEnd); // 글이 새로 오거나 위쪽 안내가 사라져도 최근 글이 보이게
  }
  function chatToEnd() {
    const b = $("board-msgs"); if (!b || b.closest("[hidden]")) return;
    if (matchMedia("(max-width:760px)").matches) {
      // 휴대폰: 수다창 높이를 화면에 딱 맞춰서 최근 글과 입력칸이 하단 메뉴에 가리지 않게
      const rail = document.querySelector(".rail"), f0 = b.parentElement.querySelector("form.chat-input"), form = f0 && f0.offsetParent ? f0 : null;
      const navTop = rail ? rail.getBoundingClientRect().top : innerHeight;
      const under = form ? form.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom : 0; // 스티커 + 입력칸
      const h = Math.floor(navTop - 14 - under - (b.getBoundingClientRect().top + scrollY)); // 페이지 맨 위 기준
      b.style.minHeight = "0"; b.style.maxHeight = "none"; b.style.height = Math.max(h, 260) + "px";
      if (h < 260 && form) scrollTo(0, form.getBoundingClientRect().bottom + scrollY - (navTop - 14)); // 화면이 너무 작으면 페이지를 내려서 맞춤
    } else b.style.minHeight = b.style.maxHeight = b.style.height = "";
    b.scrollTop = b.scrollHeight;
  }
  addEventListener("resize", () => requestAnimationFrame(chatToEnd));
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
  const MAX_PHOTOS = 5; // 한 번에 보낼 수 있는 사진 수
  $$("form.chat-input").forEach(f => {
    const pb = el("button","photo-btn","📷"); pb.type = "button"; pb.setAttribute("aria-label","사진 보내기");
    pb.onclick = () => { if (!ready()) return; photoForm = f; $("photo-in").value = ""; $("photo-in").click(); };
    f.prepend(pb);
  });
  $("photo-in").onchange = async () => {
    const all = [...$("photo-in").files], files = all.slice(0, MAX_PHOTOS); if (!files.length || !ready()) return;
    const btns = $$(".photo-btn"); btns.forEach(b => b.disabled = true);
    toast(all.length > MAX_PHOTOS ? `사진은 한 번에 ${MAX_PHOTOS}장까지예요. 앞의 ${MAX_PHOTOS}장만 보낼게요 📷` : `사진 ${files.length > 1 ? files.length + "장 " : ""}올리는 중… 📷`);
    const inp = photoForm && photoForm.querySelector("textarea"), cap = inp ? inp.value.trim() : "", rm = roomFor(photoForm);
    let sent = 0;
    for (const [i, file] of files.entries()) {
      try {
        const ph = await shrinkPhoto(file);
        const { id } = await db.collection("photo").add({ ...ph, by: me || "", createdAt: Date.now() });
        await sendMsg(sent === 0 ? cap : "", false, id, rm, i === files.length - 1 ? sent + 1 : 0); // 글은 첫 장에만, 알림은 마지막에 한 번
        if (sent === 0 && inp) { inp.value = ""; fitMsgBox(inp); }
        sent++;
      } catch (e) { console.error(e); }
    }
    if (sent < files.length) toast(sent ? `사진 ${files.length - sent}장은 보내지 못했어요. 다시 해 주세요.` : "사진을 보내지 못했어요. 다시 해 주세요.");
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
      mine.onclick = () => { me = m.id; store("fam-me", me); diaryOpenFor = ""; pinMode = "unlock"; pinBuf = ""; renderAll(); syncPush(); toast(`이 기기는 이제 ${m.name}의 기기예요`); };
      const bells = state.push.filter(x => x.memberId === m.id).length;
      r.append(avatar(m), nm, num, kind, sws, mine);
      if (bells) { const b = el("span","pill", `🔔 ${bells}`); b.title = `알림 받는 기기 ${bells}대`; r.append(b); }
      if (m.pin && m.id !== me && member(me) && isAdult(member(me))) {
        const rs = el("button","chip t","🔑 일기 비번 지우기"); rs.type = "button"; rs.title = "비밀번호를 잊었을 때 지워 주면 다시 만들 수 있어요";
        rs.onclick = async () => {
          const c = await ask(`${m.name}의 일기 비밀번호를 지울까요?`, "일기는 그대로 남아요. 지우면 그 기기에서 비밀번호 없이 열리고, 새로 만들 수 있어요.", [["yes", "비밀번호 지우기"], ["", "취소", "ghost"]]);
          if (c === "yes" && ready()) db.doc("members/"+m.id).update({ pin: "", pinAt: Date.now() }).then(() => toast(`${m.name}의 일기 비밀번호를 지웠어요`)).catch(fail);
        };
        r.append(rs);
      }
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
    renderCal(); renderWeather(); renderShopping(); renderPeople(); renderDiary(); renderMsgs(); renderMoney(); renderFamily(); renderBackupNote(); renderStatus(); renderPush(); checkPop();
  }

  // ---------- forms ----------
  const guard = fn => async ev => { ev.preventDefault(); if (!ready()) return; try { await fn(ev.currentTarget); } catch(e) { fail(e); } };
  // editing: the form switches to "수정 저장"; imported Naver events become ordinary board events once saved
  let editingEv = null;
  function editEvent(e) {
    editingEv = e.id;
    $("ev-title").value = e.title; $("ev-date").value = e.seriesStart || e.date; $("ev-start").value = e.start || ""; $("ev-end").value = e.end || "";
    evRepeat = repeats(e); $("ev-until").value = e.until || ""; renderRepeat();
    evWho.clear(); who(e).forEach(id => member(id) && evWho.add(id)); renderWhoChips();
    evType = (typeOf(e) || [""])[0]; renderTypeChips();
    $("ev-submit").textContent = repeats(e) ? "수정 저장 (매주 전체)" : "수정 저장"; $("ev-cancel").hidden = false;
    if (location.hash !== "#calendar") location.hash = "#calendar";
    setTimeout(() => { $("f-ev").scrollIntoView({ behavior: "smooth", block: "center" }); $("ev-title").focus(); }, 50);
  }
  function resetEvForm() {
    editingEv = null; $("ev-title").value = ""; $("ev-start").value = ""; $("ev-end").value = ""; evType = ""; renderTypeChips();
    evRepeat = false; $("ev-until").value = ""; renderRepeat();
    $("ev-submit").textContent = "일정 추가"; $("ev-cancel").hidden = true;
  }
  $("ev-cancel").onclick = resetEvForm;
  $("f-ev").addEventListener("submit", guard(async () => {
    const title = $("ev-title").value.trim(), date = $("ev-date").value; if (!title || !date) return;
    const until = evRepeat ? ($("ev-until").value || "") : "";
    if (until && until < date) return toast("‘언제까지’는 첫 날짜보다 뒤로 골라 주세요.");
    const data = { title, date, start: $("ev-start").value || "", end: $("ev-end").value || "", memberIds: [...evWho], type: evType, game: evType === "game", repeat: evRepeat ? "weekly" : "", until };
    const id = editingEv; resetEvForm();
    if (id && state.events.some(x => x.id === id)) { await db.doc("events/" + id).update({ ...data, editedAt: Date.now() }); toast("일정을 고쳤어요"); }
    else { await db.collection("events").add({ ...data, by: me || "", createdAt: Date.now() }); toast(data.repeat ? `매주 ${DOW[parseYmd(date).getDay()]}요일마다 보이게 추가했어요 🔁` : "일정을 추가했어요"); }
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
    $("di-text").value = ""; $("di-list").scrollTop = 0; toast("일기를 저장했어요");
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
    const inp = form.querySelector("textarea"), item = inp.value.replace(/\s+/g, " ").trim(); if (!item) return; inp.value = ""; fitMsgBox(inp);
    const dup = state.shopping.find(s => !s.done && s.item.replace(/\s/g,"") === item.replace(/\s/g,""));
    if (dup) { // 이미 있는 건 새로 만들지 않고 ‘나도!’에 넣어요
      if (member(me) && dup.by !== me && !(dup.metoo || []).includes(me)) await db.doc("shopping/"+dup.id).update({ metoo: [...(dup.metoo||[]), me] });
      toast(`‘${dup.item}’은 이미 있어요. 나도! 에 넣었어요`); return;
    }
    await db.collection("shopping").add({ item, done: false, by: me || "", metoo: [], createdAt: Date.now() });
    toast(`${shopEmo(item)} ${item} 사주세요! 부탁했어요`);
    { const w = member(me), adults = state.members.filter(m => m.kind === "parent").map(m => m.id);
      notify({ to: adults, except: me || "", title: `${shopEmo(item)} 저녁메뉴 및 사주세요`, body: `${w ? w.name : "가족"}: ${item} 사주세요!`, url: "./#todo", tag: "shop" }); }
  })));
  $$('form[data-form="msg"]').forEach(f => f.addEventListener("submit", ev => {
    ev.preventDefault(); const inp = f.querySelector("textarea"), text = inp.value.trim(); if (!text) return; inp.value = ""; fitMsgBox(inp); sendMsg(text, false, "", roomFor(f));
  }));
  // 수다 입력칸: 글이 길어지면 줄바꿈되며 자동으로 늘어나요 (휴대폰은 엔터 = 줄바꿈, 컴퓨터는 엔터 = 보내기 · Shift+엔터 = 줄바꿈)
  function fitMsgBox(t) { const h0 = t.style.height; t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; if (t.style.height !== h0) requestAnimationFrame(chatToEnd); }
  // 저녁메뉴 및 사주세요 입력칸도 길어지면 늘어나요. 여기선 엔터 = 추가 (줄바꿈 없음)
  $$('form[data-form="shop"] textarea').forEach(t => {
    t.addEventListener("input", () => fitMsgBox(t));
    t.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); t.form.requestSubmit(); } });
  });
  $$('form[data-form="msg"] textarea').forEach(t => {
    t.addEventListener("input", () => fitMsgBox(t));
    t.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && matchMedia("(hover:hover) and (pointer:fine)").matches) { e.preventDefault(); t.form.requestSubmit(); }
    });
  });
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
    for (const [item,bi] of [["치킨",2],["떡볶이",3],["우유 2개",0],["응원용 막대풍선",0]]) await add("shopping",{ item, done: false, by: ids[bi], metoo: item === "치킨" ? [ids[3]] : [], createdAt: n });
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
    st.textContent = on ? "이 기기는 알림을 받고 있어요. 매일 아침 오늘 일정·할 일, 용돈 입금, 저녁메뉴 및 사주세요, 수다방 새 글을 앱이 꺼져 있어도 알려 줘요."
      : blocked ? "알림이 막혀 있어요. 아이폰·아이패드 설정 → 알림 → 오니가족에서 ‘알림 허용’을 켜 주세요."
      : !pushOK() && isApple() && !isStandalone() ? "Safari에서 공유 → 홈 화면에 추가한 뒤, 홈 화면의 오니가족 아이콘으로 열어서 켜 주세요."
      : "버튼을 누르면 매일 아침 오늘 일정·할 일, 용돈 입금, 저녁메뉴 및 사주세요, 수다방 새 글을 앱이 꺼져 있어도 알려 줘요.";
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
  // ---------- 백업: 일정 · 용돈 기록 · 내 일기를 파일로 ----------
  // 일기는 이 기기 주인 것만 넣어요(잠겨 있으면 빠져요). 다른 가족의 일기는 백업으로도 볼 수 없게.
  const backupDiary = () => member(me) && !diaryLocked() ? state.diary.filter(d => d.by === me).sort((a,b) => (a.date||"").localeCompare(b.date||"") || a.createdAt - b.createdAt) : null;
  function renderBackupNote() {
    const n = $("backup-note"); if (!n) return; const m = member(me);
    n.textContent = !m ? "‘이 기기는 나’를 고르면 내 일기도 같이 저장돼요."
      : diaryLocked() ? "🔒 일기장이 잠겨 있어서 일기는 빠져요. 일기 메뉴에서 잠금을 풀고 오면 같이 저장돼요."
      : `${m.name}의 일기 ${state.diary.filter(d => d.by === me).length}편도 같이 저장돼요. 다른 가족의 일기는 넣지 않아요.`;
  }
  const nameOf = id => (member(id) || {}).name || "";
  const whoText = e => who(e).length ? who(e).map(nameOf).filter(Boolean).join(", ") : "가족 전체";
  const fmtFull = s => { const d = parseYmd(s); return `${s} (${DOW[d.getDay()]})`; };
  function backupText() {
    const now = new Date(), L = [];
    L.push(`오니가족🩷 백업`, `만든 날: ${fmtDay(ymd(now))} ${pad(now.getHours())}:${pad(now.getMinutes())}${member(me) ? " · " + nameOf(me) + "의 기기" : ""}`, "");
    const evs = [...state.events].filter(e => e.date).sort(sortEv);
    L.push(`■ 일정 (${evs.length}개)`);
    evs.forEach(e => {
      const ty = typeOf(e);
      let line = `${fmtFull(e.date)} ${timeLabel(e)}  ${ty ? ty[1] + " " : ""}${e.title}  · ${whoText(e)}`;
      if (repeats(e)) line += `  [매주 ${DOW[parseYmd(e.date).getDay()]}요일 반복${e.until ? ", " + e.until + "까지" : ""}${(e.skip||[]).length ? ", 뺀 날 " + e.skip.join(" ") : ""}]`;
      L.push(line);
    });
    if (!evs.length) L.push("(없음)");
    L.push("", "■ 용돈 기록");
    const ids = [...new Set([...kids().map(m => m.id), ...state.allowance.map(a => a.to)])];
    ids.forEach(id => {
      const rows = state.allowance.filter(a => a.to === id).sort((a,b) => a.createdAt - b.createdAt);
      if (!rows.length && !member(id)) return;
      L.push("", `[${nameOf(id) || "(지운 가족)"}] 지금 잔액 ${won(balanceOf(id))}`);
      rows.forEach(a => { const d = new Date(a.createdAt || 0); L.push(`${ymd(d)}  ${a.amount > 0 ? "+" : ""}${won(a.amount)}  ${a.memo || (a.amount > 0 ? "용돈" : "사용")}${a.kind === "in" && a.from && a.from !== id ? " (보낸 사람: " + nameOf(a.from) + ")" : ""}`); });
      if (!rows.length) L.push("(기록 없음)");
    });
    const di = backupDiary();
    L.push("", di ? `■ ${nameOf(me)}의 일기 (${di.length}편)` : "■ 일기: 잠겨 있거나 기기 주인을 고르지 않아서 넣지 않았어요");
    (di || []).forEach(d => L.push("", `— ${d.date ? fmtFull(d.date) : ymd(new Date(d.createdAt))}${d.mood ? " · 기분: " + d.mood : ""}`, d.text || ""));
    return L.join("\n") + "\n";
  }
  function backupJson() {
    const strip = ({ id, ...d }) => ({ id, ...d });
    return JSON.stringify({
      app: "오니가족", format: 1, exportedAt: new Date().toISOString(), device: nameOf(me),
      members: state.members.map(({ pin, pinAt, ...m }) => m),
      events: state.events.map(strip), allowance: state.allowance.map(strip), diary: backupDiary() || [],
    }, null, 2);
  }
  async function saveFile(name, text, type) {
    const blob = new Blob([text], { type: type + ";charset=utf-8" });
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios && window.File && navigator.canShare) {
      const file = new File([blob], name, { type });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return true; }
        catch (e) { if (e && e.name === "AbortError") return false; }
      }
    }
    const url = URL.createObjectURL(blob), a = el("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
    return true;
  }
  const backupName = ext => `오니가족-백업-${todayStr()}.${ext}`;
  $("backup-txt").onclick = async () => { if (!ready()) return; if (await saveFile(backupName("txt"), backupText(), "text/plain")) toast("백업 파일을 만들었어요 💾"); };
  $("backup-json").onclick = async () => { if (!ready()) return; if (await saveFile(backupName("json"), backupJson(), "application/json")) toast("백업 파일을 만들었어요 💾"); };

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
  const APP_VERSION = "24";
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
