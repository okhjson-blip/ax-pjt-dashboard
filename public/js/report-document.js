const REPORT_SECTION_HEADINGS = ["구성", "진행", "이슈", "리뷰 방향", "차주"];

function reportEscape(value) {
  return escapeHtml(String(value ?? ""));
}

function reportPeriodLabel(doc) {
  if (doc.periodStart && doc.periodEnd) return `${doc.periodStart} ~ ${doc.periodEnd}`;
  return doc.periodStart || doc.periodEnd || "";
}

function emptyEditorSection() {
  return {
    taskId: "",
    title: "",
    owner: "",
    blocks: REPORT_SECTION_HEADINGS.map((heading) => ({ heading, text: "" }))
  };
}

function renderWeeklyReportPdfHtml(doc) {
  const body = doc?.body || {};
  const summaryRows = Array.isArray(body.summaryRows) ? body.summaryRows : [];
  const sections = Array.isArray(body.sections) ? body.sections : [];
  const issues = Array.isArray(body.issues) ? body.issues : [];
  const checks = Array.isArray(body.checks) ? body.checks : [];
  const period = reportPeriodLabel(doc);
  const place = [period, doc.location].filter(Boolean).join(" / ") || "-";

  const summaryHtml = summaryRows.length
    ? summaryRows
        .map(
          (row) => `
            <tr>
              <td>${reportEscape(row.deliverable)}</td>
              <td>${reportEscape(row.owner)}</td>
              <td>${reportEscape(row.status)}</td>
              <td>${reportEscape(row.progressNote)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4">등록된 산출물이 없습니다.</td></tr>`;

  const sectionHtml = sections.length
    ? sections
        .map((section, index) => {
          const blocks = Array.isArray(section.blocks) ? section.blocks : [];
          const blockHtml = blocks
            .filter((block) => String(block.text || "").trim())
            .map((block) => {
              const lines = String(block.text || "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
              const list =
                lines.length > 1
                  ? `<ul>${lines.map((line) => `<li>${reportEscape(line)}</li>`).join("")}</ul>`
                  : `<p>${reportEscape(lines[0] || "")}</p>`;
              return `<div class="pdf-block"><strong>${reportEscape(block.heading || "")}</strong>${list}</div>`;
            })
            .join("");
          return `
            <article class="pdf-deliverable">
              <h3>2-${index + 1}. ${reportEscape(section.title || "산출물")}${
                section.owner ? ` <span>(${reportEscape(section.owner)})</span>` : ""
              }</h3>
              ${blockHtml || "<p class='pdf-empty'>작성된 진행 내용이 없습니다.</p>"}
            </article>`;
        })
        .join("")
    : `<p class="pdf-empty">산출물별 진행 내용이 없습니다.</p>`;

  const issueHtml = issues.length
    ? issues
        .map(
          (row) => `
            <tr>
              <td>${reportEscape(row.item)}</td>
              <td>${reportEscape(row.content)}</td>
              <td>${reportEscape(row.status)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="3">등록된 공통 이슈가 없습니다.</td></tr>`;

  const checkHtml = checks.length
    ? `<ul class="pdf-checks">${checks
        .map((row) => `<li>${row.done ? "☑" : "☐"} ${reportEscape(row.text)}</li>`)
        .join("")}</ul>`
    : `<p class="pdf-empty">차주 확인사항이 없습니다.</p>`;

  return `
    <div class="pdf-report">
      <header class="pdf-head">
        <p class="pdf-kicker">${reportEscape(doc.subtitle || "주간보고")}</p>
        <h1>${reportEscape(doc.title || "주간보고")}</h1>
        <p class="pdf-meta">기간/장소 : ${reportEscape(place)}</p>
      </header>

      <section>
        <h2>1. 금주 요약</h2>
        <table>
          <thead>
            <tr>
              <th>산출물</th>
              <th>주체</th>
              <th>상태</th>
              <th>금주 진전</th>
            </tr>
          </thead>
          <tbody>${summaryHtml}</tbody>
        </table>
      </section>

      <section>
        <h2>2. 산출물별 진행현황</h2>
        ${sectionHtml}
      </section>

      <section>
        <h2>3. 공통 이슈</h2>
        <table>
          <thead>
            <tr>
              <th>항목</th>
              <th>내용</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>${issueHtml}</tbody>
        </table>
      </section>

      <section>
        <h2>4. 차주 확인사항</h2>
        ${checkHtml}
      </section>

      ${
        body.footerNote
          ? `<footer class="pdf-foot">${reportEscape(body.footerNote)}</footer>`
          : ""
      }
    </div>
  `;
}

function renderWeeklyReportEditorHtml(doc, options = {}) {
  const published = doc.status === "published";
  const readonly = published && !options.revising;
  const lock = readonly ? "readonly class='readonly'" : "";
  const body = doc.body || {};
  const week = Number(doc.weekNumber || 1);
  const maxWeek = Math.max(1, Number(options.currentWeek || week));

  let weekOptions = "";
  for (let w = 1; w <= maxWeek; w += 1) {
    weekOptions += `<option value="${w}" ${w === week ? "selected" : ""}>${w}주차</option>`;
  }

  const summaryRows = (body.summaryRows || [])
    .map(
      (row, i) => `
        <tr data-index="${i}">
          <td><input data-report-field="body.summaryRows.${i}.deliverable" value="${reportEscape(row.deliverable)}" ${lock} /></td>
          <td><input data-report-field="body.summaryRows.${i}.owner" value="${reportEscape(row.owner)}" ${lock} /></td>
          <td><input data-report-field="body.summaryRows.${i}.status" value="${reportEscape(row.status)}" ${lock} /></td>
          <td><textarea data-report-field="body.summaryRows.${i}.progressNote" ${lock}>${reportEscape(row.progressNote)}</textarea></td>
          <td>${readonly ? "" : `<button type="button" class="btn ghost small danger" data-action="report-remove-summary" data-index="${i}">삭제</button>`}</td>
        </tr>`
    )
    .join("");

  const sections = (body.sections || [])
    .map((section, i) => {
      const blocks = (section.blocks || [])
        .map(
          (block, b) => `
            <div class="field">
              <label>${reportEscape(block.heading || `항목 ${b + 1}`)}</label>
              <textarea data-report-field="body.sections.${i}.blocks.${b}.text" ${lock}>${reportEscape(block.text)}</textarea>
            </div>`
        )
        .join("");
      return `
        <article class="report-section-card">
          <div class="grid" style="grid-template-columns: 1.4fr 1fr auto; gap:10px; align-items:end">
            <div class="field" style="margin:0">
              <label>산출물 ${i + 1}</label>
              <input data-report-field="body.sections.${i}.title" value="${reportEscape(section.title)}" ${lock} />
            </div>
            <div class="field" style="margin:0">
              <label>주체</label>
              <input data-report-field="body.sections.${i}.owner" value="${reportEscape(section.owner)}" ${lock} />
            </div>
            ${readonly ? "" : `<button type="button" class="btn ghost small danger" data-action="report-remove-section" data-index="${i}">섹션 삭제</button>`}
          </div>
          ${blocks}
        </article>`;
    })
    .join("");

  const issues = (body.issues || [])
    .map(
      (row, i) => `
        <tr>
          <td><input data-report-field="body.issues.${i}.item" value="${reportEscape(row.item)}" ${lock} /></td>
          <td><textarea data-report-field="body.issues.${i}.content" ${lock}>${reportEscape(row.content)}</textarea></td>
          <td><input data-report-field="body.issues.${i}.status" value="${reportEscape(row.status)}" ${lock} /></td>
          <td>${readonly ? "" : `<button type="button" class="btn ghost small danger" data-action="report-remove-issue" data-index="${i}">삭제</button>`}</td>
        </tr>`
    )
    .join("");

  const checks = (body.checks || [])
    .map(
      (row, i) => `
        <label class="report-check-row">
          <input type="checkbox" data-report-field="body.checks.${i}.done" ${row.done ? "checked" : ""} ${readonly ? "disabled" : ""} />
          <input data-report-field="body.checks.${i}.text" value="${reportEscape(row.text)}" ${lock} />
          ${readonly ? "" : `<button type="button" class="btn ghost small danger" data-action="report-remove-check" data-index="${i}">삭제</button>`}
        </label>`
    )
    .join("");

  const statusLabel = published ? "발행됨" : doc.saved === false ? "미저장 초안" : "초안";

  return `
    <div class="report-workspace">
      <div class="grid" style="grid-template-columns: 140px 1fr 1fr; gap:10px">
        <div class="field">
          <label>주차</label>
          <select id="company-report-week" data-action="change-company-report-week">${weekOptions}</select>
        </div>
        <div class="field">
          <label>상태</label>
          <input value="${statusLabel}${doc.publishedAt ? ` · ${formatDateTime(doc.publishedAt)}` : ""}" readonly class="readonly" />
        </div>
        <div class="field">
          <label>장소</label>
          <input data-report-field="location" value="${reportEscape(doc.location)}" placeholder="현장/공장" ${lock} />
        </div>
      </div>
      <div class="field">
        <label>제목</label>
        <input data-report-field="title" value="${reportEscape(doc.title)}" ${lock} />
      </div>
      <div class="field">
        <label>부제</label>
        <input data-report-field="subtitle" value="${reportEscape(doc.subtitle)}" placeholder="예: 하노이 공장 현장방문 — AI 컨설팅 진행현황" ${lock} />
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
          <h3>1. 금주 요약</h3>
          <p>산출물 · 주체 · 상태 · 금주 진전</p>
        </div>
        ${readonly ? "" : '<button type="button" class="btn ghost small" data-action="report-add-summary">행 추가</button>'}
      </div>
      <div class="report-table-wrap">
        <table class="report-edit-table">
          <thead>
            <tr><th>산출물</th><th>주체</th><th>상태</th><th>금주 진전</th><th></th></tr>
          </thead>
          <tbody>${summaryRows || `<tr><td colspan="5" class="helper">행이 없습니다.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="section-title">
        <div>
          <h3>2. 산출물별 진행현황</h3>
          <p>구성 · 진행 · 이슈 · 리뷰 방향 · 차주</p>
        </div>
        ${readonly ? "" : '<button type="button" class="btn ghost small" data-action="report-add-section">섹션 추가</button>'}
      </div>
      ${sections || '<p class="helper">산출물 섹션이 없습니다.</p>'}

      <div class="section-title">
        <div>
          <h3>3. 공통 이슈</h3>
          <p>과제 횡단 이슈. 참여자 과제 이슈와 별도입니다.</p>
        </div>
        ${readonly ? "" : '<button type="button" class="btn ghost small" data-action="report-add-issue">이슈 추가</button>'}
      </div>
      <div class="report-table-wrap">
        <table class="report-edit-table">
          <thead>
            <tr><th>항목</th><th>내용</th><th>상태</th><th></th></tr>
          </thead>
          <tbody>${issues || `<tr><td colspan="4" class="helper">이슈가 없습니다.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="section-title">
        <div>
          <h3>4. 차주 확인사항</h3>
          <p>한 줄에 한 항목</p>
        </div>
        ${readonly ? "" : '<button type="button" class="btn ghost small" data-action="report-add-check">항목 추가</button>'}
      </div>
      <div class="report-check-list">${checks || '<p class="helper">확인사항이 없습니다.</p>'}</div>

      <div class="field">
        <label>각주</label>
        <textarea data-report-field="body.footerNote" ${lock}>${reportEscape(body.footerNote || "")}</textarea>
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
  try {
    if (typeof html2pdf === "undefined") {
      throw new Error("PDF 라이브러리를 불러오지 못했습니다.");
    }
    await html2pdf()
      .set({
        margin: [12, 12, 14, 12],
        filename: name,
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
