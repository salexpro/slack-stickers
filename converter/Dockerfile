# Puppeteer image ships a compatible Chromium + all system libs.
FROM ghcr.io/puppeteer/puppeteer:23.6.0

USER root
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.js"]
