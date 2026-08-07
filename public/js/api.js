const API = {
  async request(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
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

  getDashboard() {
    return this.request("/dashboard");
  },

  saveDashboard(payload) {
    return this.request("/dashboard", {
      method: "PUT",
      body: JSON.stringify(payload)
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

  syncParticipants() {
    return this.request("/participants/sync", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
};
