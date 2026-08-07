/**
 * Vercel Express 엔트리포인트.
 * @see https://vercel.com/docs/frameworks/backend/express
 *
 * 로컬/Docker는 `npm start` → backend/src/server.js (listen).
 * Vercel은 이 파일을 감지해 Fluid compute 단일 Function으로 실행합니다.
 */
require("./backend/src/env");
const { createApp } = require("./backend/src/app");

module.exports = createApp();
