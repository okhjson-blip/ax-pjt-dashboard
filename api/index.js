/**
 * Vercel Serverless Function 엔트리.
 * public/ 정적 파일은 CDN이 우선 서빙하고, 나머지는 vercel.json rewrite로 여기로 진입합니다.
 */
require("../backend/src/env");
const { createApp } = require("../backend/src/app");

module.exports = createApp();
