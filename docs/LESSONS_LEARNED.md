# 교훈 기록: DB · 배포 오류와 재발 방지

> 프로젝트: `ax-pjt-dashboard` (Express + Supabase + Vercel)  
> 목적: 다음에 같은 함정에 빠지지 않도록 **원인 → 증상 → 해결 → 체크리스트**를 남긴다.

---

## 어떻게 “반복하지 않게” 하는가

| 방법 | 역할 |
|------|------|
| 이 문서 (`docs/LESSONS_LEARNED.md`) | **이 프로젝트의 사고 이력** (무엇을 겪었는지) |
| 개인 Cursor Skill (`supabase-vercel-checklist`) | **다음 프로젝트에서 에이전트가 자동으로 참고** |
| 배포 전 Preflight 체크리스트 (아래 §4) | **사람/에이전트가 순서대로 검증** |
| `.env.example` + `docs/DEPLOY.md` | **올바른 env·경로를 처음부터 문서화** |

권장 운영:

1. 새 레포 시작할 때 Preflight를 맨 위에 둔다.
2. Cursor에서 DB/배포 작업 시 개인 skill이 트리거되게 둔다.
3. 배포 직후 `GET /api/health` → `GET /api/dashboard`(또는 동등 API)를 **항상** 확인한다.
4. 시크릿은 Git에 넣지 않고, 호스팅 env에 **배포 전에** 넣는다.

---

## 1. Supabase / 데이터베이스

### 1.1 무료 플랜 프로젝트 한도

| | |
|--|--|
| **증상** | 신규 프로젝트 생성 거부 (2개 활성 제한) |
| **원인** | 계정에 이미 활성 프로젝트 존재 |
| **해결** | 기존 Pause/Delete, 또는 별도 프로젝트 URL 사용, 또는 플랜 업그레이드 |
| **방지** | 시작 전 `supabase projects list` / 대시보드에서 슬롯 확인 |

### 1.2 MCP/CLI에 프로젝트 권한 없음

| | |
|--|--|
| **증상** | `apply_migration` / `supabase link` 권한 오류. 계정 목록에 대상 ref가 없음 |
| **원인** | 키가 있는 프로젝트와 MCP 로그인 계정이 다름 |
| **해결** | Dashboard **SQL Editor** 또는 `DATABASE_URL`(pooler)로 스키마 적용 |
| **방지** | “누가 소유한 프로젝트인지”와 CLI 로그인 계정을 먼저 맞춘다 |

### 1.3 직접 DB 호스트 연결 실패 (IPv6 / ENOTFOUND)

| | |
|--|--|
| **증상** | `db.<ref>.supabase.co` DNS ENOTFOUND, IPv6만 응답, `ECONNREFUSED` |
| **원인** | 직접 연결은 IPv6·네트워크 제한에 취약 |
| **해결** | **Transaction pooler** 사용: `aws-0-<region>.pooler.supabase.com:6543`, user `postgres.<ref>` |
| **방지** | `.env`에 `DATABASE_URL`을 **처음부터 pooler**로 적는다. Express 앱 런타임은 URL이 아니라 **supabase-js + secret**을 쓴다 |

### 1.4 테이블 없음 (PGRST205)

| | |
|--|--|
| **증상** | `Could not find the table 'public.companies'` |
| **원인** | 키는 맞는데 마이그레이션 미적용 |
| **해결** | `db push --db-url …` 또는 `scripts/remote-schema.sql` → `seed.sql` |
| **방지** | health가 `supabase`여도 **테이블 존재·시드**를 별도 검증. `remote-schema.sql`을 migrations와 동기화 |

### 1.5 SQL 파일 문법 / 멀티 스테이트먼트

| | |
|--|--|
| **증상** | `#` 주석 syntax error; `cannot insert multiple commands into a prepared statement` |
| **원인** | Postgres는 `#` 미지원; `supabase db query -f`는 단일 prepared 제한 |
| **해결** | `--` 주석; 스키마는 `db push`, 시드는 `pg` 클라이언트 또는 SQL Editor |
| **방지** | remote SQL은 항상 `--`만 사용; 대량 DDL은 migration/`db push` |

### 1.6 시드에 extras 누락

| | |
|--|--|
| **증상** | DB에는 행이 있으나 PMO/공지/난이도가 비어 있음 |
| **원인** | SQL 시드가 `extras` jsonb를 안 넣음 |
| **해결** | `npm run reset-data` (앱 `seed-data.js`) 또는 extras 포함 seed.sql |
| **방지** | 앱 모델 ↔ SQL 시드를 같은 소스로 맞춘다 |

### 1.7 신규 API 키 별칭

| | |
|--|--|
| **증상** | `.env`에 `SUPABASE_SECRET_KEY`만 있고 `SERVICE_ROLE`이 비어 `json-file`로 동작 |
| **원인** | 코드가 legacy 이름만 봄 |
| **해결** | `env.js`에서 publishable↔anon, secret↔service_role 별칭 |
| **방지** | `.env.example`에 **신규 키 이름을 1순위**로 적고 별칭을 문서화 |

### 1.8 `JWT issued at future` (Vercel ↔ Supabase)

| | |
|--|--|
| **증상** | 간헐적 500, 메시지에 JWT issued at future |
| **원인** | 신규 secret 키의 단기 JWT와 시계 오차 |
| **해결** | 짧은 재시도; 지속 시 Legacy `service_role`(eyJ…)도 등록 |
| **방지** | 배포 직후 dashboard API를 2~3회 호출해 안정성 확인 |

---

## 2. Vercel / 배포

### 2.1 `functions.app.js` 패턴 오류

| | |
|--|--|
| **증상** | `pattern "app.js" doesn't match any Serverless Functions inside the api directory` |
| **원인** | `vercel.json`의 `functions`는 전통적 `api/` 경로를 기대. Express zero-config 엔트리와 충돌 |
| **해결** | `api/index.js`로 핸들러 export + `rewrites` → `/api`; `functions["api/index.js"]`만 설정 |
| **방지** | Express+static이면 **처음부터 `api/` 엔트리 + rewrite**를 기본으로 둔다 |

### 2.2 UI만 되고 API 404

| | |
|--|--|
| **증상** | `/` 200, `/api/health` 404 NOT_FOUND. UI: “데이터를 불러오지 못했습니다 / 요청에 실패했습니다” |
| **원인** | `framework: null` — 정적 `public/`만 배포되고 Express Function 미연결 |
| **해결** | 위 2.1 + 재배포 |
| **방지** | 배포 후 **반드시** `/api/health`를 curl. UI만 보고 성공으로 치지 않는다 |

### 2.3 `express.static` / `frontend` 폴더

| | |
|--|--|
| **증상** | Vercel에서 정적 자산 깨짐 |
| **원인** | Vercel은 `express.static()` 무시, `public/**`만 CDN |
| **해결** | UI를 `public/`에 둔다. 로컬은 Express static 유지 |
| **방지** | 레포 구조를 `public/` + `api/` + `backend/`로 시작 |

### 2.4 호스팅 env 누락

| | |
|--|--|
| **증상** | health `supabaseConfigured: false`, dashboard 503 |
| **원인** | 로컬 `.env`만 있고 Vercel Environment Variables 미등록 (`.env`는 Git 제외) |
| **해결** | `vercel env add` / Dashboard에 URL·SECRET·ADMIN 등록 후 **재배포** |
| **방지** | Git push 전에 “호스팅 env 등록”을 체크리스트 필수 항목으로 |

### 2.5 서버리스 FS에 JSON 폴백

| | |
|--|--|
| **증상** | Vercel에서 파일 쓰기 실패 / 데이터 미유지 |
| **원인** | 읽기 전용 파일시스템 |
| **해결** | Vercel에서는 Supabase 필수; JSON은 로컬 전용 |
| **방지** | `VERCEL` 감지 시 미설정이면 명확한 503 메시지 |

---

## 3. Git / 원격

| 이슈 | 교훈 |
|------|------|
| 최초에 git 없음 | push 전에 `git init` + `.gitignore`에 `.env`, `ui mokup/` |
| GitLab에 무관한 목업 이력 | unrelated merge 후 목업은 main에서 제거; 브랜치로 보존 가능 |
| 시크릿 채팅/커밋 | 유출 시 키 로테이션; `.env` 절대 커밋 금지 |

---

## 4. 다음 프로젝트 Preflight 체크리스트

배포 “완료” 판정 전에 모두 통과할 것.

### DB

- [ ] Supabase 프로젝트 슬롯/권한(계정 일치) 확인
- [ ] `.env`: `SUPABASE_URL` + secret(또는 service_role)
- [ ] CLI용 `DATABASE_URL`은 **pooler :6543** (`postgres.<ref>@aws-0-<region>.pooler…`)
- [ ] 마이그레이션 적용 (`db push` 또는 SQL Editor)
- [ ] 시드/샘플 행 존재
- [ ] 로컬 `GET /api/health` → `"db":"supabase"`
- [ ] 로컬 `GET /api/dashboard`(또는 동등) 200

### Vercel (Express + static)

- [ ] UI는 `public/`
- [ ] API 엔트리는 `api/index.js` (Express `createApp` export)
- [ ] `vercel.json`: `rewrites` → `/api`, `functions["api/index.js"]` (루트 `app.js`를 functions에 넣지 말 것)
- [ ] Vercel env에 URL/SECRET/ADMIN 등록 (Production + Preview)
- [ ] 배포 후 `https://<app>/api/health` → supabase
- [ ] 배포 후 데이터 API 200 (UI 새로고침까지)

### 보안

- [ ] `.env` gitignore
- [ ] service/secret 키는 서버·호스팅 env만
- [ ] 목업/대용량 비런타임 폴더는 push 제외 여부 결정

---

## 5. 이 레포에서 참고할 파일

| 파일 | 내용 |
|------|------|
| `docs/DEPLOY.md` | 배포 절차 |
| `docs/DATABASE.md` | 스키마·pooler·시드 |
| `.env.example` | env 이름 표준 |
| `api/index.js` + `vercel.json` | Vercel 연결 패턴 |
| `backend/src/env.js` | 키 별칭 |
| `scripts/remote-schema.sql` | SQL Editor 경로 |

---

## 6. 한 줄 요약

**로컬 `.env`가 맞아도, (1) 스키마 적용 (2) pooler (3) Vercel `api/`+rewrite (4) 호스팅 env 등록 (5) `/api/health` 실측**이 빠지면 같은 오류가 다시 난다.  
다음 프로젝트에서는 Preflight를 배포 Definition of Done에 넣는다.
