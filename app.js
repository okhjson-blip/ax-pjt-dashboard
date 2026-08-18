/**
 * Vercel Express 엔트리 + 로컬 require용.
 * CLI가 Express 앱으로 인식하려면 이 파일에서 express를 require 해야 합니다.
 */
require("./backend/src/env");
require("express");
const { createApp } = require("./backend/src/app");

module.exports = createApp();
