# AI 프로젝트 통합 대시보드

UI 목업(`ui mokup/`)을 기반으로 구성한 Frontend + Backend 웹앱입니다.  
데이터 저장소는 **Supabase(Postgres)** 이며, 환경변수가 없으면 임시로 로컬 JSON으로 동작합니다.

## 실행

```bash
npm install
copy .env.example .env   # Windows
# SUPABASE_URL + SUPABASE_SECRET_KEY(또는 SERVICE_ROLE) 설정
npm start
# 개발 시 파일 감시: npm run dev
```

Windows에서는 `start.bat`을 더블클릭해도 됩니다.

| 항목 | 값 |
|------|-----|
| 접속 | http://127.0.0.1:3080 |
| Health | http://127.0.0.1:3080/api/health → `"db":"supabase"` |
| 관리자 비밀번호 | `ADMIN_PASSWORD` (기본 `admin2026`) |
| Vercel 배포 | [docs/DEPLOY.md](docs/DEPLOY.md#phase-4-호스팅-배포) (`vercel` / Git 연동) |

## 환경변수 (요약)

앱 서버(`backend/src/env.js`)가 인식하는 키:

| 변수 | 필수 | 설명 |
|------|------|------|
| `SUPABASE_URL` | DB 사용 시 | 프로젝트 URL |
| `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` | DB 사용 시 | 서버 전용 시크릿 (둘 중 하나) |
| `SUPABASE_PUBLISHABLE_KEY` 또는 `SUPABASE_ANON_KEY` | 선택 | publishable/anon (이 앱은 서버만 Supabase 호출) |
| `ADMIN_PASSWORD` | 선택 | 기본 `admin2026` |
| `PORT` / `HOST` | 선택 | 기본 `3080` / 개발 `127.0.0.1`, 운영 `0.0.0.0` |
| `DATABASE_URL`, `DB_*` | CLI/psql용 | Transaction pooler (`:6543`). Express는 사용하지 않음 |

상세: [docs/DATABASE.md](docs/DATABASE.md) · 배포: [docs/DEPLOY.md](docs/DEPLOY.md)

## 구조

```
app.js                    # Vercel Express 엔트리 (default export)
public/                   # 웹 UI (Vercel CDN + 로컬 static)
backend/src/              # Express API + Supabase/JSON store
backend/data/             # JSON 폴백 (로컬 전용, Vercel 불가)
supabase/migrations/      # DB 스키마 마이그레이션
supabase/seed.sql         # 시드 데이터
scripts/remote-schema.sql # SQL Editor 일괄 적용용 스키마
vercel.json               # Vercel 리전·Function 설정
docs/DEPLOY.md            # DB 연동 + Vercel/호스팅 배포
docs/DATABASE.md          # Supabase 상세
Dockerfile / render.yaml  # Docker / Render 배포
ui mokup/                 # 원본 목업/UX 문서 (참조용)
```

## DB 스크립트

```bash
npm run db:link           # supabase link
npm run db:push           # 마이그레이션 적용
npm run db:seed           # seed.sql 적재
npm run reset-data        # 앱 시드(seed-data.js)로 DB/JSON 초기화
```

CLI link가 안 되면 Dashboard **SQL Editor**에서 `scripts/remote-schema.sql` → `supabase/seed.sql` 순으로 실행하거나, `.env`의 `DATABASE_URL`(pooler)로 `supabase db push --db-url ...` 를 사용합니다.

## 로그인

- 관리자: 비밀번호 `admin2026` (또는 `.env`의 `ADMIN_PASSWORD`)
- 참여자 예시: 김민준 / `minjun.kim@example.com` (협력사: AX 제조혁신)

## 주요 API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스체크 (`db`: `supabase` \| `json-file`) |
| GET | `/api/dashboard` | 대시보드 데이터 조회 |
| PUT | `/api/dashboard` | 대시보드 데이터 저장 (전체 문서 덮어쓰기) |
| POST | `/api/auth/admin` | 관리자 로그인 |
| POST | `/api/auth/participant` | 참여자 로그인 |
| POST | `/api/auth/register` | 참여자 신규 등록 |
| POST | `/api/reports/publish` | 레포트 발행 요청 기록 |
| POST | `/api/participants/sync` | 참여자 명단 동기화 요청 기록 |
