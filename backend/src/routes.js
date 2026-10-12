const express = require("express");
const { readData, writeData, uid, isSupabaseConfigured, getCompanyWeeklyReport, upsertCompanyWeeklyReport } = require("./store");
const {
  getConsultingWeek,
  assembleCompanyWeeklyReport,
  mergeAssembledDraft,
  normalizeReportDoc,
  companyWeeklyReportId
} = require("./weekly-report");
const { draftNarratives } = require("./report-draft");
const { matchesCompanyPmo } = require("./pmo");

async function applyNarrativeDraft(report, company, { onlyBlank = false } = {}) {
  if (!report?.body) return report;
  const draft = await draftNarratives(company?.name, report.body.taskRows || []);
  const weekBlank = !String(report.body.weekSummary || "").trim();
  const planBlank = !String(report.body.nextWeekPlan || "").trim();
  if (!onlyBlank || weekBlank) report.body.weekSummary = draft.weekSummary;
  if (!onlyBlank || planBlank) report.body.nextWeekPlan = draft.nextWeekPlan;
  if (!onlyBlank || weekBlank || planBlank) report.body.narrativeSource = draft.source;
  return report;
}

async function refreshOpenDraft(report, company, weekNumber, options = {}) {
  const assembled = assembleCompanyWeeklyReport(company, weekNumber);
  report.body.ops = assembled.body.ops;
  report.source = assembled.source || report.source;
  if (options.replaceTasks || !Array.isArray(report.body.taskRows) || report.body.taskRows.length === 0) {
    report.body.taskRows = assembled.body.taskRows;
  }
  const weekBlank = !String(report.body.weekSummary || "").trim();
  const planBlank = !String(report.body.nextWeekPlan || "").trim();
  if (!weekBlank && !planBlank) return report;
  const draft = await draftNarratives(company?.name, report.body.taskRows || []);
  if (weekBlank) report.body.weekSummary = draft.weekSummary;
  if (planBlank) report.body.nextWeekPlan = draft.nextWeekPlan;
  if (report.body.narrativeSource !== "edited") report.body.narrativeSource = draft.source;
  return report;
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin2026";

function createRouter() {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    const db = isSupabaseConfigured() ? "supabase" : "json-file";
    res.json({
      ok: true,
      service: "ax-pjt-dashboard",
      db,
      runtime: process.env.VERCEL ? "vercel" : "node",
      supabaseConfigured: isSupabaseConfigured(),
      time: new Date().toISOString(),
      ...(process.env.VERCEL && !isSupabaseConfigured()
        ? {
            warning:
              "Vercel Environment Variables에 SUPABASE_URL, SUPABASE_SECRET_KEY를 설정하세요."
          }
        : {})
    });
  });

  router.get("/dashboard", async (_req, res, next) => {
    try {
      res.json(await readData());
    } catch (err) {
      next(err);
    }
  });

  router.put("/dashboard", async (req, res, next) => {
    try {
      const body = req.body || {};
      if (!Array.isArray(body.companies)) {
        return res.status(400).json({ error: "companies 배열이 필요합니다." });
      }
      const current = await readData();
      const nextData = {
        companies: body.companies,
        meta: {
          ...(current.meta || {}),
          ...(body.meta || {})
        }
      };
      res.json(await writeData(nextData));
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/admin", (req, res) => {
    const password = String(req.body?.password || "");
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
    }
    res.json({ role: "admin", name: "관리자" });
  });

  router.post("/auth/participant", async (req, res, next) => {
    try {
      const companyId = String(req.body?.companyId || "");
      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();

      if (!companyId || !name || !email) {
        return res.status(400).json({ error: "협력사, 이름, 이메일을 모두 입력해 주세요." });
      }

      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) {
        return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });
      }

      const participant = company.participants.find(
        (p) => p.name === name && String(p.email).toLowerCase() === email
      );

      if (matchesCompanyPmo(company, name, email)) {
        return res.json({
          role: "pmo",
          name,
          email,
          companyId: company.id,
          participantId: participant?.id || null
        });
      }

      if (!participant) {
        return res.status(404).json({
          error: "등록된 정보가 없습니다. 부서를 입력해 신규 등록할 수 있습니다.",
          needRegister: true
        });
      }

      res.json({
        role: "participant",
        name: participant.name,
        participantId: participant.id,
        companyId: company.id
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/auth/register", async (req, res, next) => {
    try {
      const companyId = String(req.body?.companyId || "");
      const name = String(req.body?.name || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const dept = String(req.body?.dept || "").trim();

      if (!companyId || !name || !email || !dept) {
        return res.status(400).json({ error: "이름, 이메일, 부서를 모두 입력해 주세요." });
      }

      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) {
        return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });
      }

      if (matchesCompanyPmo(company, name, email)) {
        return res.status(409).json({
          error: "협력사 PMO로 등록된 계정입니다. 부서 등록 없이 로그인해 주세요."
        });
      }

      const exists = company.participants.find((p) => String(p.email).toLowerCase() === email);
      if (exists) {
        return res.status(409).json({ error: "이미 등록된 이메일입니다. 기존 정보로 로그인해 주세요." });
      }

      const participant = {
        id: uid("p"),
        name,
        email,
        dept,
        status: "정상",
        summary: "",
        nextWeekPlan: "",
        instructorMemo: "",
        tasks: [],
        registeredAt: new Date().toISOString()
      };

      company.participants.push(participant);
      await writeData(data);

      res.status(201).json({
        role: "participant",
        name: participant.name,
        participantId: participant.id,
        companyId: company.id
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/companies/:companyId/weekly-reports/:week", async (req, res, next) => {
    try {
      const companyId = String(req.params.companyId || "");
      const weekNumber = Number(req.params.week);
      if (!companyId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        return res.status(400).json({ error: "협력사와 주차가 필요합니다." });
      }
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });

      const saved = await getCompanyWeeklyReport(companyId, weekNumber);
      if (saved) {
        const report = normalizeReportDoc(saved, company);
        if (report.status !== "published") {
          const legacyShape = !Array.isArray(saved.body?.taskRows);
          await refreshOpenDraft(report, company, weekNumber, { replaceTasks: legacyShape });
        }
        return res.json({
          ok: true,
          saved: true,
          assembled: false,
          currentWeek: getConsultingWeek(company.schedule?.startDate),
          report
        });
      }

      const assembled = assembleCompanyWeeklyReport(company, weekNumber);
      await applyNarrativeDraft(assembled, company);
      return res.json({
        ok: true,
        saved: false,
        assembled: true,
        currentWeek: getConsultingWeek(company.schedule?.startDate),
        report: assembled
      });
    } catch (err) {
      next(err);
    }
  });

  router.put("/companies/:companyId/weekly-reports/:week", async (req, res, next) => {
    try {
      const companyId = String(req.params.companyId || "");
      const weekNumber = Number(req.params.week);
      if (!companyId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        return res.status(400).json({ error: "협력사와 주차가 필요합니다." });
      }
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });

      const existing = await getCompanyWeeklyReport(companyId, weekNumber);
      const incoming = normalizeReportDoc(
        {
          ...(existing || {}),
          ...(req.body || {}),
          id: existing?.id || companyWeeklyReportId(companyId, weekNumber),
          companyId,
          weekNumber,
          status: "draft"
        },
        company
      );
      const saved = await upsertCompanyWeeklyReport(incoming);
      res.json({ ok: true, saved: true, report: saved });
    } catch (err) {
      next(err);
    }
  });

  router.post("/companies/:companyId/weekly-reports/:week/assemble", async (req, res, next) => {
    try {
      const companyId = String(req.params.companyId || "");
      const weekNumber = Number(req.params.week);
      if (!companyId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        return res.status(400).json({ error: "협력사와 주차가 필요합니다." });
      }
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });

      const existing = await getCompanyWeeklyReport(companyId, weekNumber);
      const current = existing
        ? normalizeReportDoc({ ...existing, ...(req.body || {}), companyId, weekNumber }, company)
        : normalizeReportDoc({ ...(req.body || {}), companyId, weekNumber }, company);
      const assembled = assembleCompanyWeeklyReport(company, weekNumber);
      const merged = mergeAssembledDraft(current, assembled);
      merged.status = "draft";
      const saved = await upsertCompanyWeeklyReport(merged);
      res.json({ ok: true, saved: true, assembled: true, report: saved });
    } catch (err) {
      next(err);
    }
  });

  router.post("/companies/:companyId/weekly-reports/:week/narrative", async (req, res, next) => {
    try {
      const companyId = String(req.params.companyId || "");
      const weekNumber = Number(req.params.week);
      if (!companyId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        return res.status(400).json({ error: "협력사와 주차가 필요합니다." });
      }
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });

      const assembled = assembleCompanyWeeklyReport(company, weekNumber);
      const draft = await draftNarratives(company.name, assembled.body.taskRows);
      res.json({
        ok: true,
        weekSummary: draft.weekSummary,
        nextWeekPlan: draft.nextWeekPlan,
        narrativeSource: draft.source
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/companies/:companyId/weekly-reports/:week/publish", async (req, res, next) => {
    try {
      const companyId = String(req.params.companyId || "");
      const weekNumber = Number(req.params.week);
      if (!companyId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        return res.status(400).json({ error: "협력사와 주차가 필요합니다." });
      }
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);
      if (!company) return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });

      const existing = await getCompanyWeeklyReport(companyId, weekNumber);
      const incoming = normalizeReportDoc(
        {
          ...(existing || assembleCompanyWeeklyReport(company, weekNumber)),
          ...(req.body || {}),
          id: existing?.id || companyWeeklyReportId(companyId, weekNumber),
          companyId,
          weekNumber,
          status: "published",
          publishedAt: new Date().toISOString()
        },
        company
      );
      incoming.status = "published";
      incoming.publishedAt = incoming.publishedAt || new Date().toISOString();
      const saved = await upsertCompanyWeeklyReport(incoming);

      data.meta = data.meta || {};
      data.meta.lastReportRequestAt = saved.publishedAt;
      await writeData(data);

      res.json({
        ok: true,
        saved: true,
        report: saved,
        requestedAt: data.meta.lastReportRequestAt
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/reports/publish", async (req, res, next) => {
    try {
      const companyId = String(req.body?.companyId || "");
      const note = String(req.body?.note || "").trim();
      const data = await readData();
      const company = data.companies.find((c) => c.id === companyId);

      if (!company) {
        return res.status(404).json({ error: "협력사를 찾을 수 없습니다." });
      }

      data.meta = data.meta || {};
      data.meta.lastReportRequestAt = new Date().toISOString();
      await writeData(data);

      res.json({
        ok: true,
        message: "주간 레포트 PDF 발행 기록을 저장했습니다.",
        companyId,
        companyName: company.name,
        note,
        requestedAt: data.meta.lastReportRequestAt
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/participants/sync", async (_req, res, next) => {
    try {
      const data = await readData();
      const rows = data.companies.flatMap((company) =>
        company.participants.map((participant) => ({
          company: company.name,
          dept: participant.dept,
          name: participant.name,
          email: participant.email
        }))
      );

      data.meta = data.meta || {};
      data.meta.lastParticipantSyncAt = new Date().toISOString();
      await writeData(data);

      res.json({
        ok: true,
        message: "참여자 명단 업데이트 요청을 전송했습니다. 스프레드시트 반영 여부를 확인해 주세요.",
        count: rows.length,
        companies: data.companies.length,
        requestedAt: data.meta.lastParticipantSyncAt,
        rows
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRouter, ADMIN_PASSWORD };
