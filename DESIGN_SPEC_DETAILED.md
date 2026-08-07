# [상세 설계서] AI 실습 프로젝트 통합 스마트 대시보드

> 본 문서는 `src/App.jsx`(1,732줄), `src/firebase.js`, `package.json`, `vite.config.js`, `tailwind.config.js`, 기존 `DESIGN_SPEC_v1.md`, `docs/dashboard0225_backup.md` 등 저장소 내 실제 코드를 직접 읽고 분석하여 작성한 상세 설계서입니다.
> 최종 작성일: 2026-08-03 (커밋 `c20bca3` 기준)

---

## 1. 시스템 개요

| 항목 | 내용 |
|---|---|
| 목적 | AI 실습(컨설팅) 프로젝트의 참여 업체·참여자 진척도 관리, 실시간 소통, 강사 피드백, 결과 보고서의 구글 시트 발행을 하나의 웹앱으로 통합 |
| 사용자 역할 | ① 관리자(강사) — 비밀번호 로그인, 전체 업체/참여자 CRUD 권한 ② 참여자(수강생) — 이름/이메일/부서로 로그인 또는 자율 등록, 본인 데이터만 편집 가능 |
| 데이터 저장 | Firebase Cloud Firestore 단일 문서(`dashboard/data`) + 실시간 구독(`onSnapshot`) |
| 외부 연동 | Google Apps Script(GAS) Webhook → Google Sheets에 참여자 명단/주간 레포트 발행 |
| 배포 형태 | Vite 정적 빌드 SPA (백엔드 서버 없음, Firestore가 유일한 원격 상태 저장소) |

---

## 2. 기술 스택

```
Frontend    : React 19.2 + Vite 7.3 (SWC 아님, @vitejs/plugin-react 사용, Babel 기반 Fast Refresh)
Styling     : TailwindCSS 3.4 (postcss + autoprefixer)
State       : React useState/useEffect/useRef (전역 상태 관리 라이브러리 없음, App.jsx 최상단에서 prop drilling)
DB          : Firebase Firestore (firebase SDK 12.9)
연동        : Google Apps Script (fetch, mode: "no-cors")
기타 의존성 : file-saver ^2.0.5, xlsx ^0.18.5 (package.json에는 있으나 App.jsx 내 실제 import/사용처 없음 — 사용되지 않는 의존성으로 추정)
Lint        : ESLint 9 (flat config) + eslint-plugin-react-hooks, react-refresh
```

**컴포넌트 트리 구조 특이사항**: 프로젝트 전체가 `src/App.jsx` 단일 파일(1,732줄)에 모든 컴포넌트가 정의되어 있음. 별도 컴포넌트 디렉토리(`src/components` 등)가 없고, 라우터도 사용하지 않음 — 탭 상태(`useState("company")`)로 화면을 전환하는 SPA 구조.

---

## 3. 디렉토리 구조

```
ai-dashboard/
├─ index.html                 # Vite 엔트리, <div id="root"> + main.jsx 로드
├─ package.json
├─ vite.config.js             # react() 플러그인만 등록, 별도 alias/proxy 없음
├─ tailwind.config.js         # content: index.html, src/**/*.{js,ts,jsx,tsx}
├─ postcss.config.js
├─ eslint.config.js
├─ test_gas.js                # GAS 엔드포인트 단독 테스트용 스크립트 (node 실행, App과 무관)
├─ DESIGN_SPEC_v1.md          # 기존 v1.0 설계 요약 문서
├─ docs/
│  ├─ dashboard0225_backup.md # 2026-02-25 시점 UI/기능 스냅샷 (마크다운 목업)
│  └─ legacy_dashboard.jsx    # 구버전 컴포넌트 백업 (현재 App.jsx와 분리, 미사용 추정)
├─ public/
│  └─ vite.svg
└─ src/
   ├─ main.jsx                # ReactDOM.createRoot → <App />
   ├─ App.jsx                 # 전체 화면·상태·로직 (핵심 파일)
   ├─ firebase.js             # Firebase 초기화 및 db export
   ├─ index.css / App.css
   └─ assets/react.svg
```

---

## 4. 데이터 모델 (Firestore: `dashboard/data`)

단일 문서 안에 `companies` 배열 하나로 전체 상태를 관리하는 **비정규화(Denormalized) 단일 문서 모델**.

```ts
dashboard/data: {
  companies: Company[]
}

Company {
  id: string                // "u_<timestamp36>_<random6>" (uid() 유틸)
  name: string               // 업체명
  participants: Participant[]
  chat: ChatMessage[]
  schedule?: {               // 업체별 프로젝트 일정 (관리자 전용 설정)
    startDate: string        // "YYYY-MM-DD"
    kickoffDate?: string
    endDate: string
  }
}

Participant {
  id: string
  name: string
  email: string
  dept: string
  status: "정상" | "정체"          // 참여자 본인이 직접 토글
  tasks: Task[]
  summary: string                  // 금주 요약 보고 (참여자 작성)
  nextWeekPlan?: string             // 차주 계획 (참여자 작성)
  aiReport?: string                 // AI 컨설팅 결과 텍스트 (초기 시드 데이터에만 존재, UI에서 편집 경로 없음 — ReportModal에서 읽기만 함)
  instructorMemo: string             // 강사 피드백 (관리자만 편집)
}

Task {
  id: string
  name: string
  progress: number     // 0~100 (참여자가 range 슬라이더로 직접 조정)
  delta: number         // 전주 대비 증감 % (수동 세팅값, 자동 계산 로직 없음 — 초기 시드에만 존재, UI에서 갱신 경로 없음)
}

ChatMessage {
  id: string
  role: "강사" | "참여자"
  senderId?: string      // "admin" 혹은 participant.id — 작성자 식별, 수정/삭제 권한 판정에 사용
  text: string
  createdAt: string (ISO)
  replies?: ChatMessage[] // 답글 (1 depth만 지원, 답글의 답글 없음)
}
```

### 4.1 데이터 흐름 특이사항
- **낙관적 UI(Optimistic Update)**: `updateCompanies()`가 로컬 `setCompanies()`를 먼저 실행한 뒤 `setDoc()`으로 Firestore에 즉시 반영. 실패 시 롤백 로직은 없음(성공을 가정).
- **실시간 동기화**: `onSnapshot(doc(db,"dashboard","data"))`으로 다른 브라우저 탭/사용자의 변경사항을 실시간 반영. 최초 문서가 없으면 `INIT` 시드 데이터로 생성.
- **동시성 처리 없음**: 문서 전체를 항상 통째로 `setDoc`(덮어쓰기)하므로, 두 사용자가 동시에 편집하면 나중에 쓴 쪽이 이전 변경을 덮어쓸 수 있는 **Last-Write-Wins 경쟁 조건**이 존재함 (트랜잭션/`updateDoc` 미사용).
- **`delta`(전주 대비 증감)와 `aiReport`는 시드 데이터에만 존재**하고 실제 앱 조작으로 값이 갱신되는 경로가 코드상 없음 — 사실상 정적 필드.

---

## 5. 인증/권한 모델

- 별도 인증 서버 없음. `App` 컴포넌트의 `authState` 로컬 state로만 관리 (새로고침 시 초기화됨 — 세션 영속화 없음, 단 마지막 선택 `companyId`만 `localStorage["ai-dashboard-cid"]`로 유지).
- **관리자(admin) 로그인**: 하드코딩된 비밀번호 `"admin1234"`를 클라이언트 코드(`App.jsx:331`)에서 직접 비교. → **보안 취약점**: 브라우저 개발자 도구로 소스를 열람하면 누구나 관리자 비밀번호를 확인 가능. Firestore 보안 규칙 상에서도 role 검증이 없다면 참여자 계정으로도 관리자와 동일한 쓰기 권한을 실제로는 가짐(클라이언트 UI에서만 숨겨짐).
- **참여자 로그인**: 업체 선택 + 이름/이메일 일치 여부로 기존 참여자 판별. 일치하는 사람이 없으면 부서 입력을 받아 신규 등록(`onRegister` → `addParticipant`) 후 자동 로그인.
- **권한 분기**: `isAdmin`, `isMine`(본인 데이터 여부) 두 플래그로 각 컴포넌트 내 편집 가능 여부를 분기. 예) `PersonalDashboard`의 진척도 슬라이더는 `isMine`일 때만 노출, 강사 메모는 `isAdmin`일 때만 편집 가능.

---

## 6. 화면/컴포넌트 명세

### 6.1 LoginScreen
- 탭 전환(관리자 / 참여자), 관리자 탭은 비밀번호 입력 폼, 참여자 탭은 업체 select + 이름/이메일 입력.
- 참여자가 미등록 상태면 부서 입력 필드가 추가로 나타나며 "신규 등록하고 접속" 플로우로 전환.

### 6.2 InstructorView (관리자 전용, `tab === "instructor"`)
- 상단 통계 카드 3종: 총 업체 수 / 총 참여자 / 평균 진척도 (`StatCard`).
- 업체별 일정 관리 그리드: 업체마다 시작일/KickOff/종료일 표시, `ScheduleEditModal`로 편집.
- 전사 실습 현황 테이블: 전체 참여자를 평탄화(flatMap)하여 업체명/이름/과제/진척도/상태/강사메모/관리버튼(과제추가·수정·삭제)을 한 테이블에 표시.
- 우측 상단 버튼: "참여자 업데이트"(GAS로 명단 전송), "업체 추가"(`AddCompanyModal`).

### 6.3 CompanyHub (`tab === "company"`)
- 좌측: 부서별로 그룹핑된 참여자 리스트(부서명 알파벳/가나다순 정렬, 부서 내 이름순 정렬), 진척도 바, "상세보기" 링크 → `PersonalDashboard`로 이동.
- 우측: 실시간 채팅(`chat` 배열). 메시지 hover 시 답글/수정/삭제 액션 노출. 답글은 1단계 depth만 지원. 발신자 식별은 `senderId` 기준, 없으면 `role` 문자열로 폴백(구버전 데이터 호환).
- 관리자에게만 "레포트 발행" 버튼 노출 → `ReportModal`.
- "참여자 등록" 버�는 관리자·참여자 모두에게 노출(`AddParticipantModal`).

### 6.4 PersonalDashboard (`tab === "personal"`)
- 헤더: 이름/부서/이메일/전체 진척도(%), 상태 뱃지(참여자 본인만 select로 변경 가능).
- **일정 대비 실적 카드**: `schedule.startDate` ~ `endDate` 경과일 비율로 "목표 달성률(targetPct)"을 계산하고, 실제 평균 진척도(actualPct)와 비교하여 3단계 상태 산출:
  - `actualPct - targetPct >= 0` → "양호"(초록)
  - `>= -15` → "정상"(노랑)
  - 그 미만 → "정체"(빨강)
- 과제 목록: range 슬라이더로 진척도 직접 조정(본인만), 과제 추가/삭제(본인만).
- 금주 요약/차주 계획: 텍스트 편집(본인만), 저장 시 `onUpdate`로 Firestore 반영.
- 강사 피드백 메모: 관리자만 편집, 참여자는 읽기 전용.

### 6.5 공용 모달
`Overlay`(배경 클릭 시 닫힘, 내부 클릭 전파 차단), `AddCompanyModal`, `DeleteCompanyModal`, `DeleteParticipantModal`, `AddTaskModal`, `AddParticipantModal`, `ScheduleEditModal`, `ReportModal` — 모두 동일한 카드형 UI 패턴(rounded-2xl, shadow-2xl) 재사용.

### 6.6 ReportModal (주간 레포트 발행)
- `getCurrentConsultingWeek()`: 2026-02-23(월)을 9주차 기준점으로 삼아 현재 날짜와의 주 차이를 더해 자동으로 "현재 컨설팅 주차"를 계산 (하드코딩된 기준일 — 매 기수/매년 코드 수정 필요).
- 관리자가 "주요 전달 내용" 공통 메모를 입력하고 "스프레드시트 발행" 클릭 시 `publishReportToGoogleSheets()` 호출.
- 참여자별 과제/요약/AI레포트/강사메모를 카드 형태로 미리보기.

---

## 7. 주요 비즈니스 로직 (유틸 함수)

| 함수 | 위치 | 설명 |
|---|---|---|
| `uid()` | App.jsx:8 | `u_<base36 timestamp>_<random6>` 형태 ID 생성기 (충돌 가능성 낮으나 UUID 표준은 아님) |
| `avgProgress(p)` | App.jsx:70 | 참여자의 과제 진척도 평균(반올림). 과제 0개면 0 |
| `pColor(v)` | App.jsx:74 | 70↑ 에메랄드 / 40↑ 앰버 / 그 외 로즈 색상 매핑 |
| `sBadge(s)` | App.jsx:76 | 상태값에 따른 뱃지 클래스 |
| `getCurrentConsultingWeek()` | App.jsx:461 | 기준일(2026-02-23=9주차) 대비 경과 주수를 더해 현재 컨설팅 주차 계산 |

---

## 8. 외부 연동: Google Apps Script (GAS)

```
GAS_URL = "https://script.google.com/macros/s/AKfycbwcaZ.../exec"  (App.jsx:589, 운영용)
test_gas.js 의 URL은 다른 배포본 (.../AKfycbzADK.../exec, 테스트/구버전 추정)
```

- 두 가지 `action`:
  1. `publishReport` — 업체별 부서 통계(총/완료/진행중 과제 수), 금주 요약 텍스트(관리자 공통 메모 + 참여자별 요약), 차주 계획 텍스트를 조합하여 POST.
  2. `updateParticipants` — 전체 참여자 명단(업체/부서/이름/이메일)을 POST하여 구글시트 '참여자' 탭 갱신.
- 요청은 `mode: "no-cors"`로 전송 — **응답 본문을 읽을 수 없으므로 실제 성공 여부를 확인하지 않고 무조건 "성공" alert를 띄움** (fetch가 네트워크 레벨에서 실패하지 않는 한 항상 성공 메시지 표시됨). 서버 측 처리 실패를 클라이언트가 감지할 방법이 없음.
- GAS URL이 클라이언트 코드에 그대로 노출되어 있어, URL을 아는 누구나 동일한 payload로 스프레드시트에 데이터를 발행 가능(엔드포인트 자체 인증 없음).

---

## 9. 상태 관리 아키텍처 다이어그램

```
Firestore(dashboard/data) ──onSnapshot──▶ App.companies (state)
        ▲                                        │
        │ setDoc (전체 덮어쓰기)                    ▼
        └──────── updateCompanies() ◀── addCompany/addParticipant/
                                          deleteCompany/deleteParticipant/
                                          updateParticipant/addTask/deleteTask/
                                          updateCompanySchedule/
                                          addChat/editChat/deleteChat/
                                          addReply/editReply/onDeleteReply
                                                │
                    각 하위 컴포넌트(InstructorView, CompanyHub,
                    PersonalDashboard)로 콜백 형태 prop drilling
```

- 전역 상태 관리 라이브러리(Redux, Zustand, Context API 등) 없이 `App` 최상단에서 모든 핸들러를 정의하고 props로 하위 전달. 컴포넌트 depth가 깊지 않아(최대 2~3단계) 현재는 문제 없으나, 기능 확장 시 prop 수 증가에 유의 필요.

---

## 10. 알려진 이슈 및 개선 권고사항

| 구분 | 내용 | 권고 |
|---|---|---|
| 🔴 보안 | 관리자 비밀번호(`admin1234`)가 프론트엔드 소스에 평문 하드코딩 | Firebase Authentication(Custom Claims) 등 서버 검증 방식으로 전환 필요 |
| 🔴 보안 | Firestore 보안 규칙 파일(`firestore.rules`)이 저장소에 없음 — 현재 규칙이 test mode(전체 허용)라면 인증 없이 외부에서 문서 전체를 읽기/쓰기 가능 | Firestore 콘솔에서 규칙 확인 및 역할 기반 규칙 적용 권장 |
| 🟠 신뢰성 | GAS 연동이 `no-cors`로 응답을 검증하지 않아 실패해도 "성공" 메시지 표시 | GAS 측에서 CORS 허용 응답을 반환하도록 수정하고 응답 상태를 실제로 확인 |
| 🟠 신뢰성 | Firestore 문서 전체를 `setDoc`으로 매번 덮어써서 동시 편집 시 데이터 유실 가능 (Last-Write-Wins) | 부분 갱신이 가능한 하위 컬렉션 구조로 리팩터링하거나 `runTransaction` 사용 검토 |
| 🟡 유지보수 | `getCurrentConsultingWeek()` 기준일이 하드코딩(2026-02-23) | 기수 시작일을 설정값(Firestore 또는 환경변수)으로 분리 권장 |
| 🟡 유지보수 | `src/App.jsx` 단일 파일 1,732줄에 모든 컴포넌트 정의 | 기능 단위로 `components/` 디렉토리 분리 시 가독성/재사용성 개선 |
| 🟡 정리 | `file-saver`, `xlsx` 의존성이 설치되어 있으나 실제 사용 코드 없음 | 미사용 시 제거하여 번들 크기 축소 |
| 🟡 정리 | `docs/legacy_dashboard.jsx`, `test_gas.js`가 저장소 루트에 혼재 | `scripts/`, `docs/archive/` 등으로 정리 권장 |
| 🟢 정보 | `task.delta`, `participant.aiReport`는 초기 시드에만 존재하고 실제 갱신 UI 경로가 없음 | 향후 "전주 대비 자동 계산" 및 "AI 레포트 자동 생성 엔진 연동"(README의 Next Steps) 구현 시 이 필드들의 갱신 로직을 추가해야 함 |

---

## 11. 로컬 개발 실행 방법

```bash
npm install
npm run dev      # http://localhost:5173 (Vite 기본 포트)
npm run build    # dist/ 정적 빌드
npm run preview  # 빌드 결과 로컬 미리보기
npm run lint     # ESLint 검사
```

Firebase 프로젝트(`aidash-d831b`)는 `src/firebase.js`에 이미 설정되어 있어 별도 `.env` 설정 없이 바로 Firestore에 연결됨.
