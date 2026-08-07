-- 시드 데이터 (UI 목업 / seed-data.js 기준)
-- 재실행 시 기존 테스트 행을 덮어씁니다.

truncate table public.tasks, public.participants, public.companies, public.app_meta restart identity cascade;

insert into public.companies (id, name, start_date, kickoff_date, end_date, extras) values
  (
    'c1', 'AX 제조혁신', '2026-07-06', '2026-07-08', '2026-09-04',
    '{
      "pmo": {"name": "한지민", "email": "jimin.han@example.com"},
      "notices": [
        {
          "id": "n1",
          "title": "킥오프 일정 안내",
          "content": "7월 8일 KickOff 미팅에 참석해 주세요. 사전 과제 범위를 점검합니다.",
          "createdAt": "2026-07-05T10:00:00+09:00"
        }
      ],
      "participantUpdateRequest": {
        "pending": false,
        "message": "",
        "requestedAt": null,
        "acknowledgedAt": null
      }
    }'::jsonb
  ),
  (
    'c2', '스마트 리테일랩', '2026-07-13', '2026-07-15', '2026-09-11',
    '{
      "pmo": {"name": "오세린", "email": "serin.oh@example.com"},
      "notices": [],
      "participantUpdateRequest": {
        "pending": false,
        "message": "",
        "requestedAt": null,
        "acknowledgedAt": null
      }
    }'::jsonb
  ),
  (
    'c3', '헬스케어 데이터팀', '2026-07-20', '2026-07-22', '2026-09-18',
    '{
      "pmo": {"name": "", "email": ""},
      "notices": [],
      "participantUpdateRequest": {
        "pending": false,
        "message": "",
        "requestedAt": null,
        "acknowledgedAt": null
      }
    }'::jsonb
  );

insert into public.participants (
  id, company_id, name, email, dept, status, summary, next_week_plan, instructor_memo
) values
  (
    'p1', 'c1', '김민준', 'minjun.kim@example.com', '생산기획', '정상',
    '공정 병목 데이터를 정리하고 AI 분석 과제의 입력 항목을 확정했습니다.',
    '불량률 예측 모델의 기준 데이터를 보강하고 현업 검증 회의를 진행합니다.',
    '데이터 범위가 명확합니다. 다음 주에는 모델 결과를 업무 의사결정과 연결해 보세요.'
  ),
  (
    'p2', 'c1', '이서연', 'seoyeon.lee@example.com', '품질관리', '정체',
    '검사 기준서와 샘플링 데이터를 취합 중입니다.',
    '누락된 검사 항목을 보완하고 대시보드 지표 후보를 정리합니다.',
    '정체 원인이 데이터 누락인지 업무 범위 이슈인지 구분해 주세요.'
  ),
  (
    'p3', 'c1', '박지훈', 'jihoon.park@example.com', '생산기획', '정상',
    '', '', ''
  ),
  (
    'p4', 'c2', '최유진', 'yujin.choi@example.com', 'CRM', '정상',
    '고객 세그먼트 기준을 4개 그룹으로 정리했습니다.',
    '캠페인 반응률 예측 지표를 추가 검토합니다.',
    '세그먼트 기준을 의사결정자가 이해하기 쉬운 언어로 바꿔보세요.'
  );

insert into public.tasks (
  id, participant_id, name, progress, weekly_summary, next_week_plan, instructor_feedback, report_completed, extras
) values
  (
    't1', 'p1', '공정 데이터 수집', 82,
    '공정 병목 데이터를 정리하고 AI 분석 과제의 입력 항목을 확정했습니다.',
    '불량률 예측 모델의 기준 데이터를 보강합니다.',
    '데이터 범위가 명확합니다.', true,
    '{
      "difficulty": "상",
      "startDate": "2026-07-08",
      "endDate": "2026-07-25",
      "goal": "병목 구간 식별을 위한 기준 데이터셋 확보",
      "asIsProcess": "수기 수집 > 엑셀 취합 > 담당자 검토",
      "toBeProcess": "센서 연동 > 자동 정제 > 대시보드 반영"
    }'::jsonb
  ),
  (
    't2', 'p1', '불량 원인 후보 정의', 64, '', '', '', false,
    '{
      "difficulty": "중",
      "startDate": "2026-07-15",
      "endDate": "2026-08-05",
      "goal": "주요 불량 원인 3건 이상 정의",
      "asIsProcess": "현장 경험 기반 추정 > 회의 공유",
      "toBeProcess": "데이터 기반 후보 도출 > 현업 검증"
    }'::jsonb
  ),
  (
    't3', 'p1', '현업 인터뷰', 72, '', '', '', false,
    '{
      "difficulty": "하",
      "startDate": "2026-07-20",
      "endDate": "2026-08-10",
      "goal": "핵심 공정 담당자 인터뷰 완료",
      "asIsProcess": "개별 면담 > 메모 정리",
      "toBeProcess": "구조화 질문지 > 요약 자동 정리"
    }'::jsonb
  ),
  (
    't4', 'p2', '검사 데이터 정제', 38, '', '', '', false,
    '{"difficulty": "상", "startDate": "2026-07-10", "endDate": "2026-08-01"}'::jsonb
  ),
  (
    't5', 'p2', '품질 지표 설계', 44, '', '', '', false,
    '{"difficulty": "중", "startDate": "2026-07-20", "endDate": "2026-08-15"}'::jsonb
  ),
  (
    't6', 'p4', '고객 세그먼트 정의', 76,
    '세그먼트 기준 정의 완료', '반응률 지표 검토', '', true,
    '{"difficulty": "중", "startDate": "2026-07-15", "endDate": "2026-08-05"}'::jsonb
  ),
  (
    't7', 'p4', '캠페인 반응 분석', 58, '', '', '', false,
    '{"difficulty": "상", "startDate": "2026-07-25", "endDate": "2026-08-20"}'::jsonb
  );

insert into public.app_meta (key, value) values
  ('dashboard', '{"lastReportRequestAt": null, "lastParticipantSyncAt": null}'::jsonb);
