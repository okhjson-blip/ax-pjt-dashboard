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
    scheduleGoalRate: Number.isFinite(goal) ? Math.min(100, Math.max(0, Math.round(goal))) : 0
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
    return `AI가 각 과제의 ${target}에서 공통 인사이트와 특이점을 추려 3~4줄로 작성한 초안입니다. 내용을 수정할 수 있습니다.`;
  }
  if (source === 'compiled') return 'AI 요약이 적용되지 않은 기본 초안입니다. AI 초안 다시 작성으로 요약을 다시 요청할 수 있습니다.';
  return `각 과제의 ${target}을 참고해 작성한 초안입니다. 내용을 수정할 수 있습니다.`;
}

function reportReferenceDate(doc) {
  const now = new Date();
  const published = doc.status === "published" ? new Date(doc.publishedAt) : now;
  const reference = Number.isNaN(published.getTime()) || !doc.publishedAt ? now : published;
  const end = new Date(`${doc.periodEnd}T12:00:00+09:00`);
  return !Number.isNaN(end.getTime()) && end < reference ? end : reference;
}

function reportProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

function reportTaskStatus(row, doc) {
  return taskScheduleStatus(
    { startDate: row.periodStart || "", endDate: row.periodEnd || "", progress: reportProgress(row.progress) },
    { schedule: doc.source?.companySchedule || {} },
    reportReferenceDate(doc)
  );
}

function reportStatusChip(status) {
  return `<span class="pdf-chip pdf-${status.cls}">${reportEscape(status.label)}</span>`;
}

function reportProgressBar(progress, cls) {
  const value = reportProgress(progress);
  return `<div class="pdf-progress-value">${value}%</div><div class="pdf-bar"><i class="pdf-${cls}" style="width:${value}%"></i></div>`;
}

function renderWeeklyReportPdfHtml(doc) {
  const body = doc?.body || {};
  const ops = reportOpsView(doc);
  const taskRows = Array.isArray(body.taskRows) ? body.taskRows : [];
  const period = reportPeriodLabel(doc);

  const rows = taskRows.map(row => ({...row, status: reportTaskStatus(row, doc)}));
  const counts = {green:0, blue:0, red:0, gray:0};
  rows.forEach(row => counts[row.status.cls]++);
  const risk = rows.filter(row => row.status.cls === "red").sort((a,b) => a.status.diff - b.status.diff);
  const text = value => reportEscape(value || "—").replace(/\r?\n/g, "<br>");
  const labels = {green:"양호", blue:"정상", red:"정체", gray:"일정미설정"};
  const legend = Object.keys(counts).map(cls => `<span><i class="pdf-dot pdf-${cls}"></i>${labels[cls]} ${counts[cls]}건</span>`).join("");
  const stack = Object.keys(counts).map(cls => `<i class="pdf-${cls}" style="width:${rows.length ? counts[cls] / rows.length * 100 : 0}%"></i>`).join("");
  const watchRows = risk.map(row => `<tr><td><b>${text(row.name)}</b></td><td>${text(row.ownerName)}<div class="pdf-muted">${text(row.dept)}</div></td><td>${text(row.periodStart)}</td><td>${text(row.periodEnd)}</td><td>${reportProgressBar(row.progress,row.status.cls)}</td><td>${reportStatusChip(row.status)}</td></tr>`).join("");
  const taskHtml = rows.map(row => `<tr><td><div class="pdf-task-title"><i class="pdf-dot pdf-${row.status.cls}"></i><b>${text(row.name)}</b></div><div class="pdf-muted pdf-task-meta">${text(row.dept)} · ${text(row.ownerName)}<br>${text(reportTaskPeriod(row))}</div></td><td>${reportProgressBar(row.progress,row.status.cls)}</td><td>${text(row.weeklyProgress)}</td><td>${text(row.nextPlan)}</td></tr>`).join("");
  return `<div class="pdf-report">
    <template class="pdf-page-footer"><div class="pdf-page-number"></div></template>
    <div class="pdf-source">
      <header class="pdf-head"><h1>${reportEscape(doc.title || "주간보고")}</h1><p class="pdf-meta">보고 기간 ${reportEscape(period || "미설정")}</p></header>
      <div class="pdf-action">${ops.taskCount}개 과제 · 정체 ${counts.red}건${counts.gray ? ` · 일정미설정 ${counts.gray}건` : ""} — ${risk.length ? "중점 관리 과제 확인 필요" : "과제별 진행 현황 확인"}</div>
      <h2 class="pdf-summary-section"><em>01</em> 협력사 운영 요약</h2>
      <div class="pdf-kpis">${[["총 과제수",ops.taskCount,"건"],["총 참여자 수",ops.participantCount,"명"],["과제 진척도",ops.progress,"%"],["일정 목표 달성률",ops.scheduleGoalRate,"%"]].map(([label,value,unit]) => `<div><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`).join("")}</div>
      <div class="pdf-distribution"><div class="pdf-stack">${stack}</div><div class="pdf-legend">${legend}</div></div>
      <h2 class="pdf-summary-section"><em>02</em> 금주 요약 및 차주 계획</h2>
      <h3>금주 요약</h3>${reportRichText(body.weekSummary,"금주 요약이 없습니다.")}
      <h3>차주 계획</h3>${reportRichText(body.nextWeekPlan,"차주 계획이 없습니다.")}
      <h2 class="pdf-summary-section" data-report-section="watchlist"><em>03</em> 중점 관리 과제 (${risk.length}건)</h2>
      <table class="pdf-watchlist"><colgroup><col style="width:38%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:10%"><col style="width:10%"></colgroup><thead><tr><th>과제명</th><th>담당</th><th>시작일</th><th>종료일</th><th>진척</th><th>상태</th></tr></thead><tbody>${watchRows || '<tr><td colspan="6">정체 과제가 없습니다.</td></tr>'}</tbody></table>
      <h2 class="pdf-detail-start" data-report-section="details"><em>04</em> 과제별 진행 현황</h2>
      <table class="pdf-details"><colgroup><col style="width:34%"><col style="width:10%"><col style="width:28%"><col style="width:28%"></colgroup><thead><tr><th>과제 / 부서 · 담당 · 기간</th><th>진척</th><th>금주 진전</th><th>차주 계획</th></tr></thead><tbody>${taskHtml || '<tr><td colspan="4">등록된 과제가 없습니다.</td></tr>'}</tbody></table>
      ${body.footerNote ? reportRichText(body.footerNote) : ""}
    </div></div>`;
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

// Measure the same A4 content area for both the preview and html2pdf.
// Tables are divided explicitly because html2canvas does not repeat thead.
function paginateWeeklyReport(element, density = 0) {
  const source = element.querySelector('.pdf-source');
  if (!source) return;
  const footer = element.querySelector('.pdf-page-footer');
  let page, body;
  const pages = [];
  const newPage = () => {
    page = document.createElement('div');
    page.className = 'pdf-page';
    body = document.createElement('div');
    body.className = 'pdf-page-body';
    page.appendChild(body);
    page.appendChild(footer.content.cloneNode(true));
    element.appendChild(page);
    pages.push(page);
  };
  const over = () => body.scrollHeight > body.clientHeight + 0.5;
  const plainText = node => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return clone.textContent;
  };
  // An individual row/paragraph can exceed a whole page. Split its text
  // into measured continuations rather than hiding it or looping forever.
  const splitTallNode = (node, nextContainer) => {
    const isRow = node.tagName === 'TR';
    const fields = isRow ? Array.from(node.cells) : [node];
    const remaining = fields.map(field => Array.from(plainText(field)));
    const makePiece = length => {
      const piece = node.cloneNode(false);
      if (isRow) fields.forEach((field,index) => {
        const cell = field.cloneNode(false);
        cell.textContent = remaining[index].slice(0,length).join('');
        cell.style.whiteSpace = 'pre-wrap';
        piece.appendChild(cell);
      });
      else { piece.textContent = remaining[0].slice(0,length).join(''); piece.style.whiteSpace = 'pre-wrap'; }
      return piece;
    };
    let container = node.parentElement;
    node.remove();
    while (remaining.some(chars => chars.length)) {
      let low = 0, high = Math.max(...remaining.map(chars => chars.length));
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidate = makePiece(mid);
        container.appendChild(candidate);
        const fits = !over();
        candidate.remove();
        if (fits) low = mid; else high = mid - 1;
      }
      if (!low) throw new Error('PDF 페이지에 내용을 배치하지 못했습니다. 글꼴과 문서 내용을 확인해 주세요.');
      container.appendChild(makePiece(low));
      remaining.forEach(chars => chars.splice(0,low));
      if (remaining.some(chars => chars.length)) container = nextContainer();
    }
  };
  newPage();
  let pending = [], sectionHeading = null;
  for (const original of Array.from(source.children)) {
    if (/^H[23]$/.test(original.tagName)) {
      if (original.classList.contains('pdf-detail-start') && body.children.length) {
        // Try a compact summary before allowing a readable continuation.
        // Keep the source intact until the chosen density has been laid out.
        if (pages.length > 1 && density < 2) {
          pages.forEach(item => item.remove());
          element.classList.add(density === 0 ? 'pdf-summary-compact' : 'pdf-summary-dense');
          paginateWeeklyReport(element, density + 1);
          return;
        }
        newPage();
      }
      pending.push(original.cloneNode(true));
      if (original.tagName === 'H2') sectionHeading = original;
      continue;
    }
    if (original.tagName === 'TABLE') {
      let unit, tableBody;
      const startTable = continued => {
        unit = document.createElement('div');
        unit.className = 'pdf-table-unit';
        if (continued && sectionHeading) {
          const title = sectionHeading.cloneNode(true);
          title.appendChild(document.createTextNode(' (계속)'));
          unit.appendChild(title);
        } else pending.forEach(node => unit.appendChild(node));
        const table = original.cloneNode(true);
        tableBody = table.querySelector('tbody');
        tableBody.replaceChildren();
        unit.appendChild(table);
        body.appendChild(unit);
        return tableBody;
      };
      startTable(false);
      for (const row of original.querySelectorAll('tbody > tr')) {
        const tr = row.cloneNode(true);
        tableBody.appendChild(tr);
        if (!over()) continue;
        tr.remove();
        if (!tableBody.children.length) {
          if (body.children.length > 1) { unit.remove(); newPage(); startTable(false); }
        } else { newPage(); startTable(true); }
        tableBody.appendChild(tr);
        if (over()) splitTallNode(tr, () => { newPage(); return startTable(true); });
      }
      pending = [];
      continue;
    }
    // Keep headings with the first paragraph or list item that follows.
    const blocks = original.tagName === 'UL' ? Array.from(original.children).map(li => {
      const list = original.cloneNode(false); list.appendChild(li.cloneNode(true)); return list;
    }) : [original.cloneNode(true)];
    for (const block of blocks) {
      const unit = document.createElement('div');
      unit.className = 'pdf-text-unit';
      pending.forEach(node => unit.appendChild(node));
      unit.appendChild(block);
      body.appendChild(unit);
      if (over() && body.children.length > 1) { unit.remove(); newPage(); body.appendChild(unit); }
      if (over()) splitTallNode(block, () => { newPage(); return body; });
      pending = [];
    }
  }
  source.remove();
  pages.forEach((item,index) => { item.querySelector('.pdf-page-number').textContent = `${index + 1} / ${pages.length}`; });
}

async function refreshWeeklyReportPreview(root = document) {
  if (document.fonts?.ready) await document.fonts.ready;
  const element = root.querySelector('.report-pdf-preview .pdf-report');
  if (element?.isConnected) paginateWeeklyReport(element);
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
    paginateWeeklyReport(element);
    const options = {
        margin: [12, 12, 14, 12],
        filename: name,
        pagebreak: { mode: ['css', 'legacy'], before: '.pdf-page + .pdf-page', avoid: ['tr', 'thead', 'p', 'li', 'h1', 'h2', 'h3', '.pdf-head'] },
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      };
    const pages = Array.from(element.querySelectorAll('.pdf-page'));
    // Render one A4 page at a time: a single canvas for a long report can
    // exceed the browser canvas limit and produce a blank PDF.
    const exportPage = page => {
      // Keep the document ancestor when html2pdf clones an individual page,
      // so every scoped document style still applies in the canvas.
      const shell = document.createElement('div');
      shell.className = element.className;
      shell.appendChild(page.cloneNode(true));
      wrapper.appendChild(shell);
      return shell;
    };
    let shell = exportPage(pages[0]);
    const worker = html2pdf().set(options).from(shell).toPdf();
    const pdf = await worker.get('pdf');
    shell.remove();
    for (const page of pages.slice(1)) {
      shell = exportPage(page);
      const canvas = await html2pdf().set(options).from(shell).toCanvas().get('canvas');
      shell.remove();
      pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 12, 12, 186, canvas.height * 186 / canvas.width);
      canvas.width = 0;
      canvas.height = 0;
    }
    await worker.save();
    return name;
  } finally {
    wrapper.remove();
  }
}
