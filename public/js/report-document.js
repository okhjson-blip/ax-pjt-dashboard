function reportEscape(value) {
  return escapeHtml(String(value ?? ""));
}

function reportPeriodLabel(doc) {
  if (doc.periodStart && doc.periodEnd) return `${doc.periodStart} ~ ${doc.periodEnd}`;
  return doc.periodStart || doc.periodEnd || "";
}

function reportTaskPeriod(row) {
  if (row?.periodStart && row?.periodEnd) return `${row.periodStart} ~ ${row.periodEnd}`;
  return row?.periodStart || row?.periodEnd || "-";
}

function reportOpsView(doc) {
  const ops = doc?.body?.ops || {};
  const goal = ops.scheduleGoalRate == null || ops.scheduleGoalRate === "" ? 0 : Number(ops.scheduleGoalRate);
  return {
    taskCount: Number(ops.taskCount || 0),
    participantCount: Number(ops.participantCount || 0),
    progress: Number(ops.progress || 0),
    scheduleGoalRate: Number.isFinite(goal) ? Math.round(goal) : 0
  };
}

function reportRichText(value, emptyLabel) {
  const text = String(value || "").trim();
  if (!text) return `<p class="pdf-empty">${reportEscape(emptyLabel || "내용이 없습니다.")}</p>`;
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split(/\n/);
      const filled = lines.map((line) => line.trim()).filter(Boolean);
      const bullets = filled.length > 1 && filled.every((line) => /^[-•●]/.test(line));
      if (bullets) {
        return `<ul>${filled
          .map((line) => `<li>${reportEscape(line.replace(/^[-•●]\s*/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${lines.map((line) => reportEscape(line)).join("<br>")}</p>`;
    })
    .join("");
}

function reportNarrativeHint(doc, kind) {
  const source = doc?.body?.narrativeSource;
  const target = kind === "next" ? "차주 계획" : "금주 진전";
  if (source === "ai") {
    return `AI가 각 과제의 ${target}을 참고해 작성한 초안입니다. 내용을 수정할 수 있습니다.`;
  }
  return `각 과제의 ${target}을 참고해 작성한 초안입니다. 내용을 수정할 수 있습니다.`;
}

function renderWeeklyReportPdfHtml(doc) {
  const body = doc?.body || {};
  const ops = reportOpsView(doc);
  const taskRows = Array.isArray(body.taskRows) ? body.taskRows : [];
  const period = reportPeriodLabel(doc);

  const taskHtml = taskRows.length
    ? taskRows
        .map(
          (row) => `
            <tr>
              <td>${reportEscape(row.name)}</td>
              <td>${reportEscape(row.ownerName)}</td>
              <td>${reportEscape(row.dept)}</td>
              <td>${reportEscape(reportTaskPeriod(row))}</td>
              <td>${reportEscape(Number(row.progress || 0))}%</td>
              <td>${reportEscape(row.weeklyProgress)}</td>
              <td>${reportEscape(row.nextPlan)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="7">등록된 과제가 없습니다.</td></tr>`;

  return `
    <div class="pdf-report">
      <header class="pdf-head">
        <h1>${reportEscape(doc.title || "주간보고")}</h1>
        ${period ? `<p class="pdf-meta">기간 : ${reportEscape(period)}</p>` : ""}
      </header>

      <section>
        <h2>1. 협력사 운영 요약</h2>
        <table>
          <thead>
            <tr>
              <th>총 과제수</th>
              <th>총 참여자 수</th>
              <th>과제 진척도</th>
              <th>일정 목표 달성율</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${ops.taskCount}건</td>
              <td>${ops.participantCount}명</td>
              <td>${ops.progress}%</td>
              <td>${ops.scheduleGoalRate}%</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>2. 금주 요약</h2>
        ${reportRichText(body.weekSummary, "금주 요약이 없습니다.")}
      </section>

      <section>
        <h2>3. 차주 계획</h2>
        ${reportRichText(body.nextWeekPlan, "차주 계획이 없습니다.")}
      </section>

      <section>
        <h2>4. 과제별 진행 현황</h2>
        <table>
          <thead>
            <tr>
              <th>과제명</th>
              <th>담당자명</th>
              <th>부서명</th>
              <th>과제 기간</th>
              <th>진척도</th>
              <th>금주 진전</th>
              <th>차주 계획</th>
            </tr>
          </thead>
          <tbody>${taskHtml}</tbody>
        </table>
      </section>
    </div>
  `;
}

function renderWeeklyReportEditorHtml(doc, options = {}) {
  const published = doc.status === "published";
  const readonly = published && !options.revising;
  const lock = readonly ? "readonly class='readonly'" : "";
  const body = doc.body || {};
  const ops = reportOpsView(doc);
  const week = Number(doc.weekNumber || 1);
  const maxWeek = Math.max(1, Number(options.currentWeek || week));

  let weekOptions = "";
  for (let w = 1; w <= maxWeek; w += 1) {
    weekOptions += `<option value="${w}" ${w === week ? "selected" : ""}>${w}주차</option>`;
  }

  const taskRows = (body.taskRows || [])
    .map(
      (row, i) => `
        <tr>
          <td><input data-report-field="body.taskRows.${i}.name" value="${reportEscape(row.name)}" ${lock} /></td>
          <td><input data-report-field="body.taskRows.${i}.ownerName" value="${reportEscape(row.ownerName)}" ${lock} /></td>
          <td><input data-report-field="body.taskRows.${i}.dept" value="${reportEscape(row.dept)}" ${lock} /></td>
          <td>
            <input type="date" data-report-field="body.taskRows.${i}.periodStart" value="${reportEscape(row.periodStart)}" ${lock} />
            <input type="date" data-report-field="body.taskRows.${i}.periodEnd" value="${reportEscape(row.periodEnd)}" ${lock} />
          </td>
          <td><input type="number" min="0" max="100" data-report-field="body.taskRows.${i}.progress" value="${reportEscape(Number(row.progress || 0))}" ${lock} /></td>
          <td><textarea data-report-field="body.taskRows.${i}.weeklyProgress" ${lock}>${reportEscape(row.weeklyProgress)}</textarea></td>
          <td><textarea data-report-field="body.taskRows.${i}.nextPlan" ${lock}>${reportEscape(row.nextPlan)}</textarea></td>
        </tr>`
    )
    .join("");

  const statusLabel = published ? "발행됨" : doc.saved === false ? "미저장 초안" : "초안";

  return `
    <div class="report-workspace">
      <div class="grid" style="grid-template-columns: 140px 1fr; gap:10px">
        <div class="field">
          <label>주차</label>
          <select id="company-report-week" data-action="change-company-report-week">${weekOptions}</select>
        </div>
        <div class="field">
          <label>상태</label>
          <input value="${statusLabel}${doc.publishedAt ? ` · ${formatDateTime(doc.publishedAt)}` : ""}" readonly class="readonly" />
        </div>
      </div>
      <div class="field">
        <label>제목</label>
        <input data-report-field="title" value="${reportEscape(doc.title)}" ${lock} />
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr">
        <div class="field">
          <label>기간 시작</label>
          <input type="date" data-report-field="periodStart" value="${reportEscape(doc.periodStart)}" ${lock} />
        </div>
        <div class="field">
          <label>기간 종료</label>
          <input type="date" data-report-field="periodEnd" value="${reportEscape(doc.periodEnd)}" ${lock} />
        </div>
      </div>

      <div class="section-title">
        <div>
          <h3>1. 협력사 운영 요약</h3>
          <p>협력사 허브와 같은 기준으로 계산합니다. 총 과제수, 총 참여자 수, 과제 진척도, 일정 목표 달성율입니다.</p>
        </div>
      </div>
      <div class="grid stats report-ops-grid">
        <div class="card card-pad stat"><div class="stat-label">총 과제수</div><div class="stat-value">${ops.taskCount}건</div></div>
        <div class="card card-pad stat"><div class="stat-label">총 참여자 수</div><div class="stat-value">${ops.participantCount}명</div></div>
        <div class="card card-pad stat"><div class="stat-label">과제 진척도</div><div class="stat-value">${ops.progress}%</div></div>
        <div class="card card-pad stat"><div class="stat-label">일정 목표 달성율</div><div class="stat-value">${ops.scheduleGoalRate}%</div></div>
      </div>

      <div class="section-title">
        <div>
          <h3>2. 금주 요약</h3>
          <p>${reportNarrativeHint(doc, "week")}</p>
        </div>
        ${readonly ? "" : '<button type="button" class="btn ghost small" data-action="regenerate-report-narrative">AI 초안 다시 작성</button>'}
      </div>
      <div class="field report-narrative">
        <textarea data-report-field="body.weekSummary" ${lock}>${reportEscape(body.weekSummary || "")}</textarea>
      </div>

      <div class="section-title">
        <div>
          <h3>3. 차주 계획</h3>
          <p>${reportNarrativeHint(doc, "next")}</p>
        </div>
      </div>
      <div class="field report-narrative">
        <textarea data-report-field="body.nextWeekPlan" ${lock}>${reportEscape(body.nextWeekPlan || "")}</textarea>
      </div>

      <div class="section-title">
        <div>
          <h3>4. 과제별 진행 현황</h3>
          <p>과제명, 담당자명, 부서명, 과제 기간, 진척도, 금주 진전, 차주 계획</p>
        </div>
      </div>
      <div class="report-table-wrap">
        <table class="report-edit-table report-task-table">
          <thead>
            <tr>
              <th>과제명</th>
              <th>담당자명</th>
              <th>부서명</th>
              <th>과제 기간</th>
              <th>진척도</th>
              <th>금주 진전</th>
              <th>차주 계획</th>
            </tr>
          </thead>
          <tbody>${taskRows || `<tr><td colspan="7" class="helper">등록된 과제가 없습니다.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="section-title">
        <div>
          <h3>미리보기</h3>
          <p>발행 PDF와 같은 레이아웃입니다.</p>
        </div>
      </div>
      <div class="report-pdf-preview">${renderWeeklyReportPdfHtml(doc)}</div>
    </div>
  `;
}

function setReportPath(doc, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return doc;
  let cursor = doc;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = keys[i + 1];
    const asIndex = /^\d+$/.test(key);
    const nextIsIndex = /^\d+$/.test(next);
    if (asIndex) {
      const index = Number(key);
      if (!Array.isArray(cursor)) return doc;
      cursor[index] ??= nextIsIndex ? [] : {};
      cursor = cursor[index];
    } else {
      if (cursor[key] == null) cursor[key] = nextIsIndex ? [] : {};
      cursor = cursor[key];
    }
  }
  const last = keys[keys.length - 1];
  if (/^\d+$/.test(last) && Array.isArray(cursor)) cursor[Number(last)] = value;
  else cursor[last] = value;
  return doc;
}

function syncWeeklyReportFromDom(doc, root = document) {
  if (!doc) return doc;
  root.querySelectorAll("[data-report-field]").forEach((el) => {
    const path = el.dataset.reportField;
    if (!path) return;
    const value = el.type === "checkbox" ? el.checked : el.value;
    setReportPath(doc, path, value);
  });
  return doc;
}

async function downloadWeeklyReportPdf(doc, filename) {
  const name = String(filename || `주간레포트_${doc.weekNumber || ""}주차.pdf`).replace(/[\\/:*?"<>|]/g, "_");
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";
  wrapper.innerHTML = renderWeeklyReportPdfHtml(doc);
  document.body.appendChild(wrapper);
  const element = wrapper.querySelector(".pdf-report");
  // Match A4 printable width before html2pdf measures row/page boundaries.
  element.style.width = "186mm";
  try {
    if (typeof html2pdf === "undefined") {
      throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
    }
    if (document.fonts?.ready) await document.fonts.ready;
    await html2pdf()
      .set({
        margin: [12, 12, 14, 12],
        filename: name,
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'thead', 'p', 'li', 'h1', 'h2', 'h3', '.pdf-head'] },
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      })
      .from(element)
      .save();
    return name;
  } finally {
    wrapper.remove();
  }
}
