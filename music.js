// 🎵 아이브 노래 랜덤 재생
// 노래 파일은 앱에 넣지 않아요 (저작권). 아이브 공식 유튜브 뮤직비디오를
// 유튜브 공식 플레이어(IFrame API)로 틀어 줄 뿐이에요.
// 노래를 더 넣고 싶으면 아래 목록에 유튜브 주소의 v= 뒤 11글자를 추가하면 돼요.
(() => {
  const SONGS = [
    ["ELEVEN", "--FmExEAsM8"],
    ["LOVE DIVE", "Y8JFxS1HlDo"],
    ["After LIKE", "F0B7HDiY-10"],
    ["Kitsch", "pG6iaOMV46I"],
    ["I AM", "6ZUIwj3FgUY"],
    ["Baddie", "Da4P2uT4mVc"],
    ["해야 (HEYA)", "07EzMbVH3QE"],
    ["ATTITUDE", "38xYeot-ciM"],
    ["XOXZ", "B1ShLiq3EVc"]
  ];
  const $ = id => document.getElementById(id);
  const btn = $("music-btn"), box = $("music-box"), now = $("music-now"), hint = $("music-hint");
  const playBtn = $("music-play"), nextBtn = $("music-next"), offBtn = $("music-off");
  if (!btn || !box) return;

  // 켬/끔은 기기마다 기억해요. 처음엔 켜져 있어요.
  let saved = null; try { saved = localStorage.getItem("fam-music"); } catch (e) {}
  let player = null, ready = false, on = saved !== "off", cur = -1, bad = 0, hintTimer = 0, played = false;
  let order = [];

  // 한 바퀴 다 돌 때까지 같은 노래가 다시 나오지 않게 섞어요
  const pick = () => {
    if (!order.length) {
      order = SONGS.map((_, i) => i).filter(i => i !== cur);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    }
    cur = order.shift();
    return SONGS[cur];
  };
  const show = (txt) => { now.textContent = txt; };
  const setPlayIcon = playing => { playBtn.textContent = playing ? "⏸" : "▶"; playBtn.setAttribute("aria-label", playing ? "잠깐 멈춤" : "재생"); };
  const setBtn = () => {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.querySelector(".st").textContent = on ? "켬" : "끔";
    btn.setAttribute("aria-label", on ? "노래 켜져 있음 (누르면 꺼요)" : "노래 꺼져 있음 (누르면 켜요)");
    box.hidden = !on;
  };

  const playNext = () => {
    const [name, id] = pick();
    show("아이브 · " + name);
    if (ready) player.loadVideoById(id);
    armHint();
  };
  // 아이폰·아이패드는 처음 한 번은 영상 속 ▶를 직접 눌러야 할 때가 있어요
  const armHint = () => {
    clearTimeout(hintTimer); hint.hidden = true;
    hintTimer = setTimeout(() => {
      if (on && ready && player.getPlayerState && player.getPlayerState() !== 1) hint.hidden = false;
    }, 2500);
  };

  let apiLoading = null;
  const loadApi = () => apiLoading || (apiLoading = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { apiLoading = null; rej(); };
    document.head.append(s);
  }));

  const start = () => {
    if (player) { if (ready) { player.playVideo(); armHint(); } return; } // 다시 켜면 듣던 노래 이어서
    pick();
    show("불러오는 중…");
    loadApi().then(() => {
      if (player) return;
      player = new YT.Player("music-yt", {
        width: 200, height: 200, videoId: SONGS[cur][1],
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { ready = true; show("아이브 · " + SONGS[cur][0]); if (on) { player.playVideo(); armHint(); } else player.stopVideo(); },
          onStateChange: e => {
            setPlayIcon(e.data === 1);
            if (e.data === 1) { bad = 0; played = true; hint.hidden = true; const t = player.getVideoData && player.getVideoData().title; if (t) show(t); }
            if (e.data === 0 && on) playNext(); // 노래가 끝나면 다음 곡
          },
          // 재생이 안 되는 영상(지역 제한·삭제 등)은 건너뛰어요
          onError: () => { if (!on) return; if (++bad >= SONGS.length) { show("지금은 노래를 틀 수 없어요"); return; } playNext(); }
        }
      });
    }).catch(() => show("유튜브에 연결할 수 없어요"));
  };

  btn.addEventListener("click", () => {
    on = !on; setBtn();
    try { localStorage.setItem("fam-music", on ? "on" : "off"); } catch (e) {}
    if (on) start();
    else { clearTimeout(hintTimer); hint.hidden = true; if (ready) player.pauseVideo(); }
  });
  offBtn.addEventListener("click", () => btn.click());
  nextBtn.addEventListener("click", () => { bad = 0; playNext(); });
  playBtn.addEventListener("click", () => {
    if (!ready) return;
    if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo();
  });
  setBtn();

  // 켜져 있으면 앱을 열자마자 노래를 준비해요. 소리 나는 자동 재생이 허락된 기기는 바로 나오고,
  // 아이폰·아이패드처럼 막는 기기는 화면 아무 데나 처음 한 번 누르면 나와요.
  if (on) start();
  const firstTap = e => {
    if (played) { document.removeEventListener("pointerdown", firstTap, true); return; }
    if (!on || !ready || btn.contains(e.target) || box.contains(e.target) || (e.target.closest && e.target.closest(".gate"))) return;
    if (player.getPlayerState() !== 1) player.playVideo();
  };
  document.addEventListener("pointerdown", firstTap, true);
})();
