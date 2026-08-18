/**
 * Vercel Serverless Function 엔트리 (`/api/*`).
 * 정적 파일은 public/ 을 CDN이 서빙하고, API만 이 함수가 처리합니다.
 */
require("../backend/src/env");
require("express");
const { createApp } = require("../backend/src/app");

module.exports = createApp();
