/**
 * Vercel Express 엔트리 + 로컬 require용.
 * - Vercel: package.json의 express 의존성 + 이 파일의 express require로 프레임워크 감지
 * - 로컬 장기 실행: `npm start` → backend/src/server.js (listen)
 */
require("./backend/src/env");
require("express");
const { createApp } = require("./backend/src/app");

module.exports = createApp();
