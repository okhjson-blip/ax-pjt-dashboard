/**
 * Express zero-config 대안 엔트리 (로컬 require / 일부 런타임용).
 * Vercel 배포의 주 엔트리는 api/index.js 입니다.
 */
require("./backend/src/env");
const { createApp } = require("./backend/src/app");

module.exports = createApp();
