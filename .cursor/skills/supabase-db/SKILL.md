---
name: supabase-db
description: >-
  Project database work with Supabase Postgres, migrations, RLS, and supabase-js.
  Use when creating schema, storing app data, writing queries, auth-linked tables,
  replacing local JSON/file storage, or any database/persistence task in this project.
---

# Supabase DB (ax-pjt-dashboard)

## When this skill applies

- 스키마/테이블/인덱스/RLS 작업
- 앱 데이터 저장·조회 API 설계
- `backend/data/*.json` 등 로컬 저장소를 DB로 대체
- Auth와 연동된 권한·정책 설계

## Instructions

1. 먼저 설치된 **Supabase** skill을 읽고 그 절차를 따른다.
2. 문서/CLI가 필요하면 Supabase skill의 docs·CLI·MCP 지침을 따른다.
3. 이 프로젝트에 두 번째 DB(JSON 파일 스토어를 주 저장소로 쓰는 방식, SQLite 등)를 추가하지 않는다. JSON은 env 미설정 시 **임시 폴백**만 허용한다.
4. 스키마 변경 시:
   - `npm run db:migration:new` / `supabase migration new <name>`으로 마이그레이션을 작성한다.
   - `scripts/remote-schema.sql`에도 동일 변경을 반영한다.
   - `npm run db:push` 또는 `DATABASE_URL`(Transaction pooler `:6543`)로 적용 후 검증한다.
5. API 연동 시:
   - 이 앱의 Supabase 호출은 **Express 서버만** 수행한다 (`SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`).
   - 프론트에는 시크릿을 넣지 않는다. publishable/anon은 선택·별칭용이다 (`backend/src/env.js`).
6. `public` 테이블은 RLS를 켠다. 서버는 service role로 RLS를 우회한다.

## Project notes

- 도메인: **협력사**(companies), 참여자(participants), 과제(tasks), 일정(schedule), 주간보고, PMO/공지(`companies.extras`), 과제 상세(`tasks.extras`).
- 테이블: `companies`, `participants`, `tasks`, `app_meta`.
- Google Sheets/GAS는 외부 발행 채널로 두고, **원본 데이터 저장소는 Supabase**로 둔다.
- 문서: `docs/DATABASE.md`, `docs/DEPLOY.md`, `.env.example`.
