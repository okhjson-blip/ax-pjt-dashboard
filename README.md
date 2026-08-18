# AI 프로젝트 통합 대시보드

AX 컨설팅 과제의 **협력사·참여자·과제 진척·주간 보고**를 한 화면에서 관리하는 웹앱입니다.  
Frontend(static) + Express API + **Supabase(Postgres)** 구성이며, 환경변수가 없으면 로컬 JSON으로 폴백합니다.

## 주요 기능

| 영역 | 내용 |
|------|------|
| 로그인 | 참여자(협력사·이름·이메일) / 관리자(비밀번호) |
| 관리자 대시보드 | 협력사별 일정·PMO·참여자수·과제수, 과제 리스트(협력사·참여자·일정상태 필터), 협력사/과제 삭제 |
| 협력사 허브 | 운영 요약, 공지, 운영 체크, 과제별 진척현황(주간보고 작성완료/미작성 색상) |
| 개인 대시보드 | 과제·진척·주간 보고(금주 요약·차주 계획), 주차 선택으로 **과거 주간보고 조회** |
| 주간 스냅샷 | `task_weekly_reports`에 과제×주차 저장 — 이번 주만 편집, 과거 주는 읽기 전용 |
| 권한 | 참여자는 **본인 과제만** 열람·수정·저장 / 관리자는 전체 열람·피드백·운영 |
| 레포트 | 협력사 단위 주간 PDF 발행 |

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
| Vercel 배포 | [docs/DEPLOY.md](docs/DEPLOY.md) |
| DB 가이드 | [docs/DATABASE.md](docs/DATABASE.md) |
| 교훈·재발 방지 | [docs/LESSONS_LEARNED.md](docs/LESSONS_LEARNED.md) |
| 개발계획서 | [개발계획서.md](개발계획서.md) |
| UX 시나리오 | [UX시나리오설계서.md](UX시나리오설계서.md) |
| UI 디자인 | [UI디자인설계서.md](UI디자인설계서.md) |

## 환경변수 (요약)

앱 서버(`backend/src/env.js`)가 인식하는 키:

| 변수 | 필수 | 설명 |
|------|------|------|
| `SUPABASE_URL` | DB 사용 시 | 프로젝트 URL |
| `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` | DB 사용 시 | 서버 전용 시크릿 |
| `SUPABASE_PUBLISHABLE_KEY` 또는 `SUPABASE_ANON_KEY` | 선택 | publishable/anon (프론트는 API만 호출) |
| `ADMIN_PASSWORD` | 선택 | 기본 `admin2026` |
| `PORT` / `HOST` | 선택 | 기본 `3080` / 개발 `127.0.0.1`, 운영 `0.0.0.0` |
| `DATABASE_URL`, `DB_*` | CLI/psql용 | Transaction pooler (`:6543`). Express는 미사용 |

## 구조

```
api/index.js              # Vercel Serverless Function (`/api/*`)
app.js                    # 로컬 require용 (express 직접 import 없음)
public/                   # 웹 UI (Vercel CDN + 로컬 static)
  js/app.js               # 화면·권한·주간보고 UX
  js/utils.js             # 주차·일정·진척 계산
  css/styles.css
backend/src/              # Express API + Supabase/JSON store
  store-supabase.js       # companies → participants → tasks → weeklyReports
  seed-data.js
backend/data/             # JSON 폴백 (로컬 전용, Vercel 불가)
supabase/migrations/      # 스키마 마이그레이션 (task_weekly_reports 포함)
supabase/seed.sql
scripts/remote-schema.sql # SQL Editor 일괄 스키마
vercel.json               # api/index.js Function + public static + Fluid (Hobby 기본 duration)
docs/                     # DEPLOY / DATABASE / LESSONS_LEARNED
개발계획서.md
UX시나리오설계서.md
UI디자인설계서.md
ui mokup/                 # 원본 목업 (참조, gitignore 가능)
```

## 데이터 모델 (요약)

```
companies (PMO, 공지, 참여자 업데이트 요청)
  └── participants
        └── tasks (진척·주간보고 최신값 + 상세 extras)
              └── task_weekly_reports (week_number별 스냅샷)
app_meta
```

- `public` 테이블 RLS 활성, 서버는 **service_role / secret**만 사용
- 저장 시 `tasks` 최신 필드 갱신 + `(task_id, week_number)` 스냅샷 upsert

## DB 스크립트

```bash
npm run db:link           # supabase link
npm run db:push           # 마이그레이션 적용
npm run db:seed           # seed.sql 적재
npm run reset-data        # 앱 시드(seed-data.js)로 DB/JSON 초기화
```

CLI link가 안 되면 Dashboard **SQL Editor**에서 `scripts/remote-schema.sql` → `supabase/seed.sql` 순으로 실행하거나, `.env`의 `DATABASE_URL`(pooler)로 `supabase db push --db-url ...` 를 사용합니다.

## 로그인

- **관리자**: `.env`의 `ADMIN_PASSWORD` (기본 `admin2026`) — UI에 비밀번호를 노출하지 않음
- **참여자 예시**: 김민준 / `minjun.kim@example.com` (협력사: AX 제조혁신)

## 권한 규칙

| 역할 | 가능 |
|------|------|
| 참여자 | 협력사 허브 현황 열람, **본인** 개인 대시보드 열람·주간보고 저장·과제 관리 |
| 참여자 제한 | 타 참여자 상세보기/개인 대시보드 이동·저장 불가 |
| 관리자 | 전체 협력사·참여자·과제, 피드백 저장, 레포트 발행, 삭제 |

주간보고 저장 시 **금주 요약·차주 계획**이 모두 있어야 저장됩니다.

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

## 배포

1. Supabase 스키마·시드 적용 (`docs/DATABASE.md`)
2. Vercel/호스팅에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_PASSWORD` 등록
3. 절차 상세: [docs/DEPLOY.md](docs/DEPLOY.md)
