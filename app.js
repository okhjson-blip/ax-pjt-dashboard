/**
 * 로컬 require용 엔트리.
 * Vercel Function 엔트리는 api/index.js 입니다. 루트에서 express를 import하지 않아
 * CLI가 Express "services" 빌더로 오인하지 않게 합니다.
 */
require("./backend/src/env");
const { createApp } = require("./backend/src/app");

module.exports = createApp();
