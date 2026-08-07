# 배포 가이드 (Database + Hosting)

**1) Supabase DB 연동 → 2) 호스팅 배포** 순서입니다.

---

## 현재 상태

| 항목 | 상태 |
|------|------|
| 앱 (Express + static) | 준비됨 (`npm start` / `npm run dev`) |
| 기본 포트 | `3080` (`HOST` 개발=`127.0.0.1`, 운영=`0.0.0.0`) |
| 원격 프로젝트 | `winryyfctskibaajdyxv` (ap-southeast-1) |
| URL | `https://winryyfctskibaajdyxv.supabase.co` |
| API 키 | `SUPABASE_SECRET_KEY` (+ publishable) — `.env` 구성됨 |
| 스키마 | 마이그레이션 적용됨 (`companies`, `participants`, `tasks`, `app_meta` + `extras`) |
| 시드 | `supabase/seed.sql` / `npm run reset-data` |
| Docker / Render / Vercel | `Dockerfile`, `render.yaml`, `app.js` + `vercel.json` |

헬스체크: `GET /api/health` → `{ "ok": true, "db": "supabase" }`

> 참고: 계정 무료 플랜 한도로 `ax-pjt-dashboard` 신규 생성이 막힌 적 있어, 별도 프로젝트(`winryyfctskibaajdyxv`)를 사용합니다. CLI/MCP에 이 프로젝트 권한이 없으면 `DATABASE_URL`(pooler) 또는 SQL Editor로 스키마를 적용합니다.

---

## Phase 1. Supabase 연동 확인

로컬 `.env` 최소 구성:

```env
SUPABASE_URL=https://winryyfctskibaajdyxv.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# 또는 레거시 이름
# SUPABASE_ANON_KEY=...
# SUPABASE_SERVICE_ROLE_KEY=...
```

`backend/src/env.js`가 publishable→anon, secret→service_role 별칭을 처리합니다.  
`SUPABASE_SERVICE_ROLE_KEY`를 비워 두고 `SUPABASE_SECRET_KEY`만 있어도 `db: supabase`로 동작합니다.

Postgres CLI용(앱 런타임 미사용):

```env
DB_HOST=aws-0-ap-southeast-1.pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres.winryyfctskibaajdyxv
DB_PASSWORD=...
DATABASE_URL=postgresql://postgres.winryyfctskibaajdyxv:...@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

---

## Phase 2. DB 스키마·시드

### A) CLI (link 또는 DATABASE_URL)

```bash
# link 가능한 경우
npm run db:link
npm run db:push
npm run db:seed

# link 불가 시 pooler URL
npx supabase db push --db-url "%DATABASE_URL%" --yes
# 시드는 pg 클라이언트 또는 SQL Editor로 supabase/seed.sql 실행
```

Windows: `scripts\db-deploy.bat` (link 전제)

### B) SQL Editor (권한/네트워크 이슈 시)

1. `scripts/remote-schema.sql`
2. `supabase/seed.sql`

앱 시드로 맞추기: `npm run reset-data`

---

## Phase 3. 로컬 실행

```bash
copy .env.example .env
npm start
# 콘솔: DB driver: supabase
# http://127.0.0.1:3080/api/health → "db":"supabase"
```

| 변수 | 설명 |
|------|------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 (필수) |
| `SUPABASE_PUBLISHABLE_KEY` 또는 `SUPABASE_ANON_KEY` | 선택 |
| `ADMIN_PASSWORD` | 기본 `admin2026` |
| `HOST` / `PORT` | 개발 `127.0.0.1:3080` |

> 시크릿 키는 프론트엔드·Git에 넣지 마세요.

---

## Phase 4. 호스팅 배포

앱은 **Node(Express) 서버 1개**로 프론트+API를 제공합니다.  
정적 파일은 `public/`에 두며, Vercel에서는 CDN이 서빙합니다.

### 필수 환경변수

```
NODE_ENV=production
ADMIN_PASSWORD=<강한 비밀번호>
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...          # 또는 SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY=...     # 또는 SUPABASE_ANON_KEY (선택)
```

> **Vercel에서는 Supabase가 필수입니다.** 서버리스 파일시스템은 쓰기 불가이므로 JSON 폴백이 동작하지 않습니다.  
> `HOST`/`PORT`는 Vercel이 자동 주입합니다(직접 설정 불필요).

### 옵션 A — Vercel (권장)

준비된 파일: 루트 `app.js`(Express default export), `public/`, `vercel.json`.

1. [Vercel](https://vercel.com)에서 Git 저장소 Import, 또는 CLI:
   ```bash
   npx vercel          # preview
   npx vercel --prod   # production
   ```
2. Project → **Settings → Environment Variables**에 위 Supabase/ADMIN 값 등록 (Production + Preview 권장)
3. 배포 후 `https://<project>.vercel.app/api/health`  
   → `{ "ok": true, "db": "supabase", "runtime": "vercel" }`
4. 관리자 로그인·협력사 목록·저장 후 새로고침으로 유지 확인

로컬에서 Vercel 런타임 흉내: `npx vercel dev` (CLI ≥ 47.0.5)

리전: `vercel.json`의 `sin1`(싱가포르) — Supabase `ap-southeast-1`과 맞춤.

API는 `api/index.js` Serverless Function + `rewrites`로 연결됩니다.  
정적 UI는 `public/` CDN, `/api/*`는 Express 핸들러입니다.

### 옵션 B — Render (Blueprint)

1. [Render](https://render.com)에서 저장소 연결
2. `render.yaml` Blueprint로 생성
3. Dashboard에서 시크릿 입력 (`HOST=0.0.0.0`은 Blueprint에 포함)
4. Deploy → `https://<service>.onrender.com/api/health`

### 옵션 C — Docker

```bash
docker build -t ax-pjt-dashboard .
docker run --rm -p 3080:3080 --env-file .env -e HOST=0.0.0.0 ax-pjt-dashboard
```

### 옵션 D — Railway / Fly.io

- Start: `node backend/src/server.js`
- Root: 저장소 루트
- 동일 환경변수 (`HOST=0.0.0.0` 권장)

---

## Phase 5. 배포 후 검증

1. `/api/health` → `db: "supabase"`
2. 관리자 로그인 (`ADMIN_PASSWORD`)
3. 협력사/참여자/과제 표시 (시드·저장 데이터)
4. 데이터 수정 후 새로고침·재조회로 유지 확인
5. (선택) `PUT /api/dashboard` 후 Supabase Table Editor에서 행 확인

---

## 문제 해결

| 증상 | 조치 |
|------|------|
| `db: "json-file"` | `SUPABASE_URL` + secret/service_role 미설정·오타 |
| Vercel에서 JSON/저장 오류 | Supabase env 미설정 — Vercel은 JSON 폴백 불가 |
| `PGRST205` 테이블 없음 | `db:push` 또는 `scripts/remote-schema.sql` 적용 |
| `db.*.supabase.co` DNS/연결 실패 | IPv6/네트워크 제한 → **Transaction pooler** (`:6543`) `DATABASE_URL` 사용 |
| 마이그레이션 실패 | link 권한 또는 `--db-url` 사용 |
| Vercel 정적 404 | UI는 `public/`에 있어야 함 (`express.static`은 Vercel에서 무시) |
| Render sleep | Free 플랜 유휴 슬립 → 첫 요청 지연 |

상세 DB: [DATABASE.md](./DATABASE.md)
