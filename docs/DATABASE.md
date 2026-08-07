# Supabase 데이터베이스 가이드

전체 배포 흐름: [DEPLOY.md](./DEPLOY.md)

## 구성 요약

| 항목 | 경로 |
|------|------|
| 마이그레이션 | `supabase/migrations/` |
| 시드 (SQL) | `supabase/seed.sql` |
| 시드 (앱) | `backend/src/seed-data.js` → `npm run reset-data` |
| SQL Editor 일괄 | `scripts/remote-schema.sql` |
| 로컬 CLI 설정 | `supabase/config.toml` |
| 환경변수 예시 | `.env.example` |
| MCP | `.mcp.json` |

### 스키마

```
companies (extras: pmo, notices, participantUpdateRequest)
  └── participants
        └── tasks (extras: startDate, endDate, goal, asIsProcess, toBeProcess, difficulty)
app_meta (key/value JSON — 대시보드 메타)
```

- RLS 활성. Express 서버는 **service role / secret key**로만 접근합니다.
- 프론트엔드는 Supabase 클라이언트를 직접 쓰지 않고 `/api/*`만 호출합니다.

적용된 마이그레이션 예:

- `20260806050925_init_dashboard_schema`
- `20260806080226_company_pmo_notices_task_details` (`extras` 컬럼)

## 환경변수

앱 런타임 (`backend/src/env.js`):

| 변수 | 역할 |
|------|------|
| `SUPABASE_URL` | 필수 (또는 `NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 둘 중 하나 필수 |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | 선택 |

Postgres 도구 전용 (Express 미사용):

| 변수 | 예 (Transaction pooler) |
|------|-------------------------|
| `DB_HOST` | `aws-0-ap-southeast-1.pooler.supabase.com` |
| `DB_PORT` | `6543` |
| `DB_USER` | `postgres.<PROJECT_REF>` |
| `DATABASE_URL` | `postgresql://postgres.<REF>:...@aws-0-<region>.pooler.supabase.com:6543/postgres` |

현재 운영 프로젝트: `winryyfctskibaajdyxv` (region **ap-southeast-1**).

키가 없으면 서버는 `backend/data/dashboard.json` 폴백을 사용합니다 (`/api/health` → `"db":"json-file"`).

## 원격 스키마·시드 적용

```bash
# A) link된 프로젝트
npm run db:push
npm run db:seed

# B) pooler URL
npx supabase db push --db-url "$DATABASE_URL" --yes

# C) 앱 시드로 덮어쓰기 (PMO/공지/과제 extras 포함)
npm run reset-data
```

SQL Editor: `scripts/remote-schema.sql` → `supabase/seed.sql`

### 무료 플랜 / 권한

활성 프로젝트 2개 한도로 신규 생성이 거절될 수 있습니다.  
CLI/MCP에 프로젝트 권한이 없으면 Dashboard SQL Editor 또는 `DATABASE_URL`을 사용하세요.

## 로컬 DB (Docker 필요)

```bash
npm run db:start      # supabase start
npm run db:reset      # migration + seed
npm run db:status     # URL/키 확인 후 .env에 반영
```

## 앱 연동 확인

```bash
npm start
# GET /api/health → { "db": "supabase" }
# GET /api/dashboard → companies / participants / tasks
# PUT /api/dashboard → Supabase upsert 후 즉시 GET으로 반영 확인
```

## 마이그레이션 추가

```bash
npm run db:migration:new -- <name>
# supabase/migrations/...sql 편집
npm run db:push
# remote-schema.sql도 동일 변경을 반영해 두면 SQL Editor 경로와 일치합니다
```
