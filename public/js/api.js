let authToken = "";

const API = {
  setToken(token) {
    authToken = token || "";
  },

  async request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (authToken && !headers.Authorization) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`/api${path}`, {
      ...options,
      headers
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const error = new Error(body?.error || "요청에 실패했습니다.");
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  },

  health() {
    return this.request("/health");
  },

  getCompanies() { return this.request('/companies', {cache:'no-store'}); },

  session() { return this.request('/auth/session', {cache:'no-store'}); },

  getDashboard() {
    return this.request("/dashboard", { cache: "no-store" });
  },

  saveDashboardChanges(changes) {
    return this.request("/dashboard", {
      method: "PATCH",
      body: JSON.stringify({ changes })
    });
  },

  adminLogin(password) {
    return this.request("/auth/admin", {
      method: "POST",
      body: JSON.stringify({ password })
    });
  },

  participantLogin(payload) {
    return this.request("/auth/participant", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  participantRegister(payload) {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  publishReport(payload) {
    return this.request("/reports/publish", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getCompanyWeeklyReport(companyId, week) {
    return this.request(`/companies/${encodeURIComponent(companyId)}/weekly-reports/${week}`);
  },

  saveCompanyWeeklyReport(companyId, week, payload) {
    return this.request(`/companies/${encodeURIComponent(companyId)}/weekly-reports/${week}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  assembleCompanyWeeklyReport(companyId, week, payload) {
    return this.request(`/companies/${encodeURIComponent(companyId)}/weekly-reports/${week}/assemble`, {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  },

  draftCompanyWeeklyNarrative(companyId, week) {
    return this.request(`/companies/${encodeURIComponent(companyId)}/weekly-reports/${week}/narrative`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  publishCompanyWeeklyReport(companyId, week, payload) {
    return this.request(`/companies/${encodeURIComponent(companyId)}/weekly-reports/${week}/publish`, {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  },

  syncParticipants() {
    return this.request("/participants/sync", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
};
