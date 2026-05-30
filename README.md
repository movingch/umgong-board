# 생각보드

스마트폰 참석자가 사진이나 낙서를 올리면, PC 메인 화면에 보드판처럼 실시간 전시되는 회의용 웹앱입니다.

## 핵심 기능

- 새 보드 만들기
- PC용 보드 화면
- 스마트폰 참여 QR 코드
- 사진 업로드
- 모바일 손가락 낙서장
- 보드에 제출하기
- PC 화면 실시간 반영
- 클릭하면 큰 화면 확대
- 다시 클릭하면 원래 보드로 복귀

## 1. 로컬 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

Supabase 설정 전에는 데모 모드로 실행됩니다. 데모 모드는 같은 브라우저 안에서만 확인됩니다.

## 2. Supabase 설정

1. Supabase에서 새 프로젝트를 만듭니다.
2. `supabase/schema.sql` 파일 내용을 SQL Editor에서 실행합니다.
3. Storage에 `board-images` 버킷이 public으로 생성되었는지 확인합니다.
4. Realtime 또는 Replication 설정에서 `board_items` 테이블을 활성화합니다.
5. Project Settings > API에서 아래 값을 복사합니다.
   - Project URL
   - anon public key

`.env.local` 파일에 입력합니다.

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-SUPABASE-ANON-KEY
```

## 3. Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 New Project를 누르고 GitHub 저장소를 선택합니다.
3. Framework Preset은 Vite로 자동 인식됩니다.
4. Environment Variables에 다음 2개를 추가합니다.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy를 누릅니다.

## 4. 사용 방법

1. PC에서 `/` 접속 후 새 보드를 만듭니다.
2. PC 화면을 빔프로젝터에 띄웁니다.
3. 화면 오른쪽 QR코드를 참석자들이 스마트폰으로 찍습니다.
4. 참석자는 이름을 입력하고 사진 또는 낙서를 제출합니다.
5. PC 화면에 이미지가 자동으로 붙습니다.
6. 진행자는 이미지를 클릭해 크게 보여주며 설명합니다.

## 5. 보안 주의

현재 MVP는 회의 현장에서 빠르게 쓰기 위해 링크를 가진 사람이 누구나 볼 수 있고 올릴 수 있는 공개형입니다.
교회, 기관, 개인정보가 포함된 사진을 다룰 경우 다음 기능을 추가하는 것이 좋습니다.

- 보드 입장 비밀번호
- 방장 관리자 모드
- 삭제 권한 제한
- 자동 만료 시간
- 이미지 비공개 Storage 정책

## 6. 주요 파일

```txt
src/main.tsx          전체 앱 로직
src/styles.css        화면 디자인
src/lib/supabase.ts   Supabase 연결
supabase/schema.sql   데이터베이스/스토리지 정책
vercel.json           Vercel SPA 라우팅 설정
```
