# AI 프로젝트 통합 대시보드
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend ./backend
COPY public ./public
COPY app.js ./app.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3080

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "backend/src/server.js"]
