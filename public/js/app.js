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
    hubCompanies: [],
    meta: {},
    baseline: null,
    lastLocalSaveAt: null
  };

  let saveSeq = 0;

  function taskReportPatch(task, extra = {}) {
    const t = ensureTaskFields(task) || {};
    return {
      progress: Number(t.progress || 0),
      weeklySummary: t.weeklySummary || "",
      weeklyDetail: t.weeklyDetail || "",
      weeklyIssues: t.weeklyIssues || "",
      nextWeekPlan: t.nextWeekPlan || "",
      instructorFeedback: t.instructorFeedback || "",
      workStatus: t.workStatus || "개발",
      reportCompleted: Boolean(t.reportCompleted),
      ...extra
    };
  }

  function emptyReportView(missing = true) {
    return {
      progress: 0,
      weeklySummary: "",
      weeklyDetail: "",
      weeklyIssues: "",
      nextWeekPlan: "",
      instructorFeedback: "",
      workStatus: "개발",
      reportCompleted: false,
      savedAt: null,
      missing
    };
  }

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
    if (!t) return emptyReportView(true);
    const week = selectedWeekNumber(company);
    if (isViewingCurrentWeek(company)) {
      return {
        progress: Number(t.progress || 0),
        weeklySummary: t.weeklySummary || "",
        weeklyDetail: t.weeklyDetail || "",
        weeklyIssues: t.weeklyIssues || "",
        nextWeekPlan: t.nextWeekPlan || "",
        instructorFeedback: t.instructorFeedback || "",
        workStatus: t.workStatus || "개발",
        reportCompleted: Boolean(t.reportCompleted),
        savedAt: state.lastLocalSaveAt || state.meta?.lastSavedAt || null,
        missing: false
      };
    }
    const snap = getTaskWeekSnapshot(t, week);
    if (!snap) return emptyReportView(true);
    return {
      progress: Number(snap.progress || 0),
      weeklySummary: snap.weeklySummary || "",
      weeklyDetail: snap.weeklyDetail || "",
      weeklyIssues: snap.weeklyIssues || "",
      nextWeekPlan: snap.nextWeekPlan || "",
      instructorFeedback: snap.instructorFeedback || "",
      workStatus: snap.workStatus || t.workStatus || "개발",
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
      weeklyDetail: patch.weeklyDetail || "",
      weeklyIssues: patch.weeklyIssues || "",
      nextWeekPlan: patch.nextWeekPlan || "",
      instructorFeedback: patch.instructorFeedback || "",
      workStatus: patch.workStatus || task.workStatus || "개발",
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

  function isPmo() {
    return state.auth?.role === "pmo";
  }

  function isMine(participant) {
    return Boolean(participant?.id && participant.id === state.auth?.participantId);
  }

  function companyOfParticipant(participant) {
    if (!participant) return null;
    return state.companies.find((c) => (c.participants || []).some((p) => p.id === participant.id)) || null;
  }

  function canBrowseCompany(company) {
    return isAdmin() || (isPmo() && company?.id === state.auth?.companyId);
  }

  function canViewParticipant(participant) {
    if (!participant) return false;
    if (isAdmin() || isMine(participant)) return true;
    if (!isPmo()) return false;
    return companyOfParticipant(participant)?.id === state.auth?.companyId;
  }

  function canManageParticipant(participant) {
    return isAdmin() || isMine(participant);
  }

  function canManageHubParticipants(company = currentCompany()) { return isAdmin() || (isPmo() && company?.id === state.auth?.companyId); }

  function canEditParticipantProfile(company, participant) {
    return Boolean(company && participant && (canManageHubParticipants(company) || (state.auth?.role === 'participant' && company.id === state.auth.companyId && isMine(participant))));
  }

  function canManageNotices(company) {
    if (!company) return false;
    return isAdmin() || (isPmo() && company.id === state.auth?.companyId);
  }

  function lockToOwnParticipant() {
    if (isPmo() && state.auth?.companyId) {
      state.selectedCompanyId = state.auth.companyId;
      return;
    }
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
    const changes = buildDashboardChanges(state.baseline, state.companies);
    if (!hasDashboardChanges(changes)) {
      if (message) toast(message);
      return true;
    }
    const seq = ++saveSeq;
    try {
      state.saving = true;
      const saved = await API.saveDashboardChanges(changes);
      if (seq === saveSeq) {
        if (saved.session) { state.auth=saved.session; API.setToken(state.auth.token); saveSession(); }
        applyDashboardData(saved);
        if (isPmo() && (state.auth.participantId || null) !== (currentCompany()?.participants.find(p => String(p.email || '').trim().toLowerCase() === String(state.auth.email || '').trim().toLowerCase())?.id || null)) {
          state.auth=await API.session(); API.setToken(state.auth.token); await reloadDashboardData();
        }
      }
      if (message) toast(message);
      return true;
    } catch (err) {
      toast(err.message || "저장에 실패했습니다.");
      if (err.status === 401) {
        state.auth = null;
        state.view = "login";
        API.setToken("");
        render();
        return false;
      }
      // Keep the draft and DOM inputs on conflicts/denials; explicit refresh discards them.
      if (err.status === 403 || err.status === 409) toast('입력 내용은 유지했습니다. 최신 데이터로 다시 불러오려면 업데이트를 누르세요.');
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
    if (view === 'personal') {
      const own=currentCompany()?.participants.find(p => p.id === state.auth?.participantId);
      if (!isAdmin() && state.auth?.participantId && (!isPmo() || own?.tasks?.length)) state.selectedParticipantId = state.auth.participantId;
      lockToOwnParticipant();
    }
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
      <button class="btn primary" style="width:100%" data-action="participant-login">참여자·PMO 로그인</button>
      <button class="btn ghost hidden" style="width:100%; margin-top:8px" data-action="participant-register">신규 등록하고 접속</button>
      <p class="helper" style="margin-top:14px">참여자는 등록된 이름·이메일로, 협력사 PMO는 PMO 표에 등록된 이름·이메일로 로그인합니다.</p>
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
              <div class="side-sub">${isAdmin() ? "관리자 모드" : isPmo() ? "PMO 모드" : "참여자 모드"}</div>
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
            ${isAdmin() ? "전체 협력사/참여자 관리 권한" : isPmo() ? "소속 협력사 조회·공지 관리 권한" : "본인 데이터 편집 권한"}<br />
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
        ${canManageNotices(currentCompany()) ? '<button class="btn ghost" data-action="open-add-notice">공지 등록</button>' : ""}
${canManageHubParticipants() ? '<button class="btn ghost" data-action="open-add-participant">참여자 등록</button>' : ""}
        <button class="btn ghost" data-action="refresh-dashboard" title="DB에서 최신 데이터를 다시 불러옵니다">업데이트</button>
      `;
    }
    if (state.view === "personal") {
      const hint =
        '<p class="timeout-hint">' +
        '<span class="timeout-hint-line">입력 후에는 저장해 주세요</span>' +
        "</p>";
      if (isAdmin()) {
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
                ${renderPmoLines(c)}
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
              <button type="button" class="notice-item notice-item-btn ${isNew ? "is-new" : ""}" data-action="open-notice-detail" data-company="${company.id}" data-notice="${n.id}">
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

  function pmoMembersOf(company) {
    return normalizePmo(company?.pmo).members;
  }

  function renderPmoLines(company) {
    const rows = pmoMembersOf(company);
    if (!rows.length) {
      return '<div class="date-row pmo-row"><span>PMO</span><b><span class="pmo-empty">미등록</span></b></div>';
    }
    return rows
      .map((row) => {
        const text = [row.name, row.position, row.email].filter(Boolean).join(" ");
        return `<div class="date-row pmo-row"><span>PMO</span><b>${escapeHtml(text || "-")}</b></div>`;
      })
      .join("");
  }

  function renderPmoTable(company) {
    const rows = pmoMembersOf(company);
    if (!rows.length) return '<p class="helper pmo-empty">PMO 미등록</p>';
    return `
      <table class="pmo-table">
        <thead>
          <tr><th>이름</th><th>직위</th><th>이메일</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${escapeHtml(row.name || "-")}</td>
              <td>${escapeHtml(row.position || "-")}</td>
              <td>${escapeHtml(row.email || "-")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderPmoPanel(company) {
    return `
      <div class="card card-pad">
        <div class="section-title">
          <div>
            <h3>협력사 PMO</h3>
            <p>등록된 이름과 이메일로 PMO 로그인할 수 있습니다.</p>
          </div>
        </div>
        ${renderPmoTable(company)}
      </div>
    `;
  }

  function renderPmoEditRow(row = { name: "", position: "", email: "" }) {
    return `
      <tr class="pmo-edit-row">
        <td><input class="pmo-name" value="${escapeHtml(row.name || "")}" placeholder="이름" /></td>
        <td><input class="pmo-position" value="${escapeHtml(row.position || "")}" placeholder="직위" /></td>
        <td><input class="pmo-email" type="email" value="${escapeHtml(row.email || "")}" placeholder="pmo@company.com" /></td>
        <td><button type="button" class="btn ghost small" data-action="remove-pmo-row">삭제</button></td>
      </tr>
    `;
  }

  function renderCompanyHub() {
    const company = state.auth?.role === 'participant' ? (state.hubCompanies.find(c => c.id === state.auth.companyId) || currentCompany()) : currentCompany();
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
          ${renderPmoPanel(company)}
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
                      const feedbackDone = Boolean(task?.hasInstructorFeedback || task?.instructorFeedback?.trim());
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

  function personalParticipants(company) {
    const pmoEmails=new Set(pmoMembersOf(company).map(p => String(p.email || '').trim().toLowerCase()).filter(Boolean));
    return (company.participants || []).filter(p => !pmoEmails.has(String(p.email || '').trim().toLowerCase()) || p.tasks?.length);
  }

  function renderAdminParticipantOverview(company, { canDelete = true } = {}) {
    const rows = personalParticipants(company).filter(p => canBrowseCompany(company) || isMine(p));
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
                    ${
                      canEditParticipantProfile(company, participant)
                        ? `<button type="button" class="btn ghost small" data-action="edit-participant" data-company="${company.id}" data-participant="${participant.id}">수정</button>${canDelete && canManageHubParticipants(company) ? `<button type="button" class="btn ghost small danger" data-action="delete-participant" data-company="${company.id}" data-participant="${participant.id}" title="참여자 삭제">삭제</button>` : ""}`
                        : ""
                    }
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
    const browseCompany = canBrowseCompany(company);
    const visibleParticipants=personalParticipants(company);
    if (!visibleParticipants.length) {
      return `
        ${renderAdminParticipantOverview(company, { canDelete: canManageHubParticipants(company) })}
        <div class="empty">조회할 참여자가 없습니다. PMO는 참여자 등록 없이 소속 협력사 허브와 참여자 대시보드를 조회할 수 있습니다.</div>
      `;
    }
    if (!visibleParticipants.some((p) => p.id === state.selectedParticipantId)) {
      if (browseCompany) {
        state.selectedParticipantId = visibleParticipants[0].id;
      } else {
        lockToOwnParticipant();
      }
    }
    const participant = currentParticipant();
    if (!participant) return '<div class="empty">조회할 참여자가 없습니다. PMO는 참여자 등록 없이 소속 협력사 허브와 참여자 대시보드를 조회할 수 있습니다.</div>';
    if (!canViewParticipant(participant)) {
      return '<div class="empty">본인 과제만 열람할 수 있습니다.</div>';
    }
    const editable = isMine(participant) || isAdmin();
    const canManageTasks = canManageParticipant(participant);
    const viewingCurrent = isViewingCurrentWeek(company);
    const canEditReport = editable && (viewingCurrent || isAdmin());
    const canEditFeedback = isAdmin();
    const week = selectedWeekNumber(company);
    const schedule = scheduleStatus(company, participant);
    const task = currentTask();
    const reportView = viewTaskReport(task, company);
    const taskOptions = participant.tasks
      .map((item) => `<option value="${item.id}" ${task?.id === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
      .join("");

    return `
      <div class="grid" style="gap:16px">
        ${renderAdminParticipantOverview(company, { canDelete: canManageHubParticipants(company) })}
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
                    ? canEditReport
                      ? "이번 주 보고를 작성·수정할 수 있습니다. 과거 주차는 저장된 스냅샷을 조회합니다."
                      : "이번 주 보고를 조회합니다. 과거 주차는 저장된 스냅샷을 조회합니다."
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
                        : isPmo()
                          ? "소속 협력사 과제는 열람만 가능합니다. 주간 보고 본문은 해당 참여자만 수정합니다."
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
            <div class="section-title weekly-report-header">
              <div class="weekly-report-heading">
                <h3>주간 보고 · ${week}주차</h3>
                ${canEditReport ? '<div class="weekly-report-actions"><button class="btn primary small" data-action="save-personal">저장</button><button class="btn ghost small danger" data-action="delete-personal-report">삭제</button></div>' : ""}
              </div>
              <p>${viewingCurrent ? "과제를 선택한 뒤 금주 진전, 진행 상세, 이슈, 차주 계획을 작성합니다." : "선택한 주차에 저장된 스냅샷을 조회합니다."}</p>
            </div>
            ${
              participant.tasks.length
                ? reportView.missing && !viewingCurrent && !isAdmin()
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
                <label>금주 진전 *</label>
                <textarea id="weekly-summary" placeholder="한두 문장으로 이번 주 진전을 적어 주세요." ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.weeklySummary || "")}</textarea>
              </div>
              <div class="field">
                <label>진행 상세</label>
                <textarea id="weekly-detail" placeholder="구성·작업 내용 등 상세 (선택)" ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.weeklyDetail || "")}</textarea>
              </div>
              <div class="field">
                <label>금주 이슈</label>
                <textarea id="weekly-issues" placeholder="막힌 점, 확인이 필요한 사항 (선택)" ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.weeklyIssues || "")}</textarea>
              </div>
              <div class="field">
                <label>차주 계획 *</label>
                <textarea id="task-next-plan" placeholder="한 줄에 한 항목씩 입력하세요." ${canEditReport ? "" : "readonly class='readonly'"}>${escapeHtml(reportView.nextWeekPlan || "")}</textarea>
                <p class="helper" style="margin-top:6px">협력사 주간 레포트의 차주 계획 초안은 이 내용을 참고합니다.</p>
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
      editParticipant: renderAddParticipantModal,
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
    const wideClass = wide === "report" ? "modal-wide modal-report" : wide ? "modal-wide" : "";
    return `
      <div class="modal-backdrop" data-action="backdrop-close">
        <div class="modal ${wideClass}" data-stop="true">
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
    const company=state.companies.find(c => c.id === state.form.companyId) || currentCompany();
    const p=company.participants.find(p => p.id === (state.modal === 'editParticipant' ? state.form.participantId : state.form.pendingParticipantId));
    return modalShell(p ? '참여자 수정' : '참여자 등록',
      '<div class="field"><label>이름</label><input id="new-name" value="'+escapeHtml(p?.name || '')+'" /></div>'+
      '<div class="field"><label>이메일</label><input id="new-email" type="email" value="'+escapeHtml(p?.email || '')+'" /></div>'+
      '<div class="field"><label>부서</label><input id="new-dept" value="'+escapeHtml(p?.dept || '')+'" /></div>',
      '<button class="btn ghost" data-action="close-modal">취소</button><button class="btn primary" data-action="add-participant">'+(p?'수정 저장':'등록')+'</button>');
  }

  function difficultySelectHtml(id, selected = "중", disabled = false) {
    const value = normalizeDifficulty(selected);
    const lock = disabled ? "disabled class='readonly difficulty-select'" : "class='difficulty-select'";
    return `
      <select id="${id}" ${lock}>
        <option value="상" ${value === "상" ? "selected" : ""}>상</option>
        <option value="중" ${value === "중" ? "selected" : ""}>중</option>
        <option value="하" ${value === "하" ? "selected" : ""}>하</option>
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
          role: "과제 담당자",
          position: owner?.dept || "",
          isOwner: true
        }
      ],
      []
    );
  }

  function renderHierarchyFields(prefix, hierarchy, editable = true, projectName = "") {
    const h = normalizeHierarchy(hierarchy);
    const ro = editable ? "" : "readonly class='readonly'";
    return `
      <section class="task-add-panel">
        <h4>과제 계층</h4>
        <div class="field"><label>프로젝트명</label><input id="${prefix}project-name" value="${escapeHtml(projectName || "")}" ${ro} placeholder="예: Light ERP 프로토타입" /></div>
        <div class="grid hierarchy-grid">
          <div class="field"><label>L1 대분류</label><input id="${prefix}h-l1" value="${escapeHtml(h.l1)}" ${ro} placeholder="예: 사업기획" /></div>
          <div class="field"><label>L2 중분류</label><input id="${prefix}h-l2" value="${escapeHtml(h.l2)}" ${ro} placeholder="예: 신사업기획" /></div>
          <div class="field"><label>L3 소분류</label><input id="${prefix}h-l3" value="${escapeHtml(h.l3)}" ${ro} placeholder="예: 시장 트렌드 조사" /></div>
          <div class="field"><label>L4 세부분류</label><input id="${prefix}h-l4" value="${escapeHtml(h.l4)}" ${ro} placeholder="예: 신규 스타트업 발굴" /></div>
        </div>
      </section>
    `;
  }

  function applyProjectNameToInputs(draft, prefix = "task-") {
    if (!draft) return;
    const el = document.getElementById(`${prefix}project-name`);
    if (!el) return;
    const val = String(draft.projectName || "").trim();
    if (val) el.value = val;
  }

  function applyProjectNameToTask(task, prefix = "task-") {
    task.projectName = document.getElementById(`${prefix}project-name`)?.value.trim() || "";
  }

  function frequencyUnitSelectHtml(prefix, selected, editable = true) {
    const raw = String(selected || "").trim().toLowerCase();
    let value = "";
    if (raw === "일" || /day|daily|^d$/.test(raw)) value = "일";
    else if (raw === "주" || /week|weekly|^w$/.test(raw)) value = "주";
    else if (raw === "월" || /month|monthly|^m$/.test(raw)) value = "월";
    else if (raw === "년" || /year|yearly|annual|^y$/.test(raw)) value = "년";
    else if (["일", "주", "월", "년"].includes(String(selected || "").trim())) {
      value = String(selected).trim();
    }
    const lock = editable ? "" : "disabled class='readonly'";
    return `
      <select id="${prefix}stat-frequencyUnit" class="stat-manual-input" ${lock} data-action="recalc-stats">
        <option value="" ${!value ? "selected" : ""}>선택</option>
        <option value="일" ${value === "일" ? "selected" : ""}>일</option>
        <option value="주" ${value === "주" ? "selected" : ""}>주</option>
        <option value="월" ${value === "월" ? "selected" : ""}>월</option>
        <option value="년" ${value === "년" ? "selected" : ""}>년</option>
      </select>
    `;
  }

  function renderMetricFieldInput(prefix, field, stats, editable = true) {
    const ro = editable ? "" : "readonly class='readonly'";
    const value = stats[field.key] || "";
    return `
      <div class="field">
        <label>${escapeHtml(field.label)}</label>
        <input id="${prefix}stat-${field.key}" value="${escapeHtml(field.numeric ? formatThousands(value) : value)}" ${ro} data-action="${field.numeric ? "format-stat" : "recalc-stats"}" />
      </div>
    `;
  }

  function renderFrequencyFields(prefix, statistics, editable = true) {
    const stats = normalizeStatistics(statistics);
    const ro = editable ? "" : "readonly class='readonly'";
    return `
      <section class="task-add-panel frequency-panel">
        <div class="frequency-row">
          <div class="field stat-manual-field frequency-item">
            <label>빈도 단위</label>
            ${frequencyUnitSelectHtml(prefix, stats.frequencyUnit, editable)}
          </div>
          <div class="field stat-manual-field frequency-item">
            <label>빈도 횟수</label>
            <input id="${prefix}stat-frequencyCount" class="stat-manual-input" inputmode="decimal" value="${escapeHtml(formatThousands(stats.frequencyCount || ""))}" ${ro} data-action="format-stat" placeholder="예: 1" />
          </div>
          <div class="field frequency-item">
            <label>연간 빈도</label>
            <input id="${prefix}stat-annualFrequency" class="stat-derived-input readonly" value="${escapeHtml(formatThousands(stats.annualFrequency || ""))}" readonly data-derived="annualFrequency" placeholder="자동 계산" />
          </div>
        </div>
        <p class="helper frequency-hint">수행 빈도 · 연간 빈도 = 횟수 × 환산계수(일 365 / 주 52 / 월 12 / 년 1)</p>
      </section>
    `;
  }

  function renderStatisticsFields(prefix, statistics, editable = true) {
    const stats = normalizeStatistics(statistics);
    const byKey = Object.fromEntries(TASK_STAT_FIELDS.map((field) => [field.key, field]));
    const mainFields = PERF_METRIC_MAIN_KEYS.map((key) =>
      renderMetricFieldInput(prefix, byKey[key], stats, editable)
    ).join("");
    const footerFields = PERF_METRIC_FOOTER_KEYS.map((key) =>
      renderMetricFieldInput(prefix, byKey[key], stats, editable)
    ).join("");
    return `
      <section class="task-add-panel">
        <h4>성과 지표</h4>
        <p class="helper" style="margin-top:-2px">빈 칸은 As-Is/To-Be 프로세스와 수행 빈도 기준으로 BPA 성과 산식으로 자동 채웁니다. 이미 입력된 값은 유지합니다.</p>
        <div class="grid stats-form-grid">${mainFields}</div>
        <div class="grid stats-footer-grid">${footerFields}</div>
      </section>
    `;
  }

  function memberRoleSelectHtml(selected, editable = true) {
    const value = normalizeMemberRole(selected);
    const lock = editable ? "" : "disabled class='readonly'";
    return `
      <select class="task-member-role" ${lock}>
        <option value="과제 리더" ${value === "과제 리더" ? "selected" : ""}>과제 리더</option>
        <option value="과제 담당자" ${value === "과제 담당자" ? "selected" : ""}>과제 담당자</option>
      </select>
    `;
  }

  function renderMemberRow(member, editable = true) {
    const m = normalizeTaskMember(member, Boolean(member?.isOwner));
    const identityLock = !editable || m.isOwner ? "readonly class='readonly'" : "";
    return `
      <div class="task-member-row" data-owner="${m.isOwner ? "1" : "0"}">
        <input class="task-member-name" placeholder="이름" value="${escapeHtml(m.name)}" ${identityLock} />
        ${memberRoleSelectHtml(m.role, editable)}
        <input class="task-member-email" type="email" placeholder="이메일" value="${escapeHtml(m.email)}" ${identityLock} />
        <input class="task-member-position" placeholder="직급/부서" value="${escapeHtml(m.position)}" ${editable ? "" : "readonly class='readonly'"} />
        ${
          editable && !m.isOwner
            ? '<button type="button" class="btn ghost small" data-action="remove-task-member">삭제</button>'
            : '<span class="helper" style="margin:0">접속자</span>'
        }
      </div>
    `;
  }

  function renderMembersFields(members, editable = true, options = {}) {
    const list = Array.isArray(members) && members.length ? members : [];
    const midSave = Boolean(options.midSave);
    return `
      <section class="task-add-panel">
        <div class="section-title" style="margin-bottom:8px">
          <div>
            <h4 style="margin:0">과제 참여자</h4>
            <p class="helper" style="margin:4px 0 0">접속자 정보가 기본 기입되며, 역할은 과제 리더/과제 담당자 중 선택할 수 있습니다.</p>
          </div>
          ${
            editable
              ? `<div class="section-actions">
                  ${
                    midSave
                      ? '<button type="button" class="btn primary small btn-mid-save" data-action="save-task-section" data-section="members">중간 저장</button>'
                      : ""
                  }
                  <button type="button" class="btn ghost small" data-action="add-task-member">참여자 추가</button>
                </div>`
              : ""
          }
        </div>
        <div id="task-members" class="task-member-list">
          ${list.map((m) => renderMemberRow(m, editable)).join("")}
        </div>
      </section>
    `;
  }

  function processMethodSelectHtml(selected, editable = true) {
    const value = selected === "ai" || selected === "manual" ? selected : "";
    const lock = editable ? "" : "disabled class='readonly'";
    return `
      <select class="process-step-method" ${lock} data-action="preview-process">
        <option value="" ${!value ? "selected" : ""}>—</option>
        <option value="manual" ${value === "manual" ? "selected" : ""}>수작업</option>
        <option value="ai" ${value === "ai" ? "selected" : ""}>자동화</option>
      </select>
    `;
  }

  function processDifficultySelectHtml(selected, editable = true) {
    const value = normalizeDifficulty(selected);
    const lock = editable ? "class='process-step-difficulty'" : "disabled class='readonly process-step-difficulty'";
    return `
      <select ${lock} data-action="preview-process">
        <option value="상" ${value === "상" ? "selected" : ""}>상</option>
        <option value="중" ${value === "중" ? "selected" : ""}>중</option>
        <option value="하" ${value === "하" ? "selected" : ""}>하</option>
      </select>
    `;
  }

  function renderProcessStepCard(step, kind, index, total, editable = true) {
    const minutes =
      kind === "tobe"
        ? step.estimated_execution_time ?? step.execution_time ?? ""
        : step.execution_time ?? "";
    const hours = minutesToHoursInput(minutes);
    const ro = editable ? "" : "readonly class='readonly'";
    return `
      <div class="process-step-card" data-kind="${kind}" data-index="${index}">
        <div class="process-step-card-head">
          <span class="process-step-index">${index + 1}</span>
          ${
            editable
              ? `
            <button type="button" class="btn ghost small" data-action="move-process-step" data-dir="up" ${index === 0 ? "disabled" : ""} title="위로">↑</button>
            <button type="button" class="btn ghost small" data-action="move-process-step" data-dir="down" ${index >= total - 1 ? "disabled" : ""} title="아래로">↓</button>
            <button type="button" class="btn ghost small" data-action="remove-process-step">삭제</button>
          `
              : ""
          }
        </div>
        <div class="field">
          <label>단계명</label>
          <input class="process-step-name" value="${escapeHtml(step.name || "")}" ${ro} data-action="preview-process" placeholder="예: 자료 수집" />
        </div>
        <div class="process-step-meta-grid">
          <div class="field"><label>방식</label>${processMethodSelectHtml(step.method, editable)}</div>
          <div class="field">
            <label>도구</label>
            <input class="process-step-tool" value="${escapeHtml(step.tool || "")}" ${ro} data-action="preview-process" placeholder="엑셀, RPA…" />
          </div>
          <div class="field">
            <label>시간(시간)</label>
            <input class="process-step-hours" type="number" min="0" step="0.01" value="${escapeHtml(hours)}" ${ro} data-action="preview-process" placeholder="예: 1.5" title="입력은 시간 단위이며 저장·통계는 분으로 환산됩니다." />
          </div>
          ${
            kind === "tobe"
              ? `<div class="field"><label>난이도</label>${processDifficultySelectHtml(step.difficulty, editable)}</div>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderProcessColumn(kind, steps, editable = true) {
    const label = kind === "tobe" ? "To-Be" : "As-Is";
    const listId = kind === "tobe" ? "process-tobe-list" : "process-asis-list";
    const list = Array.isArray(steps) ? steps : [];
    const emptyHtml = list.length
      ? ""
      : `<p class="helper process-empty">등록된 단계가 없습니다.${editable ? " 단계 추가를 눌러 입력하세요." : ""}</p>`;
    return `
      <section class="process-column" data-kind="${kind}">
        <div class="section-title process-column-head">
          <div>
            <h4 style="margin:0">${label} 프로세스</h4>
            <p class="helper" style="margin:4px 0 0">단계를 위에서 아래 순서로 실행합니다.</p>
          </div>
          <div class="process-column-actions">
            ${
              editable && kind === "tobe"
                ? '<button type="button" class="btn ghost small" data-action="copy-asis-to-tobe">As-Is에서 가져오기</button>'
                : ""
            }
            ${
              editable
                ? `<button type="button" class="btn ghost small" data-action="add-process-step" data-kind="${kind}">단계 추가</button>`
                : ""
            }
          </div>
        </div>
        <div id="${listId}" class="process-step-list" data-editable="${editable ? "1" : "0"}">
          ${emptyHtml}
          ${list.map((step, index) => renderProcessStepCard(step, kind, index, list.length, editable)).join("")}
        </div>
        <details class="process-raw-details">
          <summary>원문 보기</summary>
          <pre class="process-raw-text" id="process-raw-${kind}">${escapeHtml(formatProcessFromSteps(list, kind))}</pre>
        </details>
      </section>
    `;
  }

  function renderProcessEditor(asIsText, toBeText, editable = true, options = {}) {
    const asIsSteps = parseProcessFromText(asIsText || "", "asis");
    const toBeSteps = parseProcessFromText(toBeText || "", "tobe");
    const midSave = Boolean(options.midSave);
    return `
      <section class="task-add-panel process-design-panel">
        <div class="section-title process-design-head">
          <div>
            <h4 style="margin:0">프로세스 설계</h4>
            <p class="helper" style="margin:4px 0 0">As-Is와 To-Be를 각각 단계 카드로 입력합니다. 시간은 <strong>시간</strong> 단위로 입력하며, 저장·통계(총 시간·절감)는 <strong>분</strong>으로 환산됩니다.</p>
          </div>
          ${
            editable && midSave
              ? '<button type="button" class="btn primary small btn-mid-save" data-action="save-task-section" data-section="process">중간 저장</button>'
              : ""
          }
        </div>
        <div class="process-editor-grid">
          ${renderProcessColumn("asis", asIsSteps, editable)}
          ${renderProcessColumn("tobe", toBeSteps, editable)}
        </div>
      </section>
    `;
  }

  function collectProcessSteps(kind, { keepEmpty = false } = {}) {
    const listId = kind === "tobe" ? "process-tobe-list" : "process-asis-list";
    return [...document.querySelectorAll(`#${listId} .process-step-card`)]
      .map((card, index) => {
        const hours = card.querySelector(".process-step-hours")?.value.trim() || "";
        const minutes = hoursToMinutes(hours);
        const step = {
          name: card.querySelector(".process-step-name")?.value.trim() || "",
          sort_order: index + 1,
          method: card.querySelector(".process-step-method")?.value || "",
          tool: card.querySelector(".process-step-tool")?.value.trim() || "",
          execution_time: minutes
        };
        if (kind === "tobe") {
          step.estimated_execution_time = minutes;
          step.difficulty = normalizeDifficulty(
            card.querySelector(".process-step-difficulty")?.value || "중"
          );
        }
        return step;
      })
      .filter((step) => {
        if (keepEmpty) return true;
        return Boolean(step.name || step.tool || step.method || step.execution_time);
      });
  }

  function collectProcessText(kind) {
    return formatProcessFromSteps(collectProcessSteps(kind), kind);
  }

  function syncProcessTotalsToStatistics() {
    const asIsSteps = collectProcessSteps("asis");
    const toBeSteps = collectProcessSteps("tobe");
    const alwaysOverwrite = new Set(["annualFrequency", "annualSavingsHours", "fteEquivalent"]);

    ["task-", "detail-task-"].forEach((prefix) => {
      const probe = document.getElementById(`${prefix}stat-asIsTotalTime`);
      if (!probe && !document.getElementById(`${prefix}stat-toBeTotalTime`)) return;

      const existing = {};
      TASK_STAT_FIELDS.forEach((field) => {
        const el = document.getElementById(`${prefix}stat-${field.key}`);
        existing[field.key] = el?.value?.trim() || "";
      });

      const computed = computePerformanceFromProcess(asIsSteps, toBeSteps, existing);
      TASK_STAT_FIELDS.forEach((field) => {
        const el = document.getElementById(`${prefix}stat-${field.key}`);
        if (!el || el.disabled) return;
        // 연간 빈도·연간 절감·FTE는 산식 결과를 항상 반영(읽기 전용 산출값)
        if (alwaysOverwrite.has(field.key)) {
          if (!Object.prototype.hasOwnProperty.call(computed, field.key)) return;
          const next = computed[field.key];
          el.value = next === "" || next == null ? "" : field.numeric ? formatThousands(String(next)) : String(next);
          return;
        }
        if (el.readOnly) return;
        if (String(el.value || "").trim() !== "") return;
        const next = computed[field.key];
        if (next == null || next === "") return;
        el.value = field.numeric ? formatThousands(String(next)) : String(next);
      });
    });
  }

  function remountProcessList(kind, steps) {
    const listId = kind === "tobe" ? "process-tobe-list" : "process-asis-list";
    const list = document.getElementById(listId);
    if (!list) return;
    const editable = list.dataset.editable !== "0";
    const next = Array.isArray(steps) ? steps : [];
    if (!next.length) {
      list.innerHTML = `<p class="helper process-empty">등록된 단계가 없습니다.${
        editable ? " 단계 추가를 눌러 입력하세요." : ""
      }</p>`;
    } else {
      list.innerHTML = next
        .map((step, index) => renderProcessStepCard(step, kind, index, next.length, editable))
        .join("");
    }
    refreshProcessPreview();
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
      next[field.key] = field.numeric
        ? parseNumericValue(document.getElementById(`${prefix}stat-${field.key}`)?.value || "")
        : document.getElementById(`${prefix}stat-${field.key}`)?.value.trim() || "";
    });
    return next;
  }

  function collectTaskMembers() {
    return [...document.querySelectorAll("#task-members .task-member-row")]
      .map((row) =>
        normalizeTaskMember(
          {
            name: row.querySelector(".task-member-name")?.value.trim() || "",
            role: row.querySelector(".task-member-role")?.value.trim() || "과제 담당자",
            email: row.querySelector(".task-member-email")?.value.trim() || "",
            position: row.querySelector(".task-member-position")?.value.trim() || "",
            isOwner: row.dataset.owner === "1"
          },
          row.dataset.owner === "1"
        )
      )
      .filter((m) => m.name);
  }

  function taskFormPrefix() {
    return state.modal === "addTask" ? "task-" : "detail-task-";
  }

  function resolveTaskSectionContext() {
    if (state.modal === "addTask") {
      const company = state.companies.find((c) => c.id === state.form.companyId) || currentCompany();
      const participant =
        company?.participants?.find((p) => p.id === state.form.participantId) || currentParticipant();
      return { mode: "add", company, participant };
    }
    return {
      mode: "detail",
      company: currentCompany(),
      participant: currentParticipant()
    };
  }

  function applyTaskBasicsFromDom(task, prefix) {
    const nameId = prefix === "task-" ? "task-name" : `${prefix}name`;
    const startId = prefix === "task-" ? "task-start" : `${prefix}start`;
    const endId = prefix === "task-" ? "task-end" : `${prefix}end`;
    const goalId = prefix === "task-" ? "task-goal" : `${prefix}goal`;
    const diffId = prefix === "task-" ? "task-difficulty" : `${prefix}difficulty`;
    const workId = prefix === "task-" ? "task-work-status" : `${prefix}work-status`;
    const name = document.getElementById(nameId)?.value.trim() || "";
    if (!name) return { ok: false, message: "과제명을 입력해 주세요." };
    task.name = name;
    task.startDate = document.getElementById(startId)?.value || "";
    task.endDate = document.getElementById(endId)?.value || "";
    task.goal = document.getElementById(goalId)?.value || "";
    task.difficulty = normalizeDifficulty(document.getElementById(diffId)?.value || task.difficulty || "중");
    task.workStatus = normalizeWorkStatus(document.getElementById(workId)?.value || task.workStatus || "개발");
    return { ok: true };
  }

  function ensureEditableTaskForSection(ctx) {
    if (!ctx.participant) return null;
    if (ctx.mode === "detail") {
      return ctx.participant.tasks.find((t) => t.id === state.form.taskId) || currentTask() || null;
    }
    let task = ctx.participant.tasks.find((t) => t.id === state.form.draftTaskId);
    if (task) return task;
    const name = document.getElementById("task-name")?.value.trim() || "";
    if (!name) {
      toast("과제명을 먼저 입력해 주세요.");
      return null;
    }
    task = ensureTaskFields({
      id: uid("t"),
      name,
      progress: 0,
      startDate: document.getElementById("task-start")?.value || "",
      endDate: document.getElementById("task-end")?.value || "",
      goal: document.getElementById("task-goal")?.value || "",
      asIsProcess: "",
      toBeProcess: "",
      difficulty: normalizeDifficulty(document.getElementById("task-difficulty")?.value || "중"),
      hierarchy: emptyHierarchy(),
      statistics: emptyStatistics(),
      members: collectTaskMembers().length
        ? collectTaskMembers()
        : defaultTaskMembers(ctx.participant),
      weeklySummary: "",
      weeklyDetail: "",
      weeklyIssues: "",
      nextWeekPlan: "",
      instructorFeedback: "",
      workStatus: document.getElementById("task-work-status")?.value || "개발",
      reportCompleted: false
    });
    ctx.participant.tasks.push(task);
    state.form.draftTaskId = task.id;
    state.selectedCompanyId = ctx.company?.id || state.selectedCompanyId;
    state.selectedParticipantId = ctx.participant.id;
    state.selectedTaskId = task.id;
    return task;
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
      <p class="helper" style="margin-top:0">${escapeHtml(participant?.name || "선택 참여자")}에게 과제를 등록합니다. CSV 업로드로 자동기입하거나 직접 입력할 수 있습니다. 섹션별 중간 저장 시 서버에 초안이 반영됩니다.</p>
      <section class="task-add-panel">
        <div class="section-title" style="margin-bottom:8px">
          <div>
            <h4 style="margin:0">기본 정보</h4>
            <p class="helper" style="margin:4px 0 0">과제명·일정·목표를 수정한 뒤 중간 저장할 수 있습니다.</p>
          </div>
          <button type="button" class="btn primary small btn-mid-save" data-action="save-task-section" data-section="basics">중간 저장</button>
        </div>
        <div class="field"><label>과제명 *</label><input id="task-name" placeholder="예: 데이터 품질 점검" value="${escapeHtml(draft.name || "")}" /></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label>시작일</label><input id="task-start" type="date" value="${escapeHtml(draft.startDate || "")}" /></div>
          <div class="field"><label>완료일</label><input id="task-end" type="date" value="${escapeHtml(draft.endDate || "")}" /></div>
        </div>
        <div class="field"><label>과제 목표</label><input id="task-goal" placeholder="달성하려는 과제 목표" value="${escapeHtml(draft.goal || "")}" /></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div class="field difficulty-field"><label>난이도</label>${difficultySelectHtml("task-difficulty", draft.difficulty || "중")}</div>
          <div class="field difficulty-field"><label>작업 상태</label>${workStatusSelectHtml("task-work-status", draft.workStatus || "개발")}</div>
        </div>
      </section>
      ${renderMembersFields(members, true, { midSave: true })}
      ${renderHierarchyFields("task-", draft.hierarchy, true, draft.projectName || "")}
      ${renderProcessEditor(draft.asIsProcess || "", draft.toBeProcess || "", true, { midSave: true })}
      ${renderFrequencyFields("task-", draft.statistics, true)}
      ${renderStatisticsFields("task-", draft.statistics, true)}
      <div class="process-flow-stack">
        <div id="task-asis-flow">${renderProcessFlow("As-Is (세로 흐름)", draft.asIsProcess || "", "vertical", "asis")}</div>
        <div id="task-tobe-flow">${renderProcessFlow("To-Be (세로 흐름)", draft.toBeProcess || "", "vertical", "tobe")}</div>
      </div>
      <p class="helper">중간 저장은 즉시 서버에 반영됩니다. 로그아웃 후 다시 들어가면 직전 저장 초안을 과제 상세에서 확인할 수 있습니다.</p>
      <div class="task-import-layout">
        <div class="field task-import-card">
          <label>CSV 업로드 (선택)</label>
          <input id="task-csv" type="file" accept=".csv,text/csv" data-action="task-csv-change" />
          <p class="helper">BPA 과제 export CSV(과제명·계층·참여자·프로세스·수행 빈도·성과 지표)를 지원합니다.</p>
          <div id="csv-preview" class="helper"></div>
        </div>
      </div>
    `,
      `
      <button class="btn ghost btn-compact" data-action="close-modal">취소</button>
      <button class="btn primary btn-compact" data-action="add-task">저장</button>
    `,
      true
    );
  }

  function refreshProcessPreview() {
    const asIsSteps = collectProcessSteps("asis", { keepEmpty: true });
    const toBeSteps = collectProcessSteps("tobe", { keepEmpty: true });
    const asIsFlow = document.getElementById("task-asis-flow");
    const toBeFlow = document.getElementById("task-tobe-flow");
    if (asIsFlow) asIsFlow.innerHTML = renderProcessFlow("As-Is (세로 흐름)", asIsSteps, "vertical", "asis");
    if (toBeFlow) toBeFlow.innerHTML = renderProcessFlow("To-Be (세로 흐름)", toBeSteps, "vertical", "tobe");
    const rawAsis = document.getElementById("process-raw-asis");
    const rawTobe = document.getElementById("process-raw-tobe");
    if (rawAsis) rawAsis.textContent = formatProcessFromSteps(collectProcessSteps("asis"), "asis");
    if (rawTobe) rawTobe.textContent = formatProcessFromSteps(collectProcessSteps("tobe"), "tobe");
    syncProcessTotalsToStatistics();
  }

  function applyTaskDraftToInputs(draft) {
    if (!draft) return;
    const mapping = [
      ["task-name", "name"],
      ["task-start", "startDate"],
      ["task-end", "endDate"],
      ["task-goal", "goal"]
    ];
    mapping.forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const nextValue = String(draft[key] || "").trim();
      if (!nextValue) return;
      input.value = nextValue;
    });

    const diffSelect = document.getElementById("task-difficulty");
    if (diffSelect) diffSelect.value = normalizeDifficulty(draft.difficulty);
    const workSelect = document.getElementById("task-work-status");
    if (workSelect) workSelect.value = normalizeWorkStatus(draft.workStatus);

    const hierarchy = normalizeHierarchy(draft.hierarchy);
    ["l1", "l2", "l3", "l4"].forEach((key) => {
      const input = document.getElementById(`task-h-${key}`);
      if (input && hierarchy[key]) input.value = hierarchy[key];
    });

    const statistics = normalizeStatistics(draft.statistics);
    TASK_STAT_FIELDS.forEach((field) => {
      const input = document.getElementById(`task-stat-${field.key}`);
      if (!input || !statistics[field.key]) return;
      input.value = field.numeric ? formatThousands(statistics[field.key]) : statistics[field.key];
    });

    const list = document.getElementById("task-members");
    if (list && Array.isArray(draft.members)) {
      const participant = state.form.participantId
        ? allParticipants().find((r) => r.participant.id === state.form.participantId)?.participant
        : currentParticipant();
      const members = mergeTaskMembers(defaultTaskMembers(participant), draft.members);
      list.innerHTML = members.map((m) => renderMemberRow(m, true)).join("");
    }

    if (draft.asIsProcess != null) {
      remountProcessList("asis", parseProcessFromText(draft.asIsProcess, "asis"));
    }
    if (draft.toBeProcess != null) {
      remountProcessList("tobe", parseProcessFromText(draft.toBeProcess, "tobe"));
    }
    applyProjectNameToInputs(draft, "task-");
    refreshProcessPreview();
  }

  function renderScheduleModal() {
    const company = ensureCompanyFields(
      state.companies.find((c) => c.id === state.form.companyId) || currentCompany()
    );
    const members = pmoMembersOf(company);
    const editRows = members.length ? members : [{ name: "", position: "", email: "" }];
    return modalShell(
      "일정 / PMO 편집",
      `
      <p class="helper" style="margin-top:0">${escapeHtml(company.name)}의 일정과 PMO 정보를 수정합니다. PMO 로그인은 이름과 이메일이 표의 행과 일치할 때 부여됩니다.</p>
      <div class="field"><label>시작일</label><input id="schedule-start" type="date" value="${company.schedule?.startDate || ""}" /></div>
      <div class="field"><label>KickOff</label><input id="schedule-kickoff" type="date" value="${company.schedule?.kickoffDate || ""}" /></div>
      <div class="field"><label>종료일</label><input id="schedule-end" type="date" value="${company.schedule?.endDate || ""}" /></div>
      <div class="field">
        <label>PMO</label>
        <div class="table-scroll">
          <table class="pmo-edit-table">
            <thead>
              <tr><th>이름</th><th>직위</th><th>이메일</th><th></th></tr>
            </thead>
            <tbody id="pmo-rows">
              ${editRows.map((row) => renderPmoEditRow(row)).join("")}
            </tbody>
          </table>
        </div>
        <button type="button" class="btn ghost small" data-action="add-pmo-row" style="margin-top:8px">행 추가</button>
      </div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="save-schedule">저장</button>
    `,
      true
    );
  }

  function noticeTargetCompany() {
    const companyId = state.form.companyId || state.selectedCompanyId;
    return ensureCompanyFields(state.companies.find((c) => c.id === companyId) || currentCompany());
  }

  function renderNoticeDetailModal() {
    const company = noticeTargetCompany();
    const notice = (company?.notices || []).find((n) => n.id === state.form.noticeId);
    if (!notice) {
      return modalShell(
        "공지사항",
        '<div class="empty">공지를 찾을 수 없습니다.</div>',
        `<button class="btn primary" data-action="close-modal">닫기</button>`
      );
    }
    const manage = canManageNotices(company)
      ? `<button class="btn ghost" data-action="open-edit-notice" data-company="${company.id}" data-notice="${notice.id}">수정</button>
      <button class="btn ghost danger" data-action="delete-notice" data-company="${company.id}" data-notice="${notice.id}">삭제</button>`
      : "";
    return modalShell(
      escapeHtml(notice.title),
      `
      <p class="person-meta" style="margin-top:0">${formatDateTime(notice.createdAt)}</p>
      <p class="notice-detail-body">${escapeHtml(notice.content)}</p>
    `,
      `${manage}<button class="btn primary" data-action="ack-notice" data-notice="${notice.id}">확인</button>`
    );
  }

  function renderAddNoticeModal() {
    const company = noticeTargetCompany();
    const existing = (company?.notices || []).find((n) => n.id === state.form.noticeId) || null;
    const editing = Boolean(existing);
    return modalShell(
      editing ? "공지사항 수정" : "공지사항 등록",
      `
      <p class="helper" style="margin-top:0">${escapeHtml(company?.name || "선택 협력사")} 참여자에게만 표시됩니다.</p>
      <div class="field"><label>제목</label><input id="notice-title" placeholder="공지 제목" value="${escapeHtml(existing?.title || "")}" /></div>
      <div class="field"><label>내용</label><textarea id="notice-content" placeholder="공지 내용을 입력하세요">${escapeHtml(existing?.content || "")}</textarea></div>
    `,
      `
      <button class="btn ghost" data-action="close-modal">취소</button>
      <button class="btn primary" data-action="save-notice">${editing ? "저장" : "등록"}</button>
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
      <section class="task-add-panel">
        <div class="section-title" style="margin-bottom:8px">
          <div>
            <h4 style="margin:0">기본 정보</h4>
            <p class="helper" style="margin:4px 0 0">과제명·일정·목표를 수정한 뒤 중간 저장할 수 있습니다.</p>
          </div>
          ${
            editable
              ? '<button type="button" class="btn primary small btn-mid-save" data-action="save-task-section" data-section="basics">중간 저장</button>'
              : ""
          }
        </div>
        <div class="field"><label>과제명</label><input id="detail-task-name" value="${escapeHtml(task.name)}" ${editable ? "" : "readonly class='readonly'"} /></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label>시작일</label><input id="detail-task-start" type="date" value="${escapeHtml(task.startDate || "")}" ${editable ? "" : "readonly class='readonly'"} /></div>
          <div class="field"><label>완료일</label><input id="detail-task-end" type="date" value="${escapeHtml(task.endDate || "")}" ${editable ? "" : "readonly class='readonly'"} /></div>
        </div>
        <div class="field"><label>과제 목표</label><input id="detail-task-goal" value="${escapeHtml(task.goal || "")}" ${editable ? "" : "readonly class='readonly'"} placeholder="달성하려는 과제 목표" /></div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div class="field difficulty-field"><label>난이도</label>${difficultySelectHtml("detail-task-difficulty", task.difficulty, !editable)}</div>
          <div class="field difficulty-field"><label>작업 상태</label>${workStatusSelectHtml("detail-task-work-status", task.workStatus || "개발", !editable)}</div>
        </div>
      </section>
      ${renderMembersFields(members, editable, { midSave: true })}
      ${renderHierarchyFields("detail-task-", task.hierarchy, editable, task.projectName || "")}
      ${renderProcessEditor(task.asIsProcess || "", task.toBeProcess || "", editable, { midSave: true })}
      ${renderFrequencyFields("detail-task-", task.statistics, editable)}
      ${renderStatisticsFields("detail-task-", task.statistics, editable)}
      <div class="process-flow-stack">
        <div id="task-asis-flow">${renderProcessFlow("As-Is (세로 흐름)", task.asIsProcess, "vertical", "asis")}</div>
        <div id="task-tobe-flow">${renderProcessFlow("To-Be (세로 흐름)", task.toBeProcess, "vertical", "tobe")}</div>
      </div>
      <p class="helper">섹션별 중간 저장은 즉시 서버에 반영됩니다. 로그아웃 후 다시 들어가면 직전 저장 내용이 불러와집니다.</p>
    `,
      `
      <button class="btn ghost" data-action="close-modal">닫기</button>
      ${editable ? '<button class="btn primary" data-action="save-task-detail">전체 저장</button>' : ""}
    `,
      true
    );
  }

  function renderReportModal() {
    const company = currentCompany();
    const doc = state.form.reportDoc;
    if (!company) {
      return modalShell("주간 레포트", '<div class="empty">협력사를 선택해 주세요.</div>', `<button class="btn primary" data-action="close-modal">닫기</button>`);
    }
    if (!doc) {
      return modalShell(
        "주간 레포트 작성",
        '<div class="empty">레포트 초안을 불러오는 중입니다...</div>',
        `<button class="btn ghost" data-action="close-modal">취소</button>`,
        "report"
      );
    }
    const published = doc.status === "published" && !state.form.reportRevising;
    const foot = published
      ? `
        <button class="btn ghost" data-action="close-modal">닫기</button>
        <button class="btn ghost" data-action="revise-report">초안 수정</button>
        <button class="btn primary" data-action="reprint-report">PDF 재출력</button>
      `
      : `
        <button class="btn ghost" data-action="close-modal">취소</button>
        <button class="btn ghost" data-action="assemble-report">빈 항목 다시 가져오기</button>
        <button class="btn ghost" data-action="save-report-draft">초안 저장</button>
        <button class="btn primary" data-action="publish-report">PDF 발행</button>
      `;
    return modalShell(
      `${escapeHtml(company.name)} 주간 레포트`,
      renderWeeklyReportEditorHtml(doc, {
        currentWeek: state.form.reportCurrentWeek || currentWeekNumber(company),
        revising: Boolean(state.form.reportRevising)
      }),
      foot,
      "report"
    );
  }

  async function loadCompanyWeeklyReport(weekNumber) {
    const company = currentCompany();
    if (!company) return null;
    const week = Number(weekNumber || currentWeekNumber(company));
    const result = await API.getCompanyWeeklyReport(company.id, week);
    state.form.reportDoc = result.report;
    state.form.reportDoc.saved = result.saved;
    state.form.reportCurrentWeek = result.currentWeek || currentWeekNumber(company);
    state.form.reportRevising = false;
    return result.report;
  }

  function currentReportFilename(company, doc) {
    return `주간레포트_${company?.name || "협력사"}_${doc?.weekNumber || ""}주차.pdf`.replace(/[\\/:*?"<>|]/g, "_");
  }

  function render() {
    if (state.loading) {
      app.innerHTML = '<div class="empty" style="margin:48px auto; max-width:420px">데이터를 불러오는 중입니다...</div>';
      return;
    }
    if (!state.auth) renderLogin();
    else renderShell();
    saveSession();
    if (document.getElementById("process-asis-list") || document.getElementById("process-tobe-list")) {
      refreshProcessPreview();
    }
  }

  // 브라우저가 유휴 탭을 정리·재로드해도 같은 탭에서는 로그인 상태가 유지되도록 sessionStorage에 보관한다.
  const SESSION_STORAGE_KEY = "ax-dashboard-session";

  function saveSession() {
    try {
      if (!state.auth) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        API.setToken("");
        return;
      }
      API.setToken(state.auth.token || "");
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          auth: state.auth,
          view: state.view,
          selectedCompanyId: state.selectedCompanyId,
          selectedParticipantId: state.selectedParticipantId,
          selectedTaskId: state.selectedTaskId
        })
      );
    } catch {
      /* 저장소 사용 불가(사생활 보호 모드 등) 시 메모리 상태만 사용 */
    }
  }

  function restoreSession() {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    } catch {
      saved = null;
    }
    const auth = saved?.auth;
    if (!auth?.role || !auth.token) return false;
    const company = state.companies.find((c) => c.id === auth.companyId);
    if (auth.role === "participant") {
      if (!company?.participants.some((p) => p.id === auth.participantId)) return false;
    } else if (auth.role === "pmo") {
      if (!company) return false;
    } else if (auth.role !== "admin") {
      return false;
    }
    state.auth = auth;
    const view = saved.view || (auth.role === "admin" ? "admin" : "company");
    state.view = view === "admin" && auth.role !== "admin" ? "company" : view;
    if (saved.selectedCompanyId && state.companies.some((c) => c.id === saved.selectedCompanyId)) {
      state.selectedCompanyId = saved.selectedCompanyId;
    }
    if (saved.selectedParticipantId) state.selectedParticipantId = saved.selectedParticipantId;
    if (saved.selectedTaskId) state.selectedTaskId = saved.selectedTaskId;
    lockToOwnParticipant();
    return true;
  }

  function applyDashboardData(data) {
    state.hubCompanies = (data.hubCompanies || []).map(c => ensureCompanyFields(c));
    state.companies = (data.companies || []).map((c) => ensureCompanyFields(c));
    state.companies.forEach((c) =>
      c.participants.forEach((p) => p.tasks.forEach((t) => ensureTaskFields(t)))
    );
    state.meta = data.meta || {};
    state.lastLocalSaveAt = state.meta.lastSavedAt || null;
    state.baseline = snapshotDashboard(state.companies);
  }

  async function reloadDashboardData() {
    saveSeq += 1;
    const data = await API.getDashboard();
    applyDashboardData(data);
    return data;
  }

  async function loadPublicCompanies() {
    const data=await API.getCompanies();
    applyDashboardData({companies:(data.companies || []).map(c => ({...c,participants:[]})),meta:{}});
  }
  async function bootstrap() {
    try {
      let saved=null;
      try { saved=JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null'); } catch {}
      if (saved?.auth?.token) {
        API.setToken(saved.auth.token);
        try {
          const auth=await API.session(); state.auth=auth; API.setToken(auth.token);
          sessionStorage.setItem(SESSION_STORAGE_KEY,JSON.stringify({...saved,auth}));
          await reloadDashboardData(); restoreSession();
        } catch (err) { if (![401,403].includes(err.status)) throw err; state.auth=null; API.setToken(''); }
      }
      if (!state.auth) { await loadPublicCompanies(); state.view='login'; }
      state.loading=false; render(); maybeShowParticipantUpdatePopup();
    } catch (err) {
      state.loading=false;
      app.innerHTML='<div class="empty" style="margin:48px auto; max-width:480px">데이터를 불러오지 못했습니다.<br />'+escapeHtml(err.message)+'<br /><button class="btn primary" onclick="location.reload()">다시 시도</button></div>';
    }
  }

  document.addEventListener("click", async (event) => {
    const stop = event.target.closest("[data-stop]");
    if (stop) event.stopPropagation();
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (state.saving && /^(save-|add-|delete-)/.test(action)) return;

    if (action === "login-tab") {
      state.loginTab = el.dataset.tab;
      render();
    }

    if (action === "admin-login") {
      const password = document.getElementById("admin-password").value;
      try {
        const auth = await API.adminLogin(password);
        state.auth = auth;
        API.setToken(auth.token);
        await reloadDashboardData();
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
        API.setToken(auth.token);
        await reloadDashboardData();
        state.selectedCompanyId = auth.companyId;
        state.selectedParticipantId = auth.participantId;
        state.view = "company";
        toast(auth.role === "pmo" ? "PMO 모드로 로그인했습니다." : "참여자 모드로 로그인했습니다.");
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
        state.auth = auth;
        API.setToken(auth.token);
        await reloadDashboardData();
        state.selectedCompanyId = auth.companyId;
        state.selectedParticipantId = auth.participantId;
        state.view = "personal";
        toast("신규 참여자로 등록했습니다.");
        render();
      } catch (err) {
        document.getElementById("login-error").textContent = err.message;
      }
    }

    if (action === "refresh-dashboard") {
      if (el.disabled) return;
      el.disabled = true;
      el.textContent = "업데이트 중...";
      try {
        await reloadDashboardData();
        render();
        maybeShowParticipantUpdatePopup();
        const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        toast(`최신 데이터를 불러왔습니다. (${time})`);
      } catch (err) {
        el.disabled = false;
        el.textContent = "업데이트";
        toast(err.message || "최신 데이터를 불러오지 못했습니다.");
      }
    }

    if (action === "logout") {
      state.auth = null;
      state.view = "login";
      API.setToken("");
      await loadPublicCompanies();
      toast("로그아웃했습니다.");
      render();
    }

    if (action === "add-pmo-row") {
      const list = document.getElementById("pmo-rows");
      if (!list) return;
      list.insertAdjacentHTML("beforeend", renderPmoEditRow());
    }

    if (action === "remove-pmo-row") {
      const row = el.closest(".pmo-edit-row");
      const list = document.getElementById("pmo-rows");
      if (!row || !list) return;
      row.remove();
      if (!list.querySelector(".pmo-edit-row")) {
        list.insertAdjacentHTML("beforeend", renderPmoEditRow());
      }
    }

    if (action === "add-task-member") {
      const list = document.getElementById("task-members");
      if (!list) return;
      list.insertAdjacentHTML(
        "beforeend",
        renderMemberRow({ name: "", role: "과제 담당자", email: "", position: "", isOwner: false }, true)
      );
    }

    if (action === "remove-task-member") {
      const row = el.closest(".task-member-row");
      if (!row) return;
      if (row.dataset.owner === "1") return toast("접속자(기본 참여자)는 삭제할 수 없습니다.");
      row.remove();
    }

    if (action === "add-process-step") {
      const kind = el.dataset.kind === "tobe" ? "tobe" : "asis";
      const steps = collectProcessSteps(kind, { keepEmpty: true });
      steps.push(emptyProcessStep(kind, steps.length + 1));
      remountProcessList(kind, steps);
    }

    if (action === "remove-process-step") {
      const card = el.closest(".process-step-card");
      if (!card) return;
      const kind = card.dataset.kind === "tobe" ? "tobe" : "asis";
      const index = Number(card.dataset.index);
      const steps = collectProcessSteps(kind, { keepEmpty: true });
      if (!Number.isFinite(index) || index < 0 || index >= steps.length) return;
      steps.splice(index, 1);
      remountProcessList(kind, steps);
    }

    if (action === "move-process-step") {
      const card = el.closest(".process-step-card");
      if (!card) return;
      const kind = card.dataset.kind === "tobe" ? "tobe" : "asis";
      const index = Number(card.dataset.index);
      const steps = collectProcessSteps(kind, { keepEmpty: true });
      const nextIndex = el.dataset.dir === "up" ? index - 1 : index + 1;
      if (!Number.isFinite(index) || nextIndex < 0 || nextIndex >= steps.length) return;
      const tmp = steps[index];
      steps[index] = steps[nextIndex];
      steps[nextIndex] = tmp;
      remountProcessList(kind, steps);
    }

    if (action === "copy-asis-to-tobe") {
      const asIs = collectProcessSteps("asis", { keepEmpty: true });
      const toBe = collectProcessSteps("tobe", { keepEmpty: true });
      const toBeHasContent = toBe.some(
        (step) => step.name || step.tool || step.method || step.execution_time
      );
      if (
        toBeHasContent &&
        !window.confirm("To-Be에 이미 내용이 있습니다. As-Is로 덮어쓸까요?")
      ) {
        return;
      }
      const copied = asIs
        .filter((step) => step.name || step.tool || step.method || step.execution_time)
        .map((step, index) => ({
          ...emptyProcessStep("tobe", index + 1),
          name: step.name,
          method: step.method,
          tool: step.tool,
          execution_time: step.execution_time,
          estimated_execution_time: step.execution_time,
          difficulty: "중"
        }));
      remountProcessList("tobe", copied);
    }

    if (action === "nav") setView(el.dataset.view);
    if (action === "open-add-company") openModal("addCompany");
    if (action === 'open-add-participant') {
      if (!canManageHubParticipants()) return toast('참여자 관리 권한이 없습니다.');
      openModal('addParticipant',{companyId:currentCompany().id});
    }
    if (action === 'edit-participant') {
      const company=state.companies.find(c => c.id === el.dataset.company);
      if (!canEditParticipantProfile(company,company?.participants.find(p => p.id === el.dataset.participant))) return toast('참여자 수정 권한이 없습니다.');
      openModal('editParticipant',{companyId:company.id,participantId:el.dataset.participant});
    }
    if (action === "open-report") {
      if (!isAdmin()) return toast("관리자만 레포트를 발행할 수 있습니다.");
      const company = currentCompany();
      if (!company) return toast("협력사를 선택해 주세요.");
      openModal("report", { reportDoc: null, reportRevising: false });
      try {
        await loadCompanyWeeklyReport(currentWeekNumber(company));
        render();
      } catch (err) {
        toast(err.message || "레포트 초안을 불러오지 못했습니다.");
      }
    }
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
      state.form.draftTaskId = null;
      state.form.taskMembers = defaultTaskMembers(target);
      openModal("addTask", { companyId: el.dataset.company, participantId: el.dataset.participant });
    }
    if (action === "open-add-notice") {
      const companyId = el.dataset.company || state.selectedCompanyId;
      const company = ensureCompanyFields(state.companies.find((c) => c.id === companyId) || currentCompany());
      if (!canManageNotices(company)) return toast("소속 협력사 공지만 등록할 수 있습니다.");
      openModal("addNotice", { companyId: company.id, noticeId: null });
    }
    if (action === "open-edit-notice") {
      const companyId = el.dataset.company || state.form.companyId || state.selectedCompanyId;
      const company = ensureCompanyFields(state.companies.find((c) => c.id === companyId) || currentCompany());
      const notice = (company?.notices || []).find((n) => n.id === el.dataset.notice);
      if (!company || !notice) return toast("공지를 찾을 수 없습니다.");
      if (!canManageNotices(company)) return toast("소속 협력사 공지만 수정할 수 있습니다.");
      openModal("addNotice", { companyId: company.id, noticeId: notice.id });
    }
    if (action === "delete-notice") {
      const companyId = el.dataset.company || state.form.companyId || state.selectedCompanyId;
      const company = ensureCompanyFields(state.companies.find((c) => c.id === companyId) || currentCompany());
      const notice = (company?.notices || []).find((n) => n.id === el.dataset.notice);
      if (!company || !notice) return toast("공지를 찾을 수 없습니다.");
      if (!canManageNotices(company)) return toast("소속 협력사 공지만 삭제할 수 있습니다.");
      const okConfirm = window.confirm(`"${notice.title}" 공지를 삭제할까요?\nDB에도 반영됩니다.`);
      if (!okConfirm) return;
      company.notices = (company.notices || []).filter((n) => n.id !== notice.id);
      if (state.modal) closeModal();
      await persist("공지사항을 삭제했습니다.");
      render();
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
      if (!canManageHubParticipants(state.companies.find(c => c.id === el.dataset.company) || currentCompany())) return toast("참여자 관리 권한이 없습니다.");
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
      openModal("noticeDetail", {
        noticeId: el.dataset.notice,
        companyId: el.dataset.company || state.selectedCompanyId
      });
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
      const target = allParticipants().find((row) => row.participant.id === el.dataset.participant)?.participant;
      if (!canViewParticipant(target)) {
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
      if (await persist("참여자 업데이트 요청을 확인했습니다.")) closeModal();
    }

    if (action === "save-notice") {
      const company = noticeTargetCompany();
      if (!company || !canManageNotices(company)) return toast("소속 협력사 공지만 등록·수정할 수 있습니다.");
      const title = document.getElementById("notice-title")?.value.trim() || "";
      const content = document.getElementById("notice-content")?.value.trim() || "";
      if (!title || !content) return toast("제목과 내용을 입력해 주세요.");
      const existing = (company.notices || []).find((n) => n.id === state.form.noticeId);
      if (state.form.noticeId && !existing) return toast("공지를 찾을 수 없습니다.");
      if (existing) {
        existing.title = title;
        existing.content = content;
        existing.updatedAt = new Date().toISOString();
      } else {
        state.form.noticeId = uid("n");
        company.notices.push({
          id: state.form.noticeId,
          title,
          content,
          createdAt: new Date().toISOString()
        });
      }
      if (await persist(existing ? "공지사항을 수정했습니다." : "공지사항을 등록했습니다.")) closeModal();
    }

    if (action === "publish-report") {
      const company = currentCompany();
      if (!company) return toast("협력사를 선택해 주세요.");
      if (!isAdmin()) return toast("관리자만 레포트를 발행할 수 있습니다.");
      const doc = syncWeeklyReportFromDom(state.form.reportDoc);
      if (!doc) return toast("레포트 초안이 없습니다.");
      try {
        const result = await API.publishCompanyWeeklyReport(company.id, doc.weekNumber, doc);
        state.form.reportDoc = result.report;
        state.form.reportRevising = false;
        state.meta.lastReportRequestAt = result.requestedAt;
        const filename = await downloadWeeklyReportPdf(result.report, currentReportFilename(company, result.report));
        closeModal();
        toast(`PDF 레포트를 발행했습니다. (${filename})`);
      } catch (err) {
        toast(err.message || "PDF 발행에 실패했습니다.");
      }
    }

    if (action === "save-report-draft") {
      const company = currentCompany();
      const doc = syncWeeklyReportFromDom(state.form.reportDoc);
      if (!company || !doc) return toast("레포트 초안이 없습니다.");
      try {
        const result = await API.saveCompanyWeeklyReport(company.id, doc.weekNumber, doc);
        state.form.reportDoc = result.report;
        state.form.reportDoc.saved = true;
        render();
        toast("초안을 저장했습니다.");
      } catch (err) {
        toast(err.message || "초안 저장에 실패했습니다.");
      }
    }

    if (action === "assemble-report") {
      const company = currentCompany();
      const doc = syncWeeklyReportFromDom(state.form.reportDoc);
      if (!company || !doc) return toast("레포트 초안이 없습니다.");
      try {
        const result = await API.assembleCompanyWeeklyReport(company.id, doc.weekNumber, doc);
        state.form.reportDoc = result.report;
        state.form.reportRevising = true;
        render();
        toast("운영 요약을 최신 수치로 갱신하고, 비어 있는 항목만 과제 주간보고에서 채웠습니다.");
      } catch (err) {
        toast(err.message || "초안 재조립에 실패했습니다.");
      }
    }

    if (action === "reprint-report") {
      const company = currentCompany();
      const doc = state.form.reportDoc;
      if (!company || !doc) return toast("레포트가 없습니다.");
      try {
        const filename = await downloadWeeklyReportPdf(doc, currentReportFilename(company, doc));
        toast(`PDF를 다시 저장했습니다. (${filename})`);
      } catch (err) {
        toast(err.message || "PDF 재출력에 실패했습니다.");
      }
    }

    if (action === "revise-report") {
      if (!state.form.reportDoc) return;
      state.form.reportRevising = true;
      state.form.reportDoc.status = "draft";
      render();
      toast("초안 수정 모드입니다. 수정 후 다시 발행하세요.");
    }

    if (action === "regenerate-report-narrative") {
      const company = currentCompany();
      const doc = syncWeeklyReportFromDom(state.form.reportDoc);
      if (!company || !doc) return toast("레포트 초안이 없습니다.");
      const hasText = String(doc.body?.weekSummary || "").trim() || String(doc.body?.nextWeekPlan || "").trim();
      if (
        hasText &&
        !window.confirm("금주 요약과 차주 계획 초안을 각 과제의 주간보고 기준으로 다시 작성합니다. 현재 수정한 문장은 바뀝니다.")
      ) {
        return;
      }
      try {
        const result = await API.draftCompanyWeeklyNarrative(company.id, doc.weekNumber);
        doc.body.weekSummary = result.weekSummary || "";
        doc.body.nextWeekPlan = result.nextWeekPlan || "";
        doc.body.narrativeSource = result.narrativeSource || "compiled";
        render();
        toast(
          result.narrativeSource === "ai"
            ? "AI 초안을 다시 작성했습니다. 내용을 수정할 수 있습니다."
            : "AI 요약을 생성하지 못해 과제별 기본 초안을 표시했습니다."
        );
      } catch (err) {
        toast(err.message || "초안 작성에 실패했습니다.");
      }
    }

    if (action === 'save-personal' || action === 'save-feedback' || action === 'delete-personal-report') {
      const company=currentCompany(),participant=currentParticipant(),task=currentTask();
      if (!task) return toast('과제를 먼저 추가해 주세요.');
      if (!canManageParticipant(participant)) return toast('본인 보고서만 수정할 수 있습니다.');
      if (action === 'save-feedback' && !isAdmin()) return toast('관리자만 피드백을 수정할 수 있습니다.');
      const current=isViewingCurrentWeek(company),week=selectedWeekNumber(company);
      if (!current && !isAdmin()) return toast('과거 주차는 조회만 가능합니다.');
      if (action === 'delete-personal-report') {
        if (!window.confirm('선택한 주간보고를 삭제할까요? 과제는 유지됩니다.')) return;
        task.weeklyReports=task.weeklyReports.filter(r => Number(r.weekNumber)!==week);
        if (current) Object.assign(task,{weeklySummary:'',weeklyDetail:'',weeklyIssues:'',nextWeekPlan:'',reportCompleted:false});
        if (await persist('주간보고를 삭제했습니다.')) render();
        return;
      }
      const patch={...viewTaskReport(task,company),weeklySummary:(document.getElementById('weekly-summary')?.value || '').trim(),weeklyDetail:(document.getElementById('weekly-detail')?.value || '').trim(),weeklyIssues:(document.getElementById('weekly-issues')?.value || '').trim(),nextWeekPlan:(document.getElementById('task-next-plan')?.value || '').trim()};
      if (action === 'save-personal' && (!patch.weeklySummary || !patch.nextWeekPlan)) return window.alert('금주 진전과 차주 계획을 모두 입력한 뒤 저장해 주세요.');
      if (isAdmin()) patch.instructorFeedback=document.getElementById('task-feedback')?.value || '';
      const input=document.getElementById('report-progress');
      if (input) patch.progress=Math.min(100,Math.max(0,Number(input.value || 0)));
      if (action === 'save-personal') patch.reportCompleted=true;
      if (current) Object.assign(task,Object.fromEntries(Object.keys(taskReportPatch(task)).map(k => [k,patch[k]])));
      upsertTaskWeekSnapshot(task,week,patch);
      if (await persist(action === 'save-feedback' ? '피드백을 저장했습니다.' : '주간보고를 저장했습니다.')) render();
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
          pmo: { members: [] },
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

    if (action === 'add-participant') {
      const company=state.companies.find(c => c.id === state.form.companyId) || currentCompany();
      const editing=state.modal === 'editParticipant';
      const target=company?.participants.find(p => p.id === state.form.participantId);
      if (editing ? !canEditParticipantProfile(company,target) : !canManageHubParticipants(company)) return toast('참여자 관리 권한이 없습니다.');
      const name=document.getElementById('new-name').value.trim();
      const email=document.getElementById('new-email').value.trim().toLowerCase();
      const dept=document.getElementById('new-dept').value.trim();
      if (!name || !email || !dept) return toast('이름, 이메일, 부서를 모두 입력해 주세요.');
      const p=company.participants.find(p => p.id === (state.modal === 'editParticipant' ? state.form.participantId : state.form.pendingParticipantId));
      if (p) Object.assign(p,{name,email,dept});
      else { const id=uid('p'); state.form.pendingParticipantId=id; company.participants.push({id,name,email,dept,status:'정상',summary:'',nextWeekPlan:'',instructorMemo:'',tasks:[]}); }
      if (await persist(p ? '참여자를 수정했습니다.' : '참여자를 등록했습니다.')) closeModal();
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
        csvTasks.forEach((row, index) => {
          const pendingId=state.form.pendingTaskIds?.[index];
          const pending=participant.tasks.find(t => t.id === pendingId);
          if (pending) { created.push(pending); return; }
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
            weeklyDetail: "",
            weeklyIssues: "",
            nextWeekPlan: "",
            instructorFeedback: "",
            workStatus: row.workStatus || "개발",
            projectName: row.projectName || "",
            bdwSummary: row.bdwSummary || "",
            bdwDetail: row.bdwDetail || "",
            aiFit: row.aiFit || "",
            asIsProcessDetail: row.asIsProcessDetail || "",
            reportCompleted: false
          });
          participant.tasks.push(task);
          created.push(task);
        });
      } else {
        const taskName = document.getElementById("task-name")?.value.trim() || "";
        if (!taskName) return toast("과제명을 입력하거나 CSV를 업로드해 주세요.");
        let task = participant.tasks.find((t) => t.id === state.form.draftTaskId);
        if (task) {
          task.name = taskName;
          task.startDate = document.getElementById("task-start")?.value || "";
          task.endDate = document.getElementById("task-end")?.value || "";
          task.goal = document.getElementById("task-goal")?.value || "";
          task.asIsProcess = collectProcessText("asis");
          task.toBeProcess = collectProcessText("tobe");
          task.difficulty = normalizeDifficulty(document.getElementById("task-difficulty")?.value || "중");
          task.hierarchy = collectHierarchy("task-");
          task.statistics = collectStatistics("task-");
          task.members = collectTaskMembers();
          task.workStatus = document.getElementById("task-work-status")?.value || "개발";
          applyProjectNameToTask(task, "task-");
          ensureTaskFields(task);
        } else {
          task = ensureTaskFields({
            id: uid("t"),
            name: taskName,
            progress: 0,
            startDate: document.getElementById("task-start")?.value || "",
            endDate: document.getElementById("task-end")?.value || "",
            goal: document.getElementById("task-goal")?.value || "",
            asIsProcess: collectProcessText("asis"),
            toBeProcess: collectProcessText("tobe"),
            difficulty: normalizeDifficulty(document.getElementById("task-difficulty")?.value || "중"),
            hierarchy: collectHierarchy("task-"),
            statistics: collectStatistics("task-"),
            members: collectTaskMembers(),
            weeklySummary: "",
            weeklyDetail: "",
            weeklyIssues: "",
            nextWeekPlan: "",
            instructorFeedback: "",
            workStatus: document.getElementById("task-work-status")?.value || "개발",
            reportCompleted: false
          });
          applyProjectNameToTask(task, "task-");
          participant.tasks.push(task);
        }
        created.push(task);
      }

      state.selectedTaskId = created[0].id;
      state.selectedCompanyId = company.id;
      state.selectedParticipantId = participant.id;
      state.form.draftTaskId = created[0].id;
      state.form.pendingTaskIds = created.map(t => t.id);
      if (await persist(created.length > 1 ? `과제 ${created.length}건을 추가했습니다.` : '과제를 추가했습니다.')) {
        state.form.csvTasks = null;
        state.form.draftTaskId = null;
        state.form.pendingTaskIds = null;
        closeModal();
      }
    }

    if (action === "save-task-section") {
      const ctx = resolveTaskSectionContext();
      if (!canManageParticipant(ctx.participant)) {
        return toast("본인 과제만 수정할 수 있습니다.");
      }
      const task = ensureEditableTaskForSection(ctx);
      if (!task) return;
      const section = el.dataset.section;
      const prefix = taskFormPrefix();

      if (section === "basics") {
        const applied = applyTaskBasicsFromDom(task, prefix);
        if (!applied.ok) return toast(applied.message);
        await persist("기본 정보를 중간 저장했습니다.");
        return;
      }

      if (section === "process") {
        syncProcessTotalsToStatistics();
        task.asIsProcess = collectProcessText("asis");
        task.toBeProcess = collectProcessText("tobe");
        task.statistics = collectStatistics(prefix);
        applyProjectNameToTask(task, prefix);
        await persist("프로세스 설계를 중간 저장했습니다.");
        return;
      }

      if (section === "members") {
        const members = collectTaskMembers();
        if (!members.length) return toast("참여자를 한 명 이상 입력해 주세요.");
        task.members = members;
        await persist("참여자를 중간 저장했습니다.");
        return;
      }

      return toast("알 수 없는 저장 구간입니다.");
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
      task.asIsProcess = collectProcessText("asis");
      task.toBeProcess = collectProcessText("tobe");
      task.difficulty = normalizeDifficulty(document.getElementById("detail-task-difficulty")?.value || task.difficulty);
      task.workStatus = normalizeWorkStatus(document.getElementById("detail-task-work-status")?.value || task.workStatus);
      task.hierarchy = collectHierarchy("detail-task-");
      applyProjectNameToTask(task, "detail-task-");
      task.statistics = collectStatistics("detail-task-");
      task.members = collectTaskMembers();
      if (await persist("과제 상세를 저장했습니다.")) closeModal();
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
      const members = [...document.querySelectorAll("#pmo-rows .pmo-edit-row")]
        .map((row) => ({
          name: row.querySelector(".pmo-name")?.value.trim() || "",
          position: row.querySelector(".pmo-position")?.value.trim() || "",
          email: row.querySelector(".pmo-email")?.value.trim() || ""
        }))
        .filter((row) => row.name || row.position || row.email);
      if (members.some((row) => !row.name || !row.email)) {
        return toast("PMO는 이름과 이메일을 함께 입력해 주세요.");
      }
      const emails = members.map((row) => row.email.toLowerCase());
      if (new Set(emails).size !== emails.length) {
        return toast("같은 이메일의 PMO가 두 번 입력되었습니다.");
      }
      company.pmo = { members };
      if (await persist("협력사 일정과 PMO 정보를 저장했습니다.")) closeModal();
    }
  });

  let progressSaveTimer = null;

  document.addEventListener("input", (event) => {
    if (event.target.closest("[data-report-field]") && state.form.reportDoc) {
      const field = event.target.dataset.reportField;
      syncWeeklyReportFromDom(state.form.reportDoc);
      if (
        (field === "body.weekSummary" || field === "body.nextWeekPlan") &&
        state.form.reportDoc.body
      ) {
        state.form.reportDoc.body.narrativeSource = "edited";
      }
      const preview = document.querySelector(".report-pdf-preview");
      if (preview) preview.innerHTML = renderWeeklyReportPdfHtml(state.form.reportDoc);
    }

    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "preview-process") {
      refreshProcessPreview();
    }

    if (action === "format-stat" || action === "recalc-stats") {
      syncProcessTotalsToStatistics();
    }

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
      const taskId = task.id;
      const progress = task.progress;
      progressSaveTimer = setTimeout(async () => {
        const latest = currentParticipant()?.tasks.find((t) => t.id === taskId);
        if (!latest) return;
        latest.progress = progress;
        upsertTaskWeekSnapshot(latest, currentWeekNumber(), taskReportPatch(latest));
        await persist("진척도를 저장했습니다.");
      }, 400);
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.closest("[data-report-field]") && state.form.reportDoc) {
      const field = event.target.dataset.reportField;
      syncWeeklyReportFromDom(state.form.reportDoc);
      if (
        (field === "body.weekSummary" || field === "body.nextWeekPlan") &&
        state.form.reportDoc.body
      ) {
        state.form.reportDoc.body.narrativeSource = "edited";
      }
      const preview = document.querySelector(".report-pdf-preview");
      if (preview) preview.innerHTML = renderWeeklyReportPdfHtml(state.form.reportDoc);
    }

    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "preview-process") {
      refreshProcessPreview();
    }

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

    if (action === "change-company-report-week") {
      const week = Number(el.value);
      const company = currentCompany();
      const doc = syncWeeklyReportFromDom(state.form.reportDoc);
      try {
        if (company && doc && Number(doc.weekNumber) !== week && doc.status !== "published") {
          await API.saveCompanyWeeklyReport(company.id, doc.weekNumber, doc);
        }
        await loadCompanyWeeklyReport(week);
        render();
      } catch (err) {
        toast(err.message || "해당 주차 레포트를 불러오지 못했습니다.");
      }
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

    if (action === "format-stat") {
      el.value = formatThousands(parseNumericValue(el.value));
      syncProcessTotalsToStatistics();
    }

    if (action === "recalc-stats") {
      syncProcessTotalsToStatistics();
    }
  });

  bootstrap();
})();
