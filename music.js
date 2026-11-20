// 🎵 아이브 노래 랜덤 재생 (영상 없이 음원 위주)
// 노래 파일은 앱에 넣지 않아요 (저작권). 유튜브 공식 플레이어로
// 유튜브 뮤직 공식 재생목록 'Presenting IVE'(앨범 사진만 나오는 음원)를 섞어서 틀어요.
// 그 목록이 안 열리면 아이브 공식 뮤직비디오 목록으로 대신 틀어요.
(() => {
  // 지금은 노래 기능을 꺼 뒀어요. 다시 쓰려면 true로 바꾸면 버튼이 보이고 노래가 나와요.
  const ENABLED = false;
  if (!ENABLED) return;
  const wrap = document.getElementById("music-wrap"); if (wrap) wrap.hidden = false;
  const LIST = "RDCLAK5uy_lnqcAaHruSFLBKg5wuEsmVEYndfGUmx2Y";
  const BACKUP = ["--FmExEAsM8", "Y8JFxS1HlDo", "F0B7HDiY-10", "pG6iaOMV46I", "6ZUIwj3FgUY", "Da4P2uT4mVc", "07EzMbVH3QE", "38xYeot-ciM", "B1ShLiq3EVc"];
  const $ = id => document.getElementById(id);
  const btn = $("music-btn"), box = $("music-box"), now = $("music-now"), nextBtn = $("music-next");
  if (!btn || !box) return;

  let saved = null; try { saved = localStorage.getItem("fam-music"); } catch (e) {}
  let player = null, ready = false, on = saved !== "off", played = false, useBackup = false, bad = 0;

  const show = t => { now.textContent = t; now.title = t; };
  const cleanTitle = t => String(t || "").replace(/^IVE\s*[-–]\s*/i, "").replace(/\s*\((Official|Audio|MV)[^)]*\)\s*/gi, " ").trim();
  const setBtn = () => {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.querySelector(".st").textContent = on ? "켬" : "끔";
    btn.setAttribute("aria-label", on ? "노래 켜져 있음 (누르면 꺼요)" : "노래 꺼져 있음 (누르면 켜요)");
    box.hidden = !on;
  };
  const shuffledBackup = () => { const a = BACKUP.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const playBackup = () => {
    useBackup = true;
    player.loadPlaylist(shuffledBackup());
    player.setLoop(true);
  };
  const next = () => { if (ready) player.nextVideo(); };

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
    if (player) { if (ready) player.playVideo(); return; } // 다시 켜면 듣던 노래 이어서
    show("불러오는 중…");
    loadApi().then(() => {
      if (player) return;
      player = new YT.Player("music-yt", {
        width: 34, height: 34,
        playerVars: { listType: "playlist", list: LIST, autoplay: 1, playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            ready = true;
            player.setShuffle(true); player.setLoop(true);
            show("화면을 누르면 노래가 나와요");
            if (on) player.playVideoAt(0); else player.stopVideo();
          },
          onStateChange: e => {
            if (e.data === 1) {
              played = true; bad = 0;
              const d = player.getVideoData ? player.getVideoData() : {};
              if (d && d.title) show(cleanTitle(d.title));
            }
          },
          // 재생이 안 되는 곡은 건너뛰고, 목록 자체가 안 되면 뮤직비디오 목록으로 바꿔요
          onError: () => {
            if (!on) return;
            if (!played && !useBackup) { playBackup(); return; }
            if (++bad >= 10) { show("지금은 노래를 틀 수 없어요"); return; }
            next();
          }
        }
      });
    }).catch(() => show("유튜브에 연결할 수 없어요"));
  };

  btn.addEventListener("click", () => {
    on = !on; setBtn();
    try { localStorage.setItem("fam-music", on ? "on" : "off"); } catch (e) {}
    if (on) start(); else if (ready) player.pauseVideo();
  });
  nextBtn.addEventListener("click", () => { bad = 0; next(); });
  setBtn();

  // 켜져 있으면 앱을 열자마자 틀어요. 소리 나는 자동 재생을 막는 기기(아이폰·아이패드)는
  // 화면 아무 데나 처음 한 번 누르면 시작해요.
  if (on) start();
  const firstTap = e => {
    if (played) { document.removeEventListener("pointerdown", firstTap, true); return; }
    if (!on || !ready || btn.contains(e.target) || (e.target.closest && e.target.closest(".gate"))) return;
    if (player.getPlayerState() !== 1) player.playVideo();
  };
  document.addEventListener("pointerdown", firstTap, true);
})();
