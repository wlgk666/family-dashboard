# 우리집 더그아웃

가족 4명이 계정 없이 링크 하나로 함께 쓰는 가족 보드예요. 일정, 할 일, 가정통신문, 일기, 용돈, 수다방, 사 주세요(장보기), 날씨(일산서구 탄현동)가 들어 있어요.

- 화면: 정적 웹사이트 (GitHub Pages)
- 데이터: Supabase 테이블 `docs` 하나. 가족 비밀번호의 sha256 값으로 행을 나누고, Row Level Security로 비밀번호를 아는 기기만 읽고 쓸 수 있어요.
- 실시간: 한 기기에서 바꾸면 Supabase Realtime 방송으로 다른 기기가 바로 다시 불러와요. 1분마다, 그리고 앱으로 돌아올 때도 새로 불러와요.
- 날씨: 브라우저에서 Open-Meteo를 바로 불러와요 (30분 캐시).

## 처음 설정

1. Supabase 프로젝트를 만들고 SQL Editor에서 `supabase/setup.sql`을 실행해요.
2. `config.js`에 Project URL과 anon public key를 넣어요.
3. GitHub 저장소 Settings → Pages에서 Branch를 `main` / `(root)`로 정해요.
4. 링크를 열고 가족 비밀번호를 정해요. 가족들에게 링크와 비밀번호를 알려 주면 끝이에요.

## 휴대폰에서 앱처럼 쓰기

- 아이폰: Safari로 열고 공유 → 홈 화면에 추가
- 안드로이드: Chrome 메뉴 → 홈 화면에 추가
