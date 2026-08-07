/** 초기 시드 데이터 (UI 목업 기준) */
function createSeedData() {
  return {
    companies: [
      {
        id: "c1",
        name: "AX 제조혁신",
        schedule: { startDate: "2026-07-06", kickoffDate: "2026-07-08", endDate: "2026-09-04" },
        pmo: { name: "한지민", email: "jimin.han@example.com" },
        notices: [
          {
            id: "n1",
            title: "킥오프 일정 안내",
            content: "7월 8일 KickOff 미팅에 참석해 주세요. 사전 과제 범위를 점검합니다.",
            createdAt: "2026-07-05T10:00:00+09:00"
          }
        ],
        participantUpdateRequest: {
          pending: false,
          message: "",
          requestedAt: null,
          acknowledgedAt: null
        },
        participants: [
          {
            id: "p1",
            name: "김민준",
            email: "minjun.kim@example.com",
            dept: "생산기획",
            status: "정상",
            summary: "공정 병목 데이터를 정리하고 AI 분석 과제의 입력 항목을 확정했습니다.",
            nextWeekPlan: "불량률 예측 모델의 기준 데이터를 보강하고 현업 검증 회의를 진행합니다.",
            instructorMemo: "데이터 범위가 명확합니다. 다음 주에는 모델 결과를 업무 의사결정과 연결해 보세요.",
            tasks: [
              {
                id: "t1",
                name: "공정 데이터 수집",
                progress: 82,
                difficulty: "상",
                startDate: "2026-07-08",
                endDate: "2026-07-25",
                goal: "병목 구간 식별을 위한 기준 데이터셋 확보",
                asIsProcess: "수기 수집 > 엑셀 취합 > 담당자 검토",
                toBeProcess: "센서 연동 > 자동 정제 > 대시보드 반영",
                weeklySummary: "공정 병목 데이터를 정리하고 AI 분석 과제의 입력 항목을 확정했습니다.",
                nextWeekPlan: "불량률 예측 모델의 기준 데이터를 보강합니다.",
                instructorFeedback: "데이터 범위가 명확합니다.",
                reportCompleted: true
              },
              {
                id: "t2",
                name: "불량 원인 후보 정의",
                progress: 64,
                difficulty: "중",
                startDate: "2026-07-15",
                endDate: "2026-08-05",
                goal: "주요 불량 원인 3건 이상 정의",
                asIsProcess: "현장 경험 기반 추정 > 회의 공유",
                toBeProcess: "데이터 기반 후보 도출 > 현업 검증",
                weeklySummary: "",
                nextWeekPlan: "",
                instructorFeedback: "",
                reportCompleted: false
              },
              {
                id: "t3",
                name: "현업 인터뷰",
                progress: 72,
                difficulty: "하",
                startDate: "2026-07-20",
                endDate: "2026-08-10",
                goal: "핵심 공정 담당자 인터뷰 완료",
                asIsProcess: "개별 면담 > 메모 정리",
                toBeProcess: "구조화 질문지 > 요약 자동 정리",
                weeklySummary: "",
                nextWeekPlan: "",
                instructorFeedback: "",
                reportCompleted: false
              }
            ]
          },
          {
            id: "p2",
            name: "이서연",
            email: "seoyeon.lee@example.com",
            dept: "품질관리",
            status: "정체",
            summary: "검사 기준서와 샘플링 데이터를 취합 중입니다.",
            nextWeekPlan: "누락된 검사 항목을 보완하고 대시보드 지표 후보를 정리합니다.",
            instructorMemo: "정체 원인이 데이터 누락인지 업무 범위 이슈인지 구분해 주세요.",
            tasks: [
              {
                id: "t4",
                name: "검사 데이터 정제",
                progress: 38,
                difficulty: "상",
                startDate: "2026-07-10",
                endDate: "2026-08-01",
                weeklySummary: "",
                nextWeekPlan: "",
                instructorFeedback: "",
                reportCompleted: false
              },
              {
                id: "t5",
                name: "품질 지표 설계",
                progress: 44,
                difficulty: "중",
                startDate: "2026-07-20",
                endDate: "2026-08-15",
                weeklySummary: "",
                nextWeekPlan: "",
                instructorFeedback: "",
                reportCompleted: false
              }
            ]
          },
          {
            id: "p3",
            name: "박지훈",
            email: "jihoon.park@example.com",
            dept: "생산기획",
            status: "정상",
            summary: "",
            nextWeekPlan: "",
            instructorMemo: "",
            tasks: []
          }
        ]
      },
      {
        id: "c2",
        name: "스마트 리테일랩",
        schedule: { startDate: "2026-07-13", kickoffDate: "2026-07-15", endDate: "2026-09-11" },
        pmo: { name: "오세린", email: "serin.oh@example.com" },
        notices: [],
        participantUpdateRequest: { pending: false, message: "", requestedAt: null, acknowledgedAt: null },
        participants: [
          {
            id: "p4",
            name: "최유진",
            email: "yujin.choi@example.com",
            dept: "CRM",
            status: "정상",
            summary: "고객 세그먼트 기준을 4개 그룹으로 정리했습니다.",
            nextWeekPlan: "캠페인 반응률 예측 지표를 추가 검토합니다.",
            instructorMemo: "세그먼트 기준을 의사결정자가 이해하기 쉬운 언어로 바꿔보세요.",
            tasks: [
              {
                id: "t6",
                name: "고객 세그먼트 정의",
                progress: 76,
                difficulty: "중",
                startDate: "2026-07-15",
                endDate: "2026-08-05",
                weeklySummary: "세그먼트 기준 정의 완료",
                nextWeekPlan: "반응률 지표 검토",
                instructorFeedback: "",
                reportCompleted: true
              },
              {
                id: "t7",
                name: "캠페인 반응 분석",
                progress: 58,
                difficulty: "상",
                startDate: "2026-07-25",
                endDate: "2026-08-20",
                weeklySummary: "",
                nextWeekPlan: "",
                instructorFeedback: "",
                reportCompleted: false
              }
            ]
          }
        ]
      },
      {
        id: "c3",
        name: "헬스케어 데이터팀",
        schedule: { startDate: "2026-07-20", kickoffDate: "2026-07-22", endDate: "2026-09-18" },
        pmo: { name: "", email: "" },
        notices: [],
        participantUpdateRequest: { pending: false, message: "", requestedAt: null, acknowledgedAt: null },
        participants: []
      }
    ],
    meta: {
      lastSavedAt: null,
      lastReportRequestAt: null,
      lastParticipantSyncAt: null
    }
  };
}

module.exports = { createSeedData };
