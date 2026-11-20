// 🎵 아이브 노래: 유튜브 뮤직 앱(또는 사이트)에서 아이브 노래 모음을 열어요.
// 노래 파일은 앱에 넣지 않아요 (저작권). 우리 앱에는 영상창도 없어요.
// 목록: 유튜브 뮤직 공식 'Presenting IVE' 재생목록. 누를 때마다 시작 곡을 랜덤으로 골라요.
(() => {
  const btn = document.getElementById("music-btn");
  if (!btn) return;
  const LIST = "RDCLAK5uy_lnqcAaHruSFLBKg5wuEsmVEYndfGUmx2Y";
  const SIZE = 20; // 재생목록 앞쪽 20곡 중에서 랜덤 시작
  btn.addEventListener("click", () => {
    btn.href = "https://music.youtube.com/watch?list=" + LIST + "&index=" + (1 + Math.floor(Math.random() * SIZE));
  });
})();
