(() => {
  const app = document.getElementById("app");
  const toastWrap = document.getElementById("toast");

  const state = {
    loading: true,
    saving: false,
    auth: null,
    loginTab: "participant",
    view: "login",
    selectedCompanyId: null,
    selectedParticipantId: null,
    selectedTaskId: null,
    selectedWeek: null,
    filterStatus: "all",
    filterCompanyId: "all",
    filterParticipantId: "all",
    search: "",
    modal: null,
    form: {},
    companies: [],
    meta: {},
    lastLocalSaveAt: null
  };

  function currentWeekNumber(company = currentCompany()) {
    return getConsultingWeek(company?.schedule?.startDate);
  }

  function selectedWeekNumber(company = currentCompany()) {
    if (state.selectedWeek != null && state.selectedWeek !== "") {
      return Number(state.selectedWeek);
    }
    return currentWeekNumber(company);
  }

  function isViewingCurrentWeek(company = currentCompany()) {
    return selectedWeekNumber(company) === currentWeekNumber(company);
  }

  function getTaskWeekSnapshot(task, weekNumber) {
    if (!task) return null;
    ensureTaskFields(task);
    return (task.weeklyReports || []).find((r) => Number(r.weekNumber) === Number(weekNumber)) || null;
  }

  function viewTaskReport(task, company = currentCompany()) {
    const t = ensureTaskFields(task);
    if (!t) {
      return {
        progress: 0,
        weeklySummary: "",
        nextWeekPlan: "",
        instructorFeedback: "",
        reportCompleted: false,
        savedAt: null,
        missing: true
      };
    }
    const week = selectedWeekNumber(company);
    if (isViewingCurrentWeek(company)) {
      return {
        progress: Number(t.progress || 0),
        weeklySummary: t.weeklySummary || "",
        nextWeekPlan: t.nextWeekPlan || "",
        instructorFeedback: t.instructorFeedback || "",
        reportCompleted: Boolean(t.reportCompleted),
        savedAt: state.lastLocalSaveAt || state.meta?.lastSavedAt || null,
        missing: false
      };
    }
    const snap = getTaskWeekSnapshot(t, week);
    if (!snap) {
      return {
        progress: 0,
        weeklySummary: "",
        nextWeekPlan: "",
        instructorFeedback: "",
        reportCompleted: false,
        savedAt: null,
        missing: true
      };
    }
    return {
      progress: Number(snap.progress || 0),
      weeklySummary: snap.weeklySummary || "",
      nextWeekPlan: snap.nextWeekPlan || "",
      instructorFeedback: snap.instructorFeedback || "",
      reportCompleted: Boolean(snap.reportCompleted),
      savedAt: snap.savedAt || null,
      missing: false
    };
  }

  function upsertTaskWeekSnapshot(task, weekNumber, patch) {
    ensureTaskFields(task);
    const week = Number(weekNumber);
    if (!week || week < 1) return;
    const id = `twr-${task.id}-w${week}`;
    const next = {
      id,
      weekNumber: week,
      progress: Number(patch.progress || 0),
      weeklySummary: patch.weeklySummary || "",
      nextWeekPlan: patch.nextWeekPlan || "",
      instructorFeedback: patch.instructorFeedback || "",
      reportCompleted: Boolean(patch.reportCompleted),
      savedAt: patch.savedAt || new Date().toISOString()
    };
    const idx = task.weeklyReports.findIndex((r) => Number(r.weekNumber) === week);
    if (idx >= 0) task.weeklyReports[idx] = { ...task.weeklyReports[idx], ...next };
    else task.weeklyReports.push(next);
  }

  function weekOptionsHtml(company) {
    const current = currentWeekNumber(company);
    const selected = selectedWeekNumber(company);
    const maxWeek = Math.max(1, current);
    let html = "";
    for (let w = 1; w <= maxWeek; w += 1) {
      const label = w === current ? `${w}주차 (이번 주)` : `${w}주차`;
      html += `<option value="${w}" ${selected === w ? "selected" : ""}>${label}</option>`;
    }
    return html;
  }

  function elapsedTarget(company) {
    return companyElapsedRate(company);
  }

  function seenNoticeStorageKey(companyId) {
    const who = state.auth?.participantId || state.auth?.role || "guest";
    return `ax-dashboard-seen-notices:${who}:${companyId}`;
  }

  function getSeenNoticeIds(companyId) {
    try {
      return JSON.parse(localStorage.getItem(seenNoticeStorageKey(companyId)) || "[]");
    } catch {
      return [];
    }
  }

  function setSeenNoticeIds(companyId, ids) {
    localStorage.setItem(seenNoticeStorageKey(companyId), JSON.stringify([...new Set(ids)]));
  }

  function markNoticeSeen(companyId, noticeId) {
    if (!companyId || !noticeId) return;
    const seen = getSeenNoticeIds(companyId);
    if (!seen.includes(noticeId)) {
      seen.push(noticeId);
      setSeenNoticeIds(companyId, seen);
    }
  }

  function isNoticeUnread(company, noticeId) {
    return !getSeenNoticeIds(company?.id).includes(noticeId);
  }

  function newNoticeCount(company) {
    const seen = new Set(getSeenNoticeIds(company?.id));
    return (company?.notices || []).filter((n) => !seen.has(n.id)).length;
  }

  function currentCompany() {
    const company =
      state.companies.find((c) => c.id === state.selectedCompanyId) || state.companies[0] || null;
    return ensureCompanyFields(company);
  }

  function currentParticipant() {
    const company = currentCompany();
    return company?.participants.find((p) => p.id === state.selectedParticipantId) || company?.participants[0] || null;
  }

  function currentTask() {
    const participant = currentParticipant();
    if (!participant || !participant.tasks.length) return null;
    const task = participant.tasks.find((t) => t.id === state.selectedTaskId) || participant.tasks[0];
    state.selectedTaskId = task.id;
    return ensureTaskFields(task);
  }

  function taskRowsForCompany(company) {
    return company.participants.flatMap((participant) => {
      if (!participant.tasks.length) return [{ company, participant, task: null }];
      return participant.tasks.map((task) => ({ company, participant, task: ensureTaskFields(task) }));
    });
  }

  function allTaskRows() {
    return state.companies.flatMap((company) => taskRowsForCompany(company));
  }

  function isAdmin() {
    return state.auth?.role === "admin";
  }

  function isMine(participant) {
    return Boolean(participant?.id && participant.id === state.auth?.participantId);
  }

  function canViewParticipant(participant) {
    return isAdmin() || isMine(participant);
  }

  function canManageParticipant(participant) {
    return isAdmin() || isMine(participant);
  }

  function lockToOwnParticipant() {
    if (isAdmin() || !state.auth?.participantId) return;
    if (state.auth.companyId) state.selectedCompanyId = state.auth.companyId;
    state.selectedParticipantId = state.auth.participantId;
  }

  function allParticipants() {
    return state.companies.flatMap((company) =>
      company.participants.map((participant) => ({ company, participant }))
    );
  }

  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    toastWrap.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }

  async function persist(message) {
    try {
      state.saving = true;
      const saved = await API.saveDashboard({
        companies: state.companies,
        meta: state.meta
      });
      state.meta = saved.meta || state.meta;
      state.lastLocalSaveAt = saved.meta?.lastSavedAt || new Date().toISOString();
      if (message) toast(message);
      return true;
    } catch (err) {
      toast(err.message || "저장에 실패했습니다.");
      return false;
    } finally {
      state.saving = false;
    }
  }

  function setView(view) {
    if (view === "admin" && !isAdmin()) {
      toast("관리자 권한이 필요한 화면입니다.");
      return;
    }
    if (view === "personal") lockToOwnParticipant();
    state.view = view;
    render();
    maybeShowParticipantUpdatePopup();
  }

  function maybeShowParticipantUpdatePopup() {
    if (state.view !== "company" || isAdmin() || state.modal) return;
    const company = currentCompany();
    const req = company?.participantUpdateRequest;
    if (req?.pending) {
      openModal("participantUpdate");
    }
  }

  function openModal(name, form = {}) {
    state.modal = name;
    state.form = form;
    render();
  }

  function closeModal() {
    state.modal = null;
    state.form = {};
    render();
  }

  function renderProgress(value, colorCls) {
    const cls = colorCls || progressClass(value);
    return `
      <div class="progress-cell">
        <div class="progress"><div class="bar ${cls}" style="width:${value}%"></div></div>
        <strong class="progress-value ${cls}">${value}%</strong>
      </div>
    `;
  }

  function renderStat(label, value, foot = "") {
    return `
      <div class="card card-pad stat">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${foot ? `<div class="stat-foot">${foot}</div>` : ""}
      </div>
    `;
  }

  function renderLogin() {
    app.innerHTML = `
      <main class="login-shell">
        <section class="login-brand">
          <div>
            <span class="brand-mark">AX</span>
            <h1>AI 프로젝트 통합 대시보드</h1>
            <p>참여자 등록, 협력사별 진척도 확인, 개인 과제 관리, 컨설턴트 피드백, 주간 레포트 발행까지 한 화면 흐름으로 연결합니다.</p>
            <div class="journey-list">
              ${["참여자 등록 및 로그인", "협력사별 참여 현황 확인", "개인 과제 진척 업데이트", "컨설턴트 피드백 작성", "주간 레포트 발행"].map((item, i) => `
                <div class="journey-item">
                  <span class="journey-num">${i + 1}</span>
                  <span>${item}</span>
                </div>
              `).join("")}
            </div>
          </div>
          <p class="helper">참여자는 협력사·이름·이메일로 로그인하거나 신규 등록할 수 있습니다.</p>
        </section>
        <section class="login-panel-wrap">
          <div class="login-panel">
            <div class="tabs">
              <button class="tab-btn ${state.loginTab === "participant" ? "active" : ""}" data-action="login-tab" data-tab="participant">참여자</button>
              <button class="tab-btn ${state.loginTab === "admin" ? "active" : ""}" data-action="login-tab" data-tab="admin">관리자</button>
            </div>
            ${state.loginTab === "admin" ? renderAdminLogin() : renderParticipantLogin()}
          </div>
        </section>
      </main>
    `;
  }

  function renderAdminLogin() {
    return `
      <div class="field">
        <label for="admin-password">관리자 비밀번호</label>
        <input id="admin-password" type="password" placeholder="비밀번호 입력" autocomplete="current-password" />
      </div>
      <div id="login-error" class="error-text"></div>
      <button class="btn primary" style="width:100%" data-action="admin-login">관리자 로그인</button>
      <p class="helper" style="margin-top:14px">관리자는 전체 현황, 일정, 과제, 피드백, 레포트 발행 기능을 사용할 수 있습니다.</p>
    `;
  }

  function renderParticipantLogin() {
    const companyOptions = state.companies
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
    return `
      <div class="field">
        <label for="login-company">협력사</label>
        <select id="login-company">${companyOptions}</select>
      </div>
      <div class="field">
        <label for="login-name">이름</label>
        <input id="login-name" placeholder="김민준" />
      </div>
      <div class="field">
        <label for="login-email">이메일</label>
        <input id="login-email" type="email" placeholder="minjun.kim@example.com" />
      </div>
      <div id="new-dept-wrap" class="field hidden">
        <label for="login-dept">부서</label>
        <input id="login-dept" placeholder="예: 생산기획" />
        <p class="helper">등록된 정보가 없을 때 신규 참여자로 등록됩니다.</p>
      </div>
      <div id="login-error" class="error-text"></div>
      <button class="btn primary" style="width:100%" data-action="participant-login">참여자 로그인</button>
      <button class="btn ghost hidden" style="width:100%; margin-top:8px" data-action="participant-register">신규 등록하고 접속</button>
    `;
  }

  function renderShell() {
    const titleMap = {
      admin: "관리자 대시보드",
      company: "협력사 허브",
      personal: "개인 대시보드"
    };
    const myCompany = currentCompany();
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="side-top">
            <span class="brand-mark">AX</span>
            <div>
              <div class="side-title">AI 프로젝트<br />통합 대시보드</div>
              <div class="side-sub">${isAdmin() ? "관리자 모드" : "참여자 모드"}</div>
            </div>
          </div>
          <nav class="nav">
            ${
              isAdmin()
                ? `<button class="nav-btn ${state.view === "admin" ? "active" : ""}" data-action="nav" data-view="admin">전체 현황</button>`
                : ""
            }
            <button class="nav-btn ${state.view === "company" ? "active" : ""}" data-action="nav" data-view="company">협력사 허브</button>
            <button class="nav-btn ${state.view === "personal" ? "active" : ""}" data-action="nav" data-view="personal">개인 대시보드</button>
          </nav>
          ${
            isAdmin()
              ? `<div class="field">
            <label style="color:#cbd5e1" for="side-company">협력사 선택</label>
            <select id="side-company" data-action="select-company">
              ${state.companies
                .map(
                  (c) =>
                    `<option value="${c.id}" ${c.id === state.selectedCompanyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`
                )
                .join("")}
            </select>
          </div>`
              : `<div class="side-company-label">
            <div class="side-company-caption">소속 협력사</div>
            <div class="side-company-name">${escapeHtml(myCompany?.name || "-")}</div>
          </div>`
          }
          <div class="side-footer">
            <strong>${escapeHtml(state.auth.name)}</strong><br />
            ${isAdmin() ? "전체 협력사/참여자 관리 권한" : "본인 데이터 편집 권한"}<br />
            <button class="btn ghost small" style="margin-top:10px; width:100%" data-action="logout">로그아웃</button>
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div>
              <h2>${titleMap[state.view]}</h2>
              <p>${renderSubtitle()}</p>
            </div>
            <div class="top-actions">${renderTopActions()}</div>
          </header>
          <section class="content">
            ${state.view === "admin" ? renderAdminDashboard() : ""}
            ${state.view === "company" ? renderCompanyHub() : ""}
            ${state.view === "personal" ? renderPersonalDashboard() : ""}
          </section>
        </main>
      </div>
      ${renderModal()}
    `;
  }

  function renderSubtitle() {
    const company = currentCompany();
    if (state.view === "admin") return "협력사별 일정, 전체 참여자, 정체 상태를 한 번에 확인합니다.";
    if (state.view === "company") return `${company?.name || "협력사 없음"}의 참여 현황과 공지·운영 체크입니다.`;
    return "과제 진척도, 금주 요약, 차주 계획, 강사 피드백을 관리합니다.";
  }

  function renderTopActions() {
    if (state.view === "admin") {
      return `<button class="btn primary" data-action="open-add-company">협력사 추가</button>`;
    }
    if (state.view === "company") {
      return `
        ${isAdmin() ? '<button class="btn primary" data-action="open-report">레포트 발행</button>' : ""}
        ${isAdmin() ? '<button class="btn ghost" data-action="open-add-notice">공지 등록</button>' : ""}
        <button class="btn ghost" data-action="open-add-participant">참여자 등록</button>
      `;
    }
    if (state.view === "personal") {
      const hint =
        '<p class="timeout-hint">' +
        '<span class="timeout-hint-line">타임아웃 시간 제한 30초로 잠시 입력을 쉴 때는</span>' +
        '<span class="timeout-hint-line">반드시 저장하여 주시기 바랍니다</span>' +
        "</p>";
      if (isAdmin() && isViewingCurrentWeek()) {
        return `${hint}<button class="btn primary" data-action="save-feedback">피드백 저장</button>`;
      }
      return hint;
    }
    return "";
  }

  function renderAdminDashboard() {
    const participantRows = allParticipants();
    const rows = allTaskRows().filter(({ task }) => Boolean(task));
    const companyOptions = state.companies;
    const participantOptions = participantRows.filter(
      ({ company }) => state.filterCompanyId === "all" || company.id === state.filterCompanyId
    );
    if (
      state.filterParticipantId !== "all" &&
      !participantOptions.some(({ participant }) => participant.id === state.filterParticipantId)
    ) {
      state.filterParticipantId = "all";
    }
    const filtered = rows.filter(({ company, participant, task }) => {
      const text = `${company.name} ${participant.name} ${participant.email} ${participant.dept} ${task.name}`.toLowerCase();
      const bySearch = text.includes(state.search.toLowerCase());
      const sched = scheduleStatus(company, participant);
      const byStatus =
        state.filterStatus === "all" ||
        (state.filterStatus === "정체" && sched.reason === "stalled") ||
        (state.filterStatus === "정상" && (sched.reason === "ok" || sched.reason === "watch"));
      const byCompany = state.filterCompanyId === "all" || company.id === state.filterCompanyId;
      const byParticipant =
        state.filterParticipantId === "all" || participant.id === state.filterParticipantId;
      return bySearch && byStatus && byCompany && byParticipant;
    });
    const totalParticipants = participantRows.length;
    const avg = totalParticipants
      ? Math.round(participantRows.reduce((sum, row) => sum + avgProgress(row.participant), 0) / totalParticipants)
      : 0;
    const stalledCount = state.companies.reduce(
      (sum, company) => sum + stalledParticipants(ensureCompanyFields(company)).length,
      0
    );

    return `
      <div class="grid stats">
        ${renderStat("총 협력사", state.companies.length, "운영 중인 프로젝트 협력사")}
        ${renderStat("총 참여자", totalParticipants, "등록된 전체 참여자")}
        ${renderStat("평균 진척도", avg + "%", "전체 과제 평균")}
        ${renderStat("정체 참여자", stalledCount, "일정 대비 실적 지연(P1)")}
      </div>

      <div class="card card-pad" style="margin-top:16px">
        <div class="section-title">
          <div>
            <h3>협력사별 일정 관리</h3>
            <p>일정은 개인 대시보드의 일정 달성율·상태 계산에 반영됩니다.</p>
          </div>
        </div>
        <div class="grid schedule-grid">
          ${state.companies
            .map((company) => {
              const c = ensureCompanyFields(company);
              const participantCount = (c.participants || []).length;
              const taskCount = (c.participants || []).reduce((sum, p) => sum + (p.tasks || []).length, 0);
              return `
            <div class="schedule-box">
              <strong>${escapeHtml(c.name)}</strong>
              <div class="schedule-meta-group">
                <div class="date-row schedule-row"><span>시작일</span><b>${c.schedule?.startDate || "-"}</b></div>
                <div class="date-row schedule-row"><span>KickOff</span><b>${c.schedule?.kickoffDate || "-"}</b></div>
                <div class="date-row schedule-row"><span>종료일</span><b>${c.schedule?.endDate || "-"}</b></div>
              </div>
              <div class="schedule-meta-group">
                <div class="date-row pmo-row"><span>PMO</span><b>${c.pmo?.name ? escapeHtml(c.pmo.name) : '<span class="pmo-empty">미등록</span>'}</b></div>
                <div class="date-row pmo-row"><span>PMO 메일</span><b>${c.pmo?.email ? escapeHtml(c.pmo.email) : "-"}</b></div>
                <div class="date-row participant-count-row"><span>참여자수</span><b>${participantCount}명</b></div>
                <div class="date-row participant-count-row"><span>과제수</span><b>${taskCount}건</b></div>
              </div>
              <div class="schedule-actions">
                <button class="btn ghost small" data-action="open-schedule" data-company="${c.id}">일정/PMO 편집</button>
                <button class="btn ghost small" data-action="request-participant-update" data-company="${c.id}">참여자 업데이트</button>
                <button class="btn ghost small" data-action="open-add-notice" data-company="${c.id}">공지 등록</button>
                <button class="btn ghost small danger" data-action="delete-company" data-company="${c.id}">협력사 삭제</button>
              </div>
            </div>
          `;
            })
            .join("")}
        </div>
      </div>

      <div class="toolbar">
        <div class="filters">
          <input id="search" placeholder="협력사, 참여자, 부서, 과제명 검색" value="${escapeHtml(state.search)}" data-action="search" />
          <select id="company-filter" data-action="filter-company" title="협력사 필터">
            <option value="all" ${state.filterCompanyId === "all" ? "selected" : ""}>전체 협력사</option>
            ${companyOptions
              .map(
                (c) =>
                  `<option value="${c.id}" ${state.filterCompanyId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
              )
              .join("")}
          </select>
          <select id="participant-filter" data-action="filter-participant" title="참여자 필터">
            <option value="all" ${state.filterParticipantId === "all" ? "selected" : ""}>전체 참여자</option>
            ${participantOptions
              .map(
                ({ participant }) =>
                  `<option value="${participant.id}" ${state.filterParticipantId === participant.id ? "selected" : ""}>${escapeHtml(participant.name)}</option>`
              )
              .join("")}
          </select>
          <select id="status-filter" data-action="filter-status">
            <option value="all" ${state.filterStatus === "all" ? "selected" : ""}>전체 일정 상태</option>
            <option value="정상" ${state.filterStatus === "정상" ? "selected" : ""}>양호·정상</option>
            <option value="정체" ${state.filterStatus === "정체" ? "selected" : ""}>정체</option>
          </select>
        </div>
        <span class="helper">${filtered.length}건 표시 중</span>
      </div>

      <div class="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>협력사</th>
              <th>과제명</th>
              <th>참여자</th>
              <th>부서</th>
              <th>진척도</th>
              <th>일정 상태</th>
              <th>강사 피드백</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length
                ? filtered
                    .map(({ company, participant, task }) => {
                      const sched = scheduleStatus(company, participant);
                      return `
              <tr>
                <td>${escapeHtml(company.name)}</td>
                <td>${escapeHtml(task.name)}</td>
                <td>${escapeHtml(participant.name)}<br /><span class="person-meta">${escapeHtml(participant.email)}</span></td>
                <td>${escapeHtml(participant.dept)}</td>
                <td>${renderProgress(Number(task.progress || 0), sched.cls)}</td>
                <td><span class="badge ${sched.cls}">${sched.label}</span></td>
                <td>${task.instructorFeedback ? escapeHtml(task.instructorFeedback) : '<span class="helper">피드백 없음</span>'}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn ghost small" data-action="view-person" data-company="${company.id}" data-participant="${participant.id}" data-task="${task.id}">상세</button>
                    <button class="btn ghost small danger" data-action="delete-task" data-company="${company.id}" data-participant="${participant.id}" data-task="${task.id}">과제 삭제</button>
                  </div>
                </td>
              </tr>
            `;
                    })
                    .join("")
                : '<tr><td colspan="8"><div class="empty">조건에 맞는 과제가 없습니다.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  }

  function renderOpsCheckPanel(company) {
    const checks = collectOpsChecks(company);
    return `
      <div class="card card-pad" style="background:#fafbff">
        <div class="section-title">
          <div>
            <h3>운영 체크</h3>
            <p>우선순위: 정체 → 기한초과 → 과제미등록 → 보고미작성 → 일정주의</p>
          </div>
          <span class="badge ${checks.length ? "prio-1" : "green"}">${checks.length}명</span>
        </div>
        ${
          checks.length
            ? `<table>
              <thead>
                <tr><th>우선</th><th>이슈</th><th>참여자</th><th>부서</th><th>실적</th><th>기대</th><th>차이</th></tr>
              </thead>
              <tbody>
                ${checks
                  .map(
                    ({ participant, schedule, priority, label }) => `
                  <tr>
                    <td>P${priority}</td>
                    <td><span class="badge prio-${priority}">${escapeHtml(label)}</span></td>
                    <td>${escapeHtml(participant.name)}</td>
                    <td>${escapeHtml(participant.dept || "-")}</td>
                    <td>${schedule.actual}%</td>
                    <td>${schedule.reason === "no-tasks" || schedule.reason === "no-schedule" ? "-" : `${schedule.target}%`}</td>
                    <td>${
                      schedule.reason === "stalled" || schedule.reason === "watch"
                        ? `<span class="badge ${schedule.reason === "stalled" ? "prio-1" : "blue"}">${schedule.diff}%p</span>`
                        : "-"
                    }</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
            : '<div class="empty">현재 운영 점검 대상 참여자가 없습니다.</div>'
        }
      </div>
    `;
  }

  function renderNoticesPanel(company) {
    const notices = [...(company.notices || [])].sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
    const unread = newNoticeCount(company);
    return `
      <div class="card card-pad">
        <div class="section-title">
          <div>
            <h3>공지사항</h3>
            <p>제목을 클릭하면 내용을 확인할 수 있습니다.</p>
          </div>
          <span class="badge ${unread ? "red" : "gray"}" title="미확인 공지">신규 ${unread}</span>
        </div>
        ${
          notices.length
            ? `<div class="notice-list">${notices
                .map((n) => {
                  const isNew = isNoticeUnread(company, n.id);
                  return `
              <button type="button" class="notice-item notice-item-btn ${isNew ? "is-new" : ""}" data-action="open-notice-detail" data-notice="${n.id}">
                <span class="notice-item-main">
                  <strong>${escapeHtml(n.title)}</strong>
                  <span class="person-meta">${formatDateTime(n.createdAt)}</span>
                </span>
                ${isNew ? '<span class="badge red">N</span>' : ""}
              </button>
            `;
                })
                .join("")}</div>`
            : '<div class="empty">등록된 공지사항이 없습니다.</div>'
        }
      </div>
    `;
  }

  function renderCompanyHub() {
    const company = currentCompany();
    if (!company) return '<div class="empty">등록된 협력사가 없습니다. 협력사를 추가해 프로젝트를 시작하세요.</div>';
    const taskRows = taskRowsForCompany(company);
    const participantCount = company.participants.length;
    const taskCount = company.participants.reduce((sum, participant) => sum + participant.tasks.length, 0);
    const overallProgressAvg = companyAvg(company);
    const scheduleGoalAvg = companyAchievementAvg(company);

    return `
      <div class="grid two-col">
        <div class="grid">
          <div class="card card-pad">
            <div class="section-title">
              <div>
                <h3>협력사 운영 요약</h3>
                <p>참여자 일정·목표 달성과 규모를 한눈에 확인합니다.</p>
              </div>
            </div>
            <div class="grid stats" style="grid-template-columns: repeat(2, 1fr)">
              ${renderStat("전체 진척도", overallProgressAvg + "%")}
              ${renderStat("일정 목표 달성율", (scheduleGoalAvg ?? 0) + "%")}
              ${renderStat("총 참여자", participantCount)}
              ${renderStat("총 과제", taskCount)}
            </div>
          </div>
          ${renderNoticesPanel(company)}
          ${renderOpsCheckPanel(company)}
        </div>
        <div class="card card-pad">
          <div class="section-title">
            <div>
              <h3>과제별 진척현황</h3>
              <p>참여자 정보와 과제 진척도를 함께 확인합니다.</p>
            </div>
            <span class="badge blue">${taskRows.length}건</span>
          </div>
          <div class="task-progress-list">
            ${
              taskRows.length
                ? taskRows
                    .map(({ company: c, participant, task }) => {
                      const sched = scheduleStatus(c, participant);
                      const reportDone = Boolean(ensureTaskFields(task)?.reportCompleted);
                      const reportLabel = reportDone ? "주간보고 작성완료" : "주간보고 미작성";
                      const reportCls = reportDone ? "green" : "red";
                      const feedbackDone = Boolean(task?.instructorFeedback?.trim());
                      const canOpenDetail = canViewParticipant(participant);
                      return `
              <div class="task-progress-card ${participant.id === state.auth?.participantId ? "mine" : ""}">
                <div class="person-row">
                  <div>
                    <div class="person-name">${escapeHtml(task?.name || "과제 없음")} ${task ? `<span class="badge gray">${escapeHtml(ensureTaskFields(task).difficulty)}</span>` : ""}</div>
                    <div class="person-meta">${escapeHtml(participant.name)} · ${escapeHtml(participant.dept)} · ${escapeHtml(participant.email)}</div>
                  </div>
                  <span class="badge ${sched.cls}">${sched.label}</span>
                </div>
                ${task ? renderProgress(Number(task.progress || 0), sched.cls) : renderProgress(0, sched.cls)}
                <div class="person-row">
                  <span class="helper"><span class="status-text ${reportCls}">${reportLabel}</span> · 강사 피드백 ${feedbackDone ? "작성" : "미작성"}</span>
                  ${
                    canOpenDetail
                      ? `<button class="btn ghost small" data-action="view-person" data-company="${c.id}" data-participant="${participant.id}" data-task="${task?.id || ""}">상세보기</button>`
                      : '<span class="helper">본인 과제만 상세 열람</span>'
                  }
                </div>
              </div>
            `;
                    })
                    .join("")
                : '<div class="empty">아직 참여자가 없습니다. 참여자 등록 버튼으로 명단을 추가하세요.</div>'
            }
          </div>
        </div>
      </div>
    `;
  }

  function renderAdminParticipantOverview(company) {
    const rows = company.participants || [];
    return `
      <div class="card card-pad">
        <div class="section-title">
          <div>
            <h3>참여자 전체 현황</h3>
            <p>${escapeHtml(company.name)} 참여자 ${rows.length}명 — 선택하면 아래에서 상세를 확인합니다.</p>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="admin-person-list">
              ${rows
                .map((participant) => {
                  const sched = scheduleStatus(company, participant);
                  const selected = participant.id === state.selectedParticipantId;
                  return `
                  <div class="admin-person-row ${selected ? "active" : ""}">
                    <button type="button" class="admin-person-item" data-action="select-person" data-company="${company.id}" data-participant="${participant.id}">
                      <div class="admin-person-meta">
                        <strong>${escapeHtml(participant.name)}</strong>
                        <div class="person-meta">${escapeHtml(participant.dept || "-")} · ${escapeHtml(participant.email)}</div>
                      </div>
                      ${renderProgress(avgProgress(participant), sched.cls)}
                      <span class="badge ${sched.cls}">${sched.label}</span>
                    </button>
                    <button type="button" class="btn ghost small danger" data-action="delete-participant" data-company="${company.id}" data-participant="${participant.id}" title="참여자 삭제">삭제</button>
                  </div>
                `;
                })
                .join("")}
            </div>`
            : '<div class="empty">등록된 참여자가 없습니다.</div>'
        }
      </div>
    `;
  }

  function renderPersonalDashboard() {
    lockToOwnParticipant();
    const company = currentCompany();
    if (!company) return '<div class="empty">선택된 협력사가 없습니다.</div>';
    if (!company.participants.length) {
      return `
        ${isAdmin() ? renderAdminParticipantOverview(company) : ""}
        <div class="empty">선택된 참여자가 없습니다. 협력사 허브에서 참여자를 선택하세요.</div>
      `;
    }
    if (!company.participants.some((p) => p.id === state.selectedParticipantId)) {
      if (isAdmin()) {
        state.selectedParticipantId = company.participants[0].id;
      } else {
        lockToOwnParticipant();
      }
    }
    const participant = currentParticipant();
    if (!participant) return '<div class="empty">선택된 참여자가 없습니다. 협력사 허브에서 참여자를 선택하세요.</div>';
    if (!canViewParticipant(participant)) {
      return '<div class="empty">본인 과제만 열람할 수 있습니다.</div>';
    }
    const editable = isMine(participant);
    const canManageTasks = canManageParticipant(participant);
    const viewingCurrent = isViewingCurrentWeek(company);
    const canEditReport = editable && viewingCurrent;
    const canEditFeedback = isAdmin() && viewingCurrent;
    const week = selectedWeekNumber(company);
    const schedule = scheduleStatus(company, participant);
    const task = currentTask();
    const reportView = viewTaskReport(task, company);
    const taskOptions = participant.tasks
      .map((item) => `<option value="${item.id}" ${task?.id === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
      .join("");

    return `
      <div class="grid" style="gap:16px">
        ${isAdmin() ? renderAdminParticipantOverview(company) : ""}
      <div class="grid detail-grid">
        <div class="grid">
          <div class="card card-pad">
            <div class="person-row">
              <div>
                <h3 style="margin:0 0 6px">${escapeHtml(participant.name)}</h3>
                <div class="person-meta">${escapeHtml(company.name)} · ${escapeHtml(participant.dept)} · ${escapeHtml(participant.email)}</div>
              </div>
              <span class="badge ${schedule.cls}">${schedule.label}</span>
            </div>
            <div class="field" style="margin-top:14px; margin-bottom:0">
              <label for="report-week">조회 주차</label>
              <select id="report-week" data-action="change-report-week">${weekOptionsHtml(company)}</select>
              <p class="helper" style="margin-top:8px">
                ${
                  viewingCurrent
                    ? "이번 주 보고를 작성·수정할 수 있습니다. 과거 주차는 저장된 스냅샷을 조회합니다."
                    : `${week}주차는 읽기 전용입니다. 해당 주에 저장한 진척·보고만 표시됩니다.`
                }
              </p>
            </div>
            <div class="grid stats" style="grid-template-columns: repeat(3, 1fr); margin-top:16px">
              ${renderStat("전체 진척도", schedule.actual + "%")}
              ${renderStat(
                "일정 목표 달성율",
                schedule.achievement === null ? "-" : schedule.achievement + "%"
              )}
              ${renderStat(
                "일정 상태",
                `<span class="status-text ${schedule.cls}">${schedule.label}</span>`
              )}
            </div>
          </div>

          <div class="card card-pad">
            <div class="section-title">
              <div>
                <h3>과제 목록</h3>
                <p>${
                  viewingCurrent
                    ? editable
                      ? "과제 상세·일정 상태를 확인하고, 진척도는 주간 보고에서 수정합니다."
                      : isAdmin()
                        ? "참여자 과제는 열람·피드백만 가능합니다. 주간 보고 본문은 참여자만 수정합니다."
                        : "본인 과제만 수정·저장할 수 있습니다."
                    : `${week}주차 기준 진척·작성 여부를 표시합니다.`
                }</p>
              </div>
              ${canManageTasks ? `<button class="btn ghost small" data-action="open-add-task" data-company="${company.id}" data-participant="${participant.id}">과제 추가</button>` : ""}
            </div>
            ${
              participant.tasks.length
                ? participant.tasks
                    .map((item) => {
                      const t = ensureTaskFields(item);
                      const isSelected = task?.id === t.id;
                      const weekView = viewTaskReport(t, company);
                      const isCompleted = weekView.reportCompleted;
                      const taskSched = taskScheduleStatus(t, company);
                      const expected = taskSched.expected;
                      const progressValue = weekView.missing && !viewingCurrent ? 0 : weekView.progress;
                      return `
                        <div class="task-row ${isSelected ? "selected" : ""}" data-action="open-task-detail" data-task="${t.id}" style="cursor:pointer">
                          <div class="task-row-head">
                            <strong class="task-row-title">${escapeHtml(t.name)}</strong>
                            <span class="badge gray">${escapeHtml(t.difficulty)}</span>
                            <span class="badge ${taskSched.cls} task-status-badge">${taskSched.label}</span>
                            <div class="task-row-actions">
                              <button class="btn small ${isCompleted ? "ghost" : "primary"}" data-action="select-task" data-task="${t.id}" title="클릭 시 우측 주간보고 작성 폼으로 이동" style="${isCompleted ? "border-color:#2e7d32; color:#2e7d32; background:#e8f5e9;" : ""}">
                                ${
                                  !viewingCurrent && weekView.missing
                                    ? "해당 주 없음"
                                    : isCompleted
                                      ? "✓ 작성완료"
                                      : "미작성"
                                }
                              </button>
                              ${
                                canManageTasks
                                  ? `<button class="btn ghost small danger" data-action="delete-task" data-company="${company.id}" data-participant="${participant.id}" data-task="${t.id}" title="과제 삭제">삭제</button>`
                                  : ""
                              }
                            </div>
                          </div>
                          <div class="task-progress-wrap">
                            ${renderProgress(Number(progressValue || 0), taskSched.cls)}
                            <div class="progress-cell expected-progress">
                              <div class="progress"><div class="bar gray" style="width:${expected === null ? 0 : expected}%"></div></div>
                              <strong class="progress-value gray">${expected === null ? "기대-" : `기대 ${expected}%`}</strong>
                            </div>
                          </div>
                        </div>
                      `;
                    })
                    .join("")
                : '<div class="empty">등록된 과제가 없습니다. 과제를 추가해 진척도를 관리하세요.</div>'
            }
          </div>
        </div>

        <aside class="grid">
          <div class="card card-pad">
            <div class="section-title">
              <div>
                <h3>주간 보고 · ${week}주차</h3>
                <p>${
                  viewingCurrent
                    ? "과제를 선택한 뒤 과제별 금주 요약, 차주 계획, 컨설턴트 피드백을 관리합니다."
                    : "선택한 주차에 저장된 스냅샷을 조회합니다."
                }</p>
              </div>
              ${
                canEditReport
                  ? '<button class="btn primary small" data-action="save-personal">내 보고 저장</button>'
                  : ""
              }
            </div>
            ${
              participant.tasks.length
                ? reportView.missing && !viewingCurrent
                  ? `<div class="empty">${week}주차에 저장된 주간 보고가 없습니다.</div>
              <div class="field">
                <label for="report-task">과제 선택</label>
                <select id="report-task" data-action="change-report-task">${taskOptions}</select>
              </div>`
                  : `
              <div class="field">
                <label for="report-task">과제 선택</label>
                <select id="report-task" data-action="change-report-task">${taskOptions}</select>
              </div>
              <div class="field">
                <label for="report-progress">진척도 (%)</label>
                <div class="report-progress-row">
                  <input id="report-progress" type="range" min="0" max="100" value="${Number(reportView.progress || 0)}" class="range-${task ? taskScheduleClass(task, company) : "gray"}" ${canEditReport ? "" : "disabled"} data-action="task-progress" data-participant="${participant.id}" data-task="${task?.id || ""}" />
                  <strong id="report-progress-value" class="progress-value ${task ? taskScheduleClass(task, company) : "gray"}">${Number(reportView.progress || 0)}%</strong>
                </div>
              </div>
              <div class="field">
                <label>금주 요약</label>
                <textarea id="weekly-summary" ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.weeklySummary || "")}</textarea>
              </div>
              <div class="field">
                <label>차주 계획</label>
                <textarea id="task-next-plan" ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.nextWeekPlan || "")}</textarea>
              </div>
              <div class="field">
                <label>컨설턴트 피드백</label>
                <textarea id="task-feedback" ${canEditFeedback ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.instructorFeedback || "")}</textarea>
              </div>
              ${reportView.instructorFeedback ? "" : '<p class="helper">선택한 과제에 등록된 컨설턴트 피드백이 없습니다.</p>'}
              <p class="helper">${viewingCurrent ? "마지막 저장 시각" : "해당 주 저장 시각"}: ${formatDateTime(reportView.savedAt || state.lastLocalSaveAt || state.meta?.lastSavedAt)}</p>
            `
                : '<div class="empty">등록된 과제가 없습니다. 과제를 추가한 뒤 과제별 주간 보고를 작성하세요.</div>'
            }
          </div>
        </aside>
      </div>
      </div>
    `;
  }

  function renderModal() {
    if (!state.modal) return "";
    const modalMap = {
      addCompany: renderAddCompanyModal,
      addParticipant: renderAddParticipantModal,
      addTask: renderAddTaskModal,
      schedule: renderScheduleModal,
      report: renderReportModal,
      addNotice: renderAddNoticeModal,
      noticeDetail: renderNoticeDetailModal,
      participantUpdate: renderParticipantUpdateModal,
      taskDetail: renderTaskDetailModal
    };
    return modalMap[state.modal]?.() || "";
  }

  function modalShell(title, body, foot, wide = false) {
    return `
      <div class="modal-backdrop" data-action="backdrop-close">
        <div class="modal ${wide ? "modal-wide" : ""}" data-stop="true">
          <div class="modal-head">
            <h3>${title}</h3>
            <button class="btn ghost icon" data-action="close-modal" title="닫기">×</button>
          </div>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">${foot}</div>
        </div>
      </div>
    `;
  }

  function renderAddCompanyModal() {
    return modalShell(
      "협력사 추가",
      `
      <div class="field">
        <label for="company-name">협력사명</label>
        <input id="company-name" placeholder="신규 협력사명" />
      </div>
      <p class="helper">협력사 추가 후 일정 편집에서 시작일과 종료일을 설정할 수 있습니다.</p>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="add-company">저장</button>
    `
    );
  }

  function renderAddParticipantModal() {
    return modalShell(
      "참여자 등록",
      `
      <div class="field"><label>이름</label><input id="new-name" placeholder="참여자 이름" /></div>
      <div class="field"><label>이메일</label><input id="new-email" type="email" placeholder="name@example.com" /></div>
      <div class="field"><label>부서</label><input id="new-dept" placeholder="부서명" /></div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="add-participant">등록</button>
    `
    );
  }

  function difficultySelectHtml(id, selected = "중", disabled = false) {
    const value = normalizeDifficulty(selected);
    return `
      <select id="${id}" ${disabled ? "disabled" : ""}>
        <option value="상" ${value === "상" ? "selected" : ""}>상 (가중 3)</option>
        <option value="중" ${value === "중" ? "selected" : ""}>중 (가중 2)</option>
        <option value="하" ${value === "하" ? "selected" : ""}>하 (가중 1)</option>
      </select>
    `;
  }

  function defaultTaskMembers(participant) {
    const owner =
      isAdmin()
        ? participant
        : currentParticipant() || participant;
    const authName = state.auth?.name || "";
    return mergeTaskMembers(
      [
        {
          name: owner?.name || authName || "",
          email: owner?.email || "",
          role: "과제 등록자",
          position: owner?.dept || "",
          isOwner: true
        }
      ],
      []
    );
  }

  function renderHierarchyFields(prefix, hierarchy, editable = true) {
    const h = normalizeHierarchy(hierarchy);
    const ro = editable ? "" : "readonly class='readonly'";
    return `
      <section class="task-add-panel">
        <h4>과제 계층</h4>
        <div class="grid hierarchy-grid">
          <div class="field"><label>L1 대분류</label><input id="${prefix}h-l1" value="${escapeHtml(h.l1)}" ${ro} placeholder="예: 사업기획" /></div>
          <div class="field"><label>L2 중분류</label><input id="${prefix}h-l2" value="${escapeHtml(h.l2)}" ${ro} placeholder="예: 신사업기획" /></div>
          <div class="field"><label>L3 소분류</label><input id="${prefix}h-l3" value="${escapeHtml(h.l3)}" ${ro} placeholder="예: 시장 트렌드 조사" /></div>
          <div class="field"><label>L4 세부분류</label><input id="${prefix}h-l4" value="${escapeHtml(h.l4)}" ${ro} placeholder="예: 신규 스타트업 발굴" /></div>
        </div>
      </section>
    `;
  }

  function renderStatisticsFields(prefix, statistics, editable = true) {
    const stats = normalizeStatistics(statistics);
    const ro = editable ? "" : "readonly class='readonly'";
    const fields = TASK_STAT_FIELDS.map(
      (field) => `
        <div class="field">
          <label>${escapeHtml(field.label)}</label>
          <input id="${prefix}stat-${field.key}" value="${escapeHtml(stats[field.key] || "")}" ${ro} />
        </div>
      `
    ).join("");
    return `
      <section class="task-add-panel">
        <h4>통계</h4>
        <div class="grid stats-form-grid">${fields}</div>
      </section>
    `;
  }

  function renderMemberRow(member, editable = true) {
    const m = normalizeTaskMember(member, Boolean(member?.isOwner));
    const ro = !editable || m.isOwner ? "readonly class='readonly'" : "";
    return `
      <div class="task-member-row" data-owner="${m.isOwner ? "1" : "0"}">
        <input class="task-member-name" placeholder="이름" value="${escapeHtml(m.name)}" ${ro} />
        <input class="task-member-role" placeholder="역할" value="${escapeHtml(m.role)}" ${m.isOwner ? "readonly class='readonly'" : ""} ${editable ? "" : "readonly class='readonly'"} />
        <input class="task-member-email" type="email" placeholder="이메일" value="${escapeHtml(m.email)}" ${ro} />
        <input class="task-member-position" placeholder="직급/부서" value="${escapeHtml(m.position)}" ${editable ? "" : "readonly class='readonly'"} />
        ${
          editable && !m.isOwner
            ? '<button type="button" class="btn ghost small" data-action="remove-task-member">삭제</button>'
            : '<span class="helper" style="margin:0">등록자</span>'
        }
      </div>
    `;
  }

  function renderMembersFields(members, editable = true) {
    const list = Array.isArray(members) && members.length ? members : [];
    return `
      <section class="task-add-panel">
        <div class="section-title" style="margin-bottom:8px">
          <div>
            <h4 style="margin:0">과제 참여자</h4>
            <p class="helper" style="margin:4px 0 0">과제 등록자(접속자)가 기본 기입되며, 추가 참여자를 등록할 수 있습니다.</p>
          </div>
          ${editable ? '<button type="button" class="btn ghost small" data-action="add-task-member">참여자 추가</button>' : ""}
        </div>
        <div id="task-members" class="task-member-list">
          ${list.map((m) => renderMemberRow(m, editable)).join("")}
        </div>
      </section>
    `;
  }

  function collectHierarchy(prefix) {
    return normalizeHierarchy({
      l1: document.getElementById(`${prefix}h-l1`)?.value.trim() || "",
      l2: document.getElementById(`${prefix}h-l2`)?.value.trim() || "",
      l3: document.getElementById(`${prefix}h-l3`)?.value.trim() || "",
      l4: document.getElementById(`${prefix}h-l4`)?.value.trim() || ""
    });
  }

  function collectStatistics(prefix) {
    const next = emptyStatistics();
    TASK_STAT_FIELDS.forEach((field) => {
      next[field.key] = document.getElementById(`${prefix}stat-${field.key}`)?.value.trim() || "";
    });
    return next;
  }

  function collectTaskMembers() {
    return [...document.querySelectorAll("#task-members .task-member-row")]
      .map((row) =>
        normalizeTaskMember(
          {
            name: row.querySelector(".task-member-name")?.value.trim() || "",
            role: row.querySelector(".task-member-role")?.value.trim() || "",
            email: row.querySelector(".task-member-email")?.value.trim() || "",
            position: row.querySelector(".task-member-position")?.value.trim() || "",
            isOwner: row.dataset.owner === "1"
          },
          row.dataset.owner === "1"
        )
      )
      .filter((m) => m.name);
  }

  function renderAddTaskModal() {
    const participant = state.form.participantId
      ? allParticipants().find((r) => r.participant.id === state.form.participantId)?.participant
      : currentParticipant();
    const members = state.form.taskMembers?.length ? state.form.taskMembers : defaultTaskMembers(participant);
    const draft = state.form.taskDraft || {};
    return modalShell(
      "과제 추가",
      `
      <p class="helper" style="margin-top:0">${escapeHtml(participant?.name || "선택 참여자")}에게 과제를 등록합니다. 첨부 PDF/CSV로 자동기입하거나 직접 입력할 수 있습니다.</p>
      <div class="task-add-layout">
        <section class="task-add-panel">
          <h4>기본 정보</h4>
          <div class="field"><label>과제명 *</label><input id="task-name" placeholder="예: 데이터 품질 점검" value="${escapeHtml(draft.name || "")}" /></div>
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
            <div class="field"><label>시작일</label><input id="task-start" type="date" value="${escapeHtml(draft.startDate || "")}" /></div>
            <div class="field"><label>완료일</label><input id="task-end" type="date" value="${escapeHtml(draft.endDate || "")}" /></div>
            <div class="field"><label>난이도</label>${difficultySelectHtml("task-difficulty", draft.difficulty || "중")}</div>
          </div>
          <div class="field"><label>성과 목표</label><textarea id="task-goal" placeholder="달성하려는 성과 목표">${escapeHtml(draft.goal || "")}</textarea></div>
        </section>
        <section class="task-add-panel">
          <h4>프로세스 설계</h4>
          <div class="field"><label>As-Is 프로세스</label><textarea id="task-asis" placeholder="예: 단계A [수작업｜문서｜120분] > 단계B [자동화｜툴｜60분]">${escapeHtml(draft.asIsProcess || "")}</textarea></div>
          <div class="field"><label>To-Be 프로세스</label><textarea id="task-tobe" placeholder="예: 단계A [수작업｜문서｜120분] > 단계B [자동화｜툴｜60분]">${escapeHtml(draft.toBeProcess || "")}</textarea></div>
          <p class="helper" style="margin-top:-6px">프로세스는 <strong>&gt;</strong> 로 단계를 구분합니다. 대괄호 안 ｜ 등은 한 단계(노드) 안에 그대로 표시됩니다.</p>
        </section>
      </div>
      ${renderHierarchyFields("task-", draft.hierarchy, true)}
      ${renderStatisticsFields("task-", draft.statistics, true)}
      ${renderMembersFields(members, true)}
      <div class="task-import-layout">
        <div class="field task-import-card">
          <label>PDF 업로드 자동기입 (선택)</label>
          <input id="task-pdf" type="file" accept=".pdf,application/pdf" data-action="task-pdf-change" />
          <p class="helper">PDF 텍스트에서 과제명/기간/목표/As-Is/To-Be/난이도를 찾아 폼에 자동 입력합니다.</p>
          <div id="pdf-preview" class="helper"></div>
        </div>
        <div class="field task-import-card">
          <label>CSV 업로드 (선택)</label>
          <input id="task-csv" type="file" accept=".csv,text/csv" data-action="task-csv-change" />
          <p class="helper">BPA 과제 리포트 CSV(task_name, hierarchy_json, statistics_json, as_is/to_be_processes_json)를 지원합니다.</p>
          <div id="csv-preview" class="helper"></div>
        </div>
      </div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="add-task">추가</button>
    `,
      true
    );
  }

  function pickByLabel(text, labels) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rx = new RegExp(`^${escaped}\\s*[:：\\-]?\\s*(.+)$`, "i");
        const matched = line.match(rx);
        if (matched && matched[1]) return matched[1].trim();
      }
    }
    return "";
  }

  function pickDate(value) {
    const matched = String(value || "").match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (!matched) return "";
    const y = matched[1];
    const m = String(matched[2]).padStart(2, "0");
    const d = String(matched[3]).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseTaskDraftFromText(text) {
    const source = String(text || "").replace(/\u00A0/g, " ");
    const name = pickByLabel(source, ["과제명", "과제 명", "과제", "Task Name"]);
    const goal = pickByLabel(source, ["성과 목표", "성과목표", "목표", "Goal"]);
    const asIsProcess = pickByLabel(source, ["As-Is 프로세스", "As-Is", "AS-IS", "현재 프로세스"]);
    const toBeProcess = pickByLabel(source, ["To-Be 프로세스", "To-Be", "TO-BE", "개선 프로세스"]);
    const difficultyRaw = pickByLabel(source, ["난이도", "Difficulty", "Level"]);
    const startRaw = pickByLabel(source, ["시작일", "착수일", "Start Date"]);
    const endRaw = pickByLabel(source, ["완료일", "종료일", "End Date"]);
    const periodRaw = pickByLabel(source, ["기간", "일정", "Schedule"]);
    const periodSplit = periodRaw.split(/~|부터|까지|-/).map((v) => v.trim()).filter(Boolean);

    return {
      name,
      goal,
      asIsProcess,
      toBeProcess,
      difficulty: normalizeDifficulty(difficultyRaw || "중"),
      startDate: pickDate(startRaw || periodSplit[0] || ""),
      endDate: pickDate(endRaw || periodSplit[1] || "")
    };
  }

  function applyTaskDraftToInputs(draft) {
    if (!draft) return;
    const mapping = [
      ["task-name", "name"],
      ["task-start", "startDate"],
      ["task-end", "endDate"],
      ["task-goal", "goal"],
      ["task-asis", "asIsProcess"],
      ["task-tobe", "toBeProcess"]
    ];
    mapping.forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const nextValue = String(draft[key] || "").trim();
      if (!nextValue) return;
      input.value = nextValue;
    });

    const diffSelect = document.getElementById("task-difficulty");
    if (diffSelect && draft.difficulty) diffSelect.value = normalizeDifficulty(draft.difficulty);

    const hierarchy = normalizeHierarchy(draft.hierarchy);
    ["l1", "l2", "l3", "l4"].forEach((key) => {
      const input = document.getElementById(`task-h-${key}`);
      if (input && hierarchy[key]) input.value = hierarchy[key];
    });

    const statistics = normalizeStatistics(draft.statistics);
    TASK_STAT_FIELDS.forEach((field) => {
      const input = document.getElementById(`task-stat-${field.key}`);
      if (input && statistics[field.key]) input.value = statistics[field.key];
    });

    const list = document.getElementById("task-members");
    if (list && Array.isArray(draft.members)) {
      const participant = state.form.participantId
        ? allParticipants().find((r) => r.participant.id === state.form.participantId)?.participant
        : currentParticipant();
      const members = mergeTaskMembers(defaultTaskMembers(participant), draft.members);
      list.innerHTML = members.map((m) => renderMemberRow(m, true)).join("");
    }
  }

  async function extractPdfText(file) {
    if (!window.pdfjsLib) {
      throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
    }
    const workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    if (window.pdfjsLib.GlobalWorkerOptions.workerSrc !== workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    }

    const bytes = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = content.items.map((item) => item.str).join("\n");
      if (lines.trim()) pages.push(lines);
    }
    return pages.join("\n");
  }

  function renderScheduleModal() {
    const company = ensureCompanyFields(
      state.companies.find((c) => c.id === state.form.companyId) || currentCompany()
    );
    return modalShell(
      "일정 / PMO 편집",
      `
      <p class="helper" style="margin-top:0">${escapeHtml(company.name)}의 일정과 PMO 정보를 수정합니다.</p>
      <div class="field"><label>시작일</label><input id="schedule-start" type="date" value="${company.schedule?.startDate || ""}" /></div>
      <div class="field"><label>KickOff</label><input id="schedule-kickoff" type="date" value="${company.schedule?.kickoffDate || ""}" /></div>
      <div class="field"><label>종료일</label><input id="schedule-end" type="date" value="${company.schedule?.endDate || ""}" /></div>
      <div class="field"><label>PMO 이름</label><input id="pmo-name" value="${escapeHtml(company.pmo?.name || "")}" placeholder="예: 한지민" /></div>
      <div class="field"><label>PMO 이메일</label><input id="pmo-email" type="email" value="${escapeHtml(company.pmo?.email || "")}" placeholder="pmo@example.com" /></div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="save-schedule">저장</button>
    `
    );
  }

  function renderNoticeDetailModal() {
    const company = currentCompany();
    const notice = (company?.notices || []).find((n) => n.id === state.form.noticeId);
    if (!notice) {
      return modalShell(
        "공지사항",
        '<div class="empty">공지를 찾을 수 없습니다.</div>',
        `<button class="btn primary" data-action="close-modal">닫기</button>`
      );
    }
    return modalShell(
      escapeHtml(notice.title),
      `
      <p class="person-meta" style="margin-top:0">${formatDateTime(notice.createdAt)}</p>
      <p class="notice-detail-body">${escapeHtml(notice.content)}</p>
    `,
      `<button class="btn primary" data-action="ack-notice" data-notice="${notice.id}">확인</button>`
    );
  }

  function renderAddNoticeModal() {
    const companyId = state.form.companyId || state.selectedCompanyId;
    const company = ensureCompanyFields(state.companies.find((c) => c.id === companyId) || currentCompany());
    return modalShell(
      "공지사항 등록",
      `
      <p class="helper" style="margin-top:0">${escapeHtml(company?.name || "선택 협력사")} 참여자에게만 표시됩니다.</p>
      <div class="field"><label>제목</label><input id="notice-title" placeholder="공지 제목" /></div>
      <div class="field"><label>내용</label><textarea id="notice-content" placeholder="공지 내용을 입력하세요"></textarea></div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="save-notice">등록</button>
    `
    );
  }

  function renderParticipantUpdateModal() {
    const company = currentCompany();
    const req = company?.participantUpdateRequest || {};
    return modalShell(
      "참여자 업데이트 요청",
      `
      <p style="margin-top:0; line-height:1.7">
        <strong>${escapeHtml(company?.name || "귀사")}</strong>의 AX 컨설팅 프로젝트 참여자를 업데이트해 주세요.
      </p>
      <p class="helper">${escapeHtml(req.message || "참여자 명단·부서·이메일을 최신 상태로 확인하고 필요 시 참여자 등록으로 반영해 주세요.")}</p>
      <p class="helper">요청 시각: ${formatDateTime(req.requestedAt)}</p>
    `,
      `
      <button class="btn ghost" data-action="open-add-participant">참여자 등록</button>
      <button class="btn primary" data-action="ack-participant-update">확인했습니다</button>
    `
    );
  }

  function renderTaskDetailModal() {
    const participant = currentParticipant();
    const task = ensureTaskFields(
      participant?.tasks.find((t) => t.id === state.form.taskId) || currentTask()
    );
    if (!task) {
      return modalShell("과제 상세", '<div class="empty">과제를 찾을 수 없습니다.</div>', `<button class="btn primary" data-action="close-modal">닫기</button>`);
    }
    const editable = canManageParticipant(participant);
    const members = task.members?.length ? task.members : defaultTaskMembers(participant);
    return modalShell(
      "과제 상세",
      `
      <div class="task-add-layout">
        <section class="task-add-panel">
          <h4>기본 정보</h4>
          <div class="field"><label>과제명</label><input id="detail-task-name" value="${escapeHtml(task.name)}" ${editable ? "" : "readonly class='readonly'"} /></div>
          <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
            <div class="field"><label>시작일</label><input id="detail-task-start" type="date" value="${escapeHtml(task.startDate || "")}" ${editable ? "" : "readonly class='readonly'"} /></div>
            <div class="field"><label>완료일</label><input id="detail-task-end" type="date" value="${escapeHtml(task.endDate || "")}" ${editable ? "" : "readonly class='readonly'"} /></div>
            <div class="field"><label>난이도</label>${difficultySelectHtml("detail-task-difficulty", task.difficulty, !editable)}</div>
          </div>
          <div class="field"><label>성과 목표</label><textarea id="detail-task-goal" ${editable ? "" : "readonly class='readonly'"}>${escapeHtml(task.goal || "")}</textarea></div>
        </section>
        <section class="task-add-panel">
          <h4>프로세스 설계</h4>
          <div class="field"><label>As-Is 프로세스</label><textarea id="detail-task-asis" ${editable ? "" : "readonly class='readonly'"} placeholder="단계A [수작업｜문서｜120분] > 단계B">${escapeHtml(task.asIsProcess || "")}</textarea></div>
          <div class="field"><label>To-Be 프로세스</label><textarea id="detail-task-tobe" ${editable ? "" : "readonly class='readonly'"} placeholder="단계A [수작업｜문서｜120분] > 단계B">${escapeHtml(task.toBeProcess || "")}</textarea></div>
        </section>
      </div>
      ${renderHierarchyFields("detail-task-", task.hierarchy, editable)}
      ${renderStatisticsFields("detail-task-", task.statistics, editable)}
      ${renderMembersFields(members, editable)}
      <div class="process-split-grid">
        ${renderProcessFlow("As-Is (세로 흐름)", task.asIsProcess, "vertical")}
        ${renderProcessFlow("To-Be (세로 흐름)", task.toBeProcess, "vertical")}
      </div>
      <p class="helper">흐름 차트는 <strong>&gt;</strong> 기준으로 노드를 나눕니다.</p>
    `,
      `
      <button class="btn ghost" data-action="close-modal">닫기</button>
      ${editable ? '<button class="btn primary" data-action="save-task-detail">저장</button>' : ""}
    `,
      true
    );
  }

  function renderReportModal() {
    const company = currentCompany();
    const week = getConsultingWeek(company?.schedule?.startDate);
    const overallProgressAvg = companyAvg(company);
    const scheduleGoalAvg = companyAchievementAvg(company);
    const participantCount = company.participants.length;
    const taskCount = company.participants.reduce((sum, p) => sum + p.tasks.length, 0);
    const taskRows = taskRowsForCompany(company);

    return modalShell(
      "주간 레포트 PDF 발행",
      `
      <div class="grid" style="grid-template-columns: 1fr 1fr">
        <div class="field">
          <label>컨설팅 주차</label>
          <input value="${week}주차 (시작일 ${company.schedule?.startDate || "-"} 기준)" readonly class="readonly" />
        </div>
        <div class="field">
          <label>협력사</label>
          <input value="${escapeHtml(company.name)}" readonly class="readonly" />
        </div>
      </div>
      <div class="field">
        <label>주요 전달 내용</label>
        <textarea id="report-note" placeholder="이번 주 주요 전달 내용을 입력하세요">이번 주는 과제 진척도와 요약 누락 여부를 중심으로 점검했습니다.</textarea>
      </div>
      <div class="section-title">
        <div>
          <h3>발행 미리보기</h3>
          <p>PDF에 협력사 운영 요약과 과제별 진척 현황이 포함됩니다.</p>
        </div>
      </div>
      <div class="report-preview">
        <div class="report-person">
          <strong>협력사 운영 요약</strong>
          <p class="helper">전체 진척도 ${overallProgressAvg}% · 일정 목표 달성율 ${scheduleGoalAvg ?? 0}% · 총 참여자 ${participantCount}명 · 총 과제 ${taskCount}건</p>
        </div>
        <div class="report-person">
          <strong>과제별 진척 현황</strong>
          ${
            taskRows.length
              ? taskRows
                  .map(({ participant, task }) => {
                    const sched = scheduleStatus(company, participant);
                    const t = ensureTaskFields(task);
                    return `<p class="helper" style="margin:6px 0">${escapeHtml(t?.name || "과제 없음")} · ${escapeHtml(participant.name)} · 진척 ${t ? t.progress : 0}% · ${sched.label}</p>`;
                  })
                  .join("")
              : '<p class="helper">등록된 과제가 없습니다.</p>'
          }
        </div>
      </div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="publish-report">PDF 발행</button>
    `
    );
  }

  function buildWeeklyReportDocument(company, note) {
    const week = getConsultingWeek(company?.schedule?.startDate);
    const overallProgressAvg = companyAvg(company);
    const scheduleGoalAvg = companyAchievementAvg(company);
    const participantCount = company.participants.length;
    const taskCount = company.participants.reduce((sum, p) => sum + p.tasks.length, 0);
    const taskRows = taskRowsForCompany(company);
    const issuedAt = formatDateTime(new Date().toISOString());

    const taskRowsHtml = taskRows.length
      ? taskRows
          .map(({ participant, task }) => {
            const sched = scheduleStatus(company, participant);
            const t = ensureTaskFields(task);
            return `
              <tr>
                <td>${escapeHtml(t?.name || "과제 없음")}</td>
                <td>${escapeHtml(participant.name)}</td>
                <td>${escapeHtml(participant.dept || "-")}</td>
                <td>${t ? Number(t.progress || 0) : 0}%</td>
                <td>${escapeHtml(sched.label)}</td>
                <td>${t?.reportCompleted ? "작성완료" : "미작성"}</td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="6">등록된 과제가 없습니다.</td></tr>`;

    return `
      <div class="pdf-report" style="font-family: 'Malgun Gothic', 'Noto Sans KR', Arial, sans-serif; color:#1a1a2e; padding:24px; width:720px;">
        <h1 style="margin:0 0 6px; font-size:22px;">AI 프로젝트 주간 레포트</h1>
        <p style="margin:0 0 18px; color:#6b7280; font-size:12px;">발행 시각: ${issuedAt}</p>

        <section style="margin-bottom:18px; padding:14px; border:1px solid #e0e6f0; border-radius:8px;">
          <h2 style="margin:0 0 10px; font-size:16px;">기본 정보</h2>
          <p style="margin:4px 0;"><b>컨설팅 주차</b>: ${week}주차</p>
          <p style="margin:4px 0;"><b>협력사</b>: ${escapeHtml(company.name)}</p>
          <p style="margin:4px 0;"><b>프로젝트 시작일</b>: ${escapeHtml(company.schedule?.startDate || "-")}</p>
        </section>

        <section style="margin-bottom:18px; padding:14px; border:1px solid #e0e6f0; border-radius:8px;">
          <h2 style="margin:0 0 10px; font-size:16px;">주요 전달 내용</h2>
          <p style="margin:0; white-space:pre-wrap; line-height:1.6;">${escapeHtml(note || "-")}</p>
        </section>

        <section style="margin-bottom:18px; padding:14px; border:1px solid #e0e6f0; border-radius:8px;">
          <h2 style="margin:0 0 10px; font-size:16px;">협력사 운영 요약</h2>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <tr>
              <td style="padding:8px; border:1px solid #e0e6f0;"><b>전체 진척도</b><br />${overallProgressAvg}%</td>
              <td style="padding:8px; border:1px solid #e0e6f0;"><b>일정 목표 달성율</b><br />${scheduleGoalAvg ?? 0}%</td>
              <td style="padding:8px; border:1px solid #e0e6f0;"><b>총 참여자</b><br />${participantCount}명</td>
              <td style="padding:8px; border:1px solid #e0e6f0;"><b>총 과제</b><br />${taskCount}건</td>
            </tr>
          </table>
        </section>

        <section style="padding:14px; border:1px solid #e0e6f0; border-radius:8px;">
          <h2 style="margin:0 0 10px; font-size:16px;">과제별 진척 현황</h2>
          <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
              <tr style="background:#f8f9fc;">
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">과제명</th>
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">참여자</th>
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">부서</th>
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">진척도</th>
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">일정 상태</th>
                <th style="padding:8px; border:1px solid #e0e6f0; text-align:left;">주간보고</th>
              </tr>
            </thead>
            <tbody>${taskRowsHtml}</tbody>
          </table>
        </section>
      </div>
    `;
  }

  async function downloadWeeklyReportPdf(company, note) {
    const filename = `주간레포트_${company.name}_${getConsultingWeek(company?.schedule?.startDate)}주차.pdf`.replace(
      /[\\/:*?"<>|]/g,
      "_"
    );
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.innerHTML = buildWeeklyReportDocument(company, note);
    document.body.appendChild(wrapper);
    const element = wrapper.querySelector(".pdf-report");

    try {
      if (typeof html2pdf === "undefined") {
        throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
      }
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
        })
        .from(element)
        .save();
      return filename;
    } finally {
      wrapper.remove();
    }
  }

  function render() {
    if (state.loading) {
      app.innerHTML = '<div class="empty" style="margin:48px auto; max-width:420px">데이터를 불러오는 중입니다...</div>';
      return;
    }
    if (!state.auth) renderLogin();
    else renderShell();
  }

  async function bootstrap() {
    try {
      const data = await API.getDashboard();
      state.companies = (data.companies || []).map((c) => ensureCompanyFields(c));
      state.companies.forEach((c) => c.participants.forEach((p) => p.tasks.forEach((t) => ensureTaskFields(t))));
      state.meta = data.meta || {};
      state.selectedCompanyId = state.companies[0]?.id || null;
      state.selectedParticipantId = state.companies[0]?.participants[0]?.id || null;
      state.selectedTaskId = state.companies[0]?.participants[0]?.tasks[0]?.id || null;
      state.lastLocalSaveAt = state.meta.lastSavedAt || null;
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      app.innerHTML = `<div class="empty" style="margin:48px auto; max-width:480px">데이터를 불러오지 못했습니다.<br />${escapeHtml(err.message)}<br /><br /><button class="btn primary" onclick="location.reload()">다시 시도</button></div>`;
    }
  }

  document.addEventListener("click", async (event) => {
    const stop = event.target.closest("[data-stop]");
    if (stop) event.stopPropagation();
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "login-tab") {
      state.loginTab = el.dataset.tab;
      render();
    }

    if (action === "admin-login") {
      const password = document.getElementById("admin-password").value;
      try {
        const auth = await API.adminLogin(password);
        state.auth = auth;
        state.view = "admin";
        toast("관리자 모드로 로그인했습니다.");
        render();
      } catch (err) {
        document.getElementById("login-error").textContent = err.message;
      }
    }

    if (action === "participant-login") {
      const companyId = document.getElementById("login-company").value;
      const name = document.getElementById("login-name").value.trim();
      const email = document.getElementById("login-email").value.trim().toLowerCase();
      try {
        const auth = await API.participantLogin({ companyId, name, email });
        state.auth = auth;
        state.selectedCompanyId = auth.companyId;
        state.selectedParticipantId = auth.participantId;
        state.view = "company";
        toast("참여자 모드로 로그인했습니다.");
        render();
        maybeShowParticipantUpdatePopup();
      } catch (err) {
        document.getElementById("login-error").textContent = err.message;
        if (err.body?.needRegister) {
          document.getElementById("new-dept-wrap").classList.remove("hidden");
          document.querySelector("[data-action='participant-register']").classList.remove("hidden");
        }
      }
    }

    if (action === "participant-register") {
      const companyId = document.getElementById("login-company").value;
      const name = document.getElementById("login-name").value.trim();
      const email = document.getElementById("login-email").value.trim().toLowerCase();
      const dept = document.getElementById("login-dept").value.trim();
      try {
        const auth = await API.participantRegister({ companyId, name, email, dept });
        const refreshed = await API.getDashboard();
        state.companies = refreshed.companies;
        state.meta = refreshed.meta || {};
        state.auth = auth;
        state.selectedCompanyId = auth.companyId;
        state.selectedParticipantId = auth.participantId;
        state.view = "personal";
        toast("신규 참여자로 등록했습니다.");
        render();
      } catch (err) {
        document.getElementById("login-error").textContent = err.message;
      }
    }

    if (action === "logout") {
      state.auth = null;
      state.view = "login";
      toast("로그아웃했습니다.");
      render();
    }

    if (action === "add-task-member") {
      const list = document.getElementById("task-members");
      if (!list) return;
      list.insertAdjacentHTML(
        "beforeend",
        renderMemberRow({ name: "", role: "", email: "", position: "", isOwner: false }, true)
      );
    }

    if (action === "remove-task-member") {
      const row = el.closest(".task-member-row");
      if (!row) return;
      if (row.dataset.owner === "1") return toast("과제 등록자는 삭제할 수 없습니다.");
      row.remove();
    }

    if (action === "nav") setView(el.dataset.view);
    if (action === "open-add-company") openModal("addCompany");
    if (action === "open-add-participant") openModal("addParticipant");
    if (action === "open-report") openModal("report");
    if (action === "close-modal") closeModal();
    if (action === "backdrop-close") {
      if (event.target === el) closeModal();
    }
    if (action === "open-schedule") openModal("schedule", { companyId: el.dataset.company });
    if (action === "open-add-task") {
      const target = allParticipants().find((row) => row.participant.id === el.dataset.participant)?.participant;
      if (!canManageParticipant(target)) {
        return toast("본인 과제만 추가할 수 있습니다.");
      }
      state.form.csvTasks = null;
      state.form.taskDraft = {};
      state.form.taskMembers = defaultTaskMembers(target);
      openModal("addTask", { companyId: el.dataset.company, participantId: el.dataset.participant });
    }
    if (action === "open-add-notice") {
      openModal("addNotice", { companyId: el.dataset.company || state.selectedCompanyId });
    }

    if (action === "delete-company") {
      if (!isAdmin()) return toast("관리자만 협력사를 삭제할 수 있습니다.");
      const company = state.companies.find((c) => c.id === el.dataset.company);
      if (!company) return toast("협력사를 찾을 수 없습니다.");
      const participantCount = (company.participants || []).length;
      const taskCount = (company.participants || []).reduce((n, p) => n + (p.tasks || []).length, 0);
      const okConfirm = window.confirm(
        `"${company.name}" 협력사를 삭제할까요?\n참여자 ${participantCount}명, 과제 ${taskCount}건이 함께 삭제되며 DB에도 반영됩니다.`
      );
      if (!okConfirm) return;
      state.companies = state.companies.filter((c) => c.id !== company.id);
      if (state.selectedCompanyId === company.id) {
        state.selectedCompanyId = state.companies[0]?.id || null;
        state.selectedParticipantId = null;
        state.selectedTaskId = null;
      }
      await persist(`"${company.name}" 협력사를 삭제했습니다.`);
      render();
    }

    if (action === "delete-participant") {
      if (!isAdmin()) return toast("관리자만 참여자를 삭제할 수 있습니다.");
      const company = state.companies.find((c) => c.id === el.dataset.company) || currentCompany();
      const participant = company?.participants?.find((p) => p.id === el.dataset.participant);
      if (!company || !participant) return toast("참여자를 찾을 수 없습니다.");
      const taskCount = (participant.tasks || []).length;
      const okConfirm = window.confirm(
        `"${participant.name}" 참여자를 삭제할까요?\n과제 ${taskCount}건이 함께 삭제되며 DB에도 반영됩니다.`
      );
      if (!okConfirm) return;
      company.participants = (company.participants || []).filter((p) => p.id !== participant.id);
      if (state.selectedParticipantId === participant.id) {
        state.selectedParticipantId = company.participants[0]?.id || null;
        state.selectedTaskId = null;
        state.selectedWeek = null;
      }
      await persist(`"${participant.name}" 참여자를 삭제했습니다.`);
      render();
    }

    if (action === "delete-task") {
      const company = state.companies.find((c) => c.id === el.dataset.company) || currentCompany();
      const participant =
        company?.participants?.find((p) => p.id === el.dataset.participant) || currentParticipant();
      const task = participant?.tasks?.find((t) => t.id === el.dataset.task);
      if (!company || !participant || !task) return toast("과제를 찾을 수 없습니다.");
      if (!canManageParticipant(participant)) {
        return toast("본인 과제만 삭제할 수 있습니다.");
      }
      const okConfirm = window.confirm(
        `"${task.name}" 과제를 삭제할까요?\nDB에서도 삭제됩니다.`
      );
      if (!okConfirm) return;
      participant.tasks = (participant.tasks || []).filter((t) => t.id !== task.id);
      if (state.selectedTaskId === task.id) state.selectedTaskId = null;
      await persist(`"${task.name}" 과제를 삭제했습니다.`);
      render();
    }
    if (action === "open-notice-detail") {
      openModal("noticeDetail", { noticeId: el.dataset.notice });
    }
    if (action === "ack-notice") {
      const company = currentCompany();
      const noticeId = el.dataset.notice || state.form.noticeId;
      markNoticeSeen(company?.id, noticeId);
      closeModal();
      toast("공지를 확인했습니다.");
    }
    if (action === "open-task-detail") {
      if (event.target.closest("input,button,select,textarea")) return;
      openModal("taskDetail", { taskId: el.dataset.task });
    }

    if (action === "select-task") {
      state.selectedTaskId = el.dataset.task;
      render();
    }

    if (action === "view-person") {
      const target = allParticipants().find((row) => row.participant.id === el.dataset.participant)?.participant;
      if (!canViewParticipant(target)) {
        window.alert("본인 과제만 개인 대시보드에서 열람할 수 있습니다.");
        return;
      }
      state.selectedCompanyId = el.dataset.company;
      state.selectedParticipantId = el.dataset.participant;
      if (el.dataset.task) state.selectedTaskId = el.dataset.task;
      state.selectedWeek = null;
      state.view = "personal";
      render();
    }

    if (action === "select-person") {
      if (!isAdmin()) {
        window.alert("본인 과제만 개인 대시보드에서 열람할 수 있습니다.");
        return;
      }
      state.selectedCompanyId = el.dataset.company || state.selectedCompanyId;
      state.selectedParticipantId = el.dataset.participant;
      state.selectedTaskId = null;
      state.selectedWeek = null;
      state.view = "personal";
      render();
    }

    if (action === "request-participant-update") {
      const company = ensureCompanyFields(
        state.companies.find((c) => c.id === el.dataset.company) || currentCompany()
      );
      if (!company) return toast("협력사를 찾을 수 없습니다.");
      const message =
        "귀사의 AX 컨설팅 프로젝트 참여자를 업데이트해 주세요. 명단·부서·이메일을 확인하고 필요 시 참여자 등록으로 반영해 주세요.";
      company.participantUpdateRequest = {
        pending: true,
        message,
        requestedAt: new Date().toISOString(),
        acknowledgedAt: null
      };
      try {
        const result = await API.syncParticipants();
        state.meta.lastParticipantSyncAt = result.requestedAt;
      } catch {
        /* 시트 연동 실패해도 앱 내 요청은 유지 */
      }
      await persist(`${company.name} 협력사 허브에 참여자 업데이트 요청을 전달했습니다.`);
      render();
    }

    if (action === "ack-participant-update") {
      const company = currentCompany();
      if (company?.participantUpdateRequest) {
        company.participantUpdateRequest.pending = false;
        company.participantUpdateRequest.acknowledgedAt = new Date().toISOString();
      }
      await persist("참여자 업데이트 요청을 확인했습니다.");
      closeModal();
    }

    if (action === "save-notice") {
      const companyId = state.form.companyId || state.selectedCompanyId;
      const company = ensureCompanyFields(state.companies.find((c) => c.id === companyId));
      const title = document.getElementById("notice-title")?.value.trim() || "";
      const content = document.getElementById("notice-content")?.value.trim() || "";
      if (!title || !content) return toast("제목과 내용을 입력해 주세요.");
      company.notices.push({
        id: uid("n"),
        title,
        content,
        createdAt: new Date().toISOString()
      });
      await persist("공지사항을 등록했습니다.");
      closeModal();
    }

    if (action === "publish-report") {
      const company = currentCompany();
      if (!company) return toast("협력사를 선택해 주세요.");
      const note = document.getElementById("report-note")?.value || "";
      try {
        const filename = await downloadWeeklyReportPdf(company, note);
        try {
          const result = await API.publishReport({
            companyId: company.id,
            note
          });
          state.meta.lastReportRequestAt = result.requestedAt;
        } catch {
          /* PDF 다운로드는 성공했으므로 메타 기록 실패는 무시 */
        }
        closeModal();
        toast(`PDF 레포트를 발행했습니다. (${filename})`);
      } catch (err) {
        toast(err.message || "PDF 발행에 실패했습니다.");
      }
    }

    if (action === "save-personal") {
      const company = currentCompany();
      const participant = currentParticipant();
      if (!isMine(participant)) {
        window.alert("본인 주간 보고만 저장할 수 있습니다.");
        return;
      }
      if (!isViewingCurrentWeek(company)) {
        return toast("과거 주차는 조회만 가능합니다. 이번 주로 전환한 뒤 저장하세요.");
      }
      const task = currentTask();
      if (!task) return toast("과제를 먼저 추가해 주세요.");
      const weeklySummary = (document.getElementById("weekly-summary")?.value || "").trim();
      const nextWeekPlan = (document.getElementById("task-next-plan")?.value || "").trim();
      if (!weeklySummary || !nextWeekPlan) {
        window.alert("금주 요약과 차주 계획을 모두 입력한 뒤 저장해 주세요.");
        return;
      }
      const progressInput = document.getElementById("report-progress");
      if (progressInput) {
        task.progress = Math.min(100, Math.max(0, Number(progressInput.value || 0)));
      }
      task.weeklySummary = weeklySummary;
      task.nextWeekPlan = nextWeekPlan;
      task.reportCompleted = true;
      upsertTaskWeekSnapshot(task, currentWeekNumber(company), {
        progress: task.progress,
        weeklySummary: task.weeklySummary,
        nextWeekPlan: task.nextWeekPlan,
        instructorFeedback: task.instructorFeedback || "",
        reportCompleted: true
      });
      await persist("선택한 과제의 주간 보고를 저장했으며 '작성완료'로 업데이트되었습니다.");
      render();
    }

    if (action === "save-feedback") {
      if (!isAdmin()) {
        window.alert("관리자만 피드백을 저장할 수 있습니다.");
        return;
      }
      const company = currentCompany();
      if (!isViewingCurrentWeek(company)) {
        return toast("과거 주차의 피드백은 수정할 수 없습니다.");
      }
      const task = currentTask();
      if (!task) return toast("과제를 먼저 추가해 주세요.");
      task.weeklySummary = document.getElementById("weekly-summary")?.value || task.weeklySummary || "";
      task.nextWeekPlan = document.getElementById("task-next-plan")?.value || task.nextWeekPlan || "";
      task.instructorFeedback = document.getElementById("task-feedback")?.value || "";
      upsertTaskWeekSnapshot(task, currentWeekNumber(company), {
        progress: task.progress,
        weeklySummary: task.weeklySummary,
        nextWeekPlan: task.nextWeekPlan,
        instructorFeedback: task.instructorFeedback,
        reportCompleted: Boolean(task.reportCompleted)
      });
      await persist("선택한 과제의 컨설턴트 피드백을 저장했습니다.");
      render();
    }

    if (action === "add-company") {
      event.preventDefault();
      try {
        const input = document.getElementById("company-name");
        const name = input?.value.trim() || "";
        if (!name) return toast("협력사명을 입력해 주세요.");
        const now = typeof today === "function" ? today() : new Date();
        const todayIso = now.toISOString().slice(0, 10);
        const end = new Date(now);
        end.setDate(end.getDate() + 58);
        const kickoff = new Date(now);
        kickoff.setDate(kickoff.getDate() + 2);
        const company = {
          id: uid("c"),
          name,
          schedule: {
            startDate: todayIso,
            kickoffDate: kickoff.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10)
          },
          pmo: { name: "", email: "" },
          notices: [],
          participantUpdateRequest: {
            pending: false,
            message: "",
            requestedAt: null,
            acknowledgedAt: null
          },
          participants: []
        };
        state.companies.push(company);
        state.selectedCompanyId = company.id;
        const ok = await persist("협력사를 추가했습니다.");
        if (ok) closeModal();
        else {
          state.companies = state.companies.filter((c) => c.id !== company.id);
          render();
        }
      } catch (err) {
        toast(err.message || "협력사 추가에 실패했습니다.");
      }
    }

    if (action === "add-participant") {
      const name = document.getElementById("new-name").value.trim();
      const email = document.getElementById("new-email").value.trim();
      const dept = document.getElementById("new-dept").value.trim();
      if (!name || !email || !dept) return toast("이름, 이메일, 부서를 모두 입력해 주세요.");
      currentCompany().participants.push({
        id: uid("p"),
        name,
        email,
        dept,
        status: "정상",
        summary: "",
        nextWeekPlan: "",
        instructorMemo: "",
        tasks: []
      });
      await persist("참여자를 등록했습니다.");
      closeModal();
    }

    if (action === "add-task") {
      const company = state.companies.find((c) => c.id === state.form.companyId) || currentCompany();
      const participant =
        company.participants.find((p) => p.id === state.form.participantId) || currentParticipant();
      if (!canManageParticipant(participant)) {
        return toast("본인 과제만 추가할 수 있습니다.");
      }
      const csvTasks = state.form.csvTasks;
      const created = [];

      if (Array.isArray(csvTasks) && csvTasks.length) {
        csvTasks.forEach((row) => {
          const task = ensureTaskFields({
            id: uid("t"),
            name: row.name,
            progress: Number(row.progress || 0),
            startDate: row.startDate || "",
            endDate: row.endDate || "",
            goal: row.goal || "",
            asIsProcess: row.asIsProcess || "",
            toBeProcess: row.toBeProcess || "",
            difficulty: row.difficulty || "중",
            hierarchy: row.hierarchy || emptyHierarchy(),
            statistics: row.statistics || emptyStatistics(),
            members: mergeTaskMembers(defaultTaskMembers(participant), row.members),
            weeklySummary: "",
            nextWeekPlan: "",
            instructorFeedback: "",
            reportCompleted: false
          });
          participant.tasks.push(task);
          created.push(task);
        });
      } else {
        const taskName = document.getElementById("task-name")?.value.trim() || "";
        if (!taskName) return toast("과제명을 입력하거나 CSV를 업로드해 주세요.");
        const task = ensureTaskFields({
          id: uid("t"),
          name: taskName,
          progress: 0,
          startDate: document.getElementById("task-start")?.value || "",
          endDate: document.getElementById("task-end")?.value || "",
          goal: document.getElementById("task-goal")?.value || "",
          asIsProcess: document.getElementById("task-asis")?.value || "",
          toBeProcess: document.getElementById("task-tobe")?.value || "",
          difficulty: document.getElementById("task-difficulty")?.value || "중",
          hierarchy: collectHierarchy("task-"),
          statistics: collectStatistics("task-"),
          members: collectTaskMembers(),
          weeklySummary: "",
          nextWeekPlan: "",
          instructorFeedback: "",
          reportCompleted: false
        });
        participant.tasks.push(task);
        created.push(task);
      }

      state.selectedTaskId = created[0].id;
      state.selectedCompanyId = company.id;
      state.selectedParticipantId = participant.id;
      state.form.csvTasks = null;
      await persist(created.length > 1 ? `과제 ${created.length}건을 추가했습니다.` : "과제를 추가했습니다.");
      closeModal();
    }

    if (action === "save-task-detail") {
      const participant = currentParticipant();
      if (!canManageParticipant(participant)) {
        return toast("본인 과제만 수정할 수 있습니다.");
      }
      const task = participant?.tasks.find((t) => t.id === state.form.taskId) || currentTask();
      if (!task) return toast("과제를 찾을 수 없습니다.");
      task.name = document.getElementById("detail-task-name")?.value.trim() || task.name;
      task.startDate = document.getElementById("detail-task-start")?.value || "";
      task.endDate = document.getElementById("detail-task-end")?.value || "";
      task.goal = document.getElementById("detail-task-goal")?.value || "";
      task.asIsProcess = document.getElementById("detail-task-asis")?.value || "";
      task.toBeProcess = document.getElementById("detail-task-tobe")?.value || "";
      task.difficulty = normalizeDifficulty(document.getElementById("detail-task-difficulty")?.value || task.difficulty);
      task.hierarchy = collectHierarchy("detail-task-");
      task.statistics = collectStatistics("detail-task-");
      task.members = collectTaskMembers();
      await persist("과제 상세를 저장했습니다.");
      closeModal();
    }

    if (action === "save-schedule") {
      const company = ensureCompanyFields(state.companies.find((c) => c.id === state.form.companyId));
      const startDate = document.getElementById("schedule-start").value;
      const kickoffDate = document.getElementById("schedule-kickoff").value;
      const endDate = document.getElementById("schedule-end").value;
      if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
        return toast("종료일은 시작일보다 늦어야 합니다.");
      }
      company.schedule = { startDate, kickoffDate, endDate };
      company.pmo = {
        name: document.getElementById("pmo-name")?.value.trim() || "",
        email: document.getElementById("pmo-email")?.value.trim() || ""
      };
      await persist("협력사 일정과 PMO 정보를 저장했습니다.");
      closeModal();
    }
  });

  let progressSaveTimer = null;

  document.addEventListener("input", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "search") {
      state.search = el.value;
      render();
      const input = document.getElementById("search");
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }

    if (action === "task-progress") {
      const company = currentCompany();
      if (!isViewingCurrentWeek(company)) return;
      const participant = currentParticipant();
      if (!isMine(participant)) return;
      const task = participant.tasks.find((t) => t.id === el.dataset.task);
      if (!task) return;
      task.progress = Number(el.value);
      const statusCls = taskScheduleClass(task, company);
      const reportValue = document.getElementById("report-progress-value");
      if (reportValue) {
        reportValue.textContent = `${task.progress}%`;
        reportValue.className = `progress-value ${statusCls}`;
      }
      el.className = `range-${statusCls}`;

      const listRow = document.querySelector(`.task-row[data-task="${task.id}"] .task-progress-wrap`);
      const bar = listRow?.querySelector(".progress-cell:not(.expected-progress) .bar");
      const valueEl = listRow?.querySelector(".progress-cell:not(.expected-progress) .progress-value");
      if (bar) {
        bar.style.width = `${task.progress}%`;
        bar.className = `bar ${statusCls}`;
      }
      if (valueEl) {
        valueEl.textContent = `${task.progress}%`;
        valueEl.className = `progress-value ${statusCls}`;
      }
      const statusBadge = document.querySelector(`.task-row[data-task="${task.id}"] .task-status-badge`);
      const taskSched = taskScheduleStatus(task, company);
      if (statusBadge) {
        statusBadge.className = `badge ${taskSched.cls} task-status-badge`;
        statusBadge.textContent = taskSched.label;
      }

      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(async () => {
        upsertTaskWeekSnapshot(task, currentWeekNumber(company), {
          progress: task.progress,
          weeklySummary: task.weeklySummary || "",
          nextWeekPlan: task.nextWeekPlan || "",
          instructorFeedback: task.instructorFeedback || "",
          reportCompleted: Boolean(task.reportCompleted)
        });
        await persist("진척도를 저장했습니다.");
      }, 400);
    }
  });

  document.addEventListener("change", async (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "select-company") {
      state.selectedCompanyId = el.value;
      state.selectedWeek = null;
      const company = currentCompany();
      if (company?.participants[0]) state.selectedParticipantId = company.participants[0].id;
      render();
      maybeShowParticipantUpdatePopup();
    }

    if (action === "change-report-week") {
      state.selectedWeek = Number(el.value);
      render();
    }

    if (action === "change-report-task") {
      state.selectedTaskId = el.value;
      render();
    }

    if (action === "filter-status") {
      state.filterStatus = el.value;
      render();
    }

    if (action === "filter-company") {
      state.filterCompanyId = el.value || "all";
      state.filterParticipantId = "all";
      render();
    }

    if (action === "filter-participant") {
      state.filterParticipantId = el.value || "all";
      render();
    }

    if (action === "task-csv-change") {
      const file = el.files?.[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseCsvTasks(text);
      const preview = document.getElementById("csv-preview");
      if (preview) {
        preview.textContent = rows.length
          ? `CSV ${rows.length}건 준비됨: ${rows
              .slice(0, 3)
              .map((r) => r.name)
              .join(", ")}${rows.length > 3 ? " ..." : ""}`
          : "CSV에서 유효한 과제 행을 찾지 못했습니다.";
      }
      if (rows[0]) applyTaskDraftToInputs(rows[0]);
      state.form.csvTasks = rows.length > 1 ? rows : null;
    }

    if (action === "task-pdf-change") {
      const file = el.files?.[0];
      if (!file) return;
      const preview = document.getElementById("pdf-preview");
      if (preview) preview.textContent = "PDF 분석 중...";

      try {
        const text = await extractPdfText(file);
        if (!text.trim()) {
          if (preview) preview.textContent = "PDF에서 텍스트를 추출하지 못했습니다. (스캔 문서일 수 있습니다)";
          return;
        }
        const draft = parseTaskDraftFromText(text);
        applyTaskDraftToInputs(draft);
        const filledCount = ["name", "startDate", "endDate", "goal", "asIsProcess", "toBeProcess"].filter(
          (k) => String(draft[k] || "").trim()
        ).length;
        if (preview) {
          preview.textContent = filledCount
            ? `PDF 분석 완료: ${filledCount}개 항목을 자동 기입했습니다.`
            : "PDF 텍스트는 읽었지만 자동 매핑할 항목을 찾지 못했습니다. 수동 입력해 주세요.";
        }
      } catch (err) {
        if (preview) preview.textContent = `PDF 처리 실패: ${err.message}`;
      }
    }
  });

  bootstrap();
})();
