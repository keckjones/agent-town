# Includes Chromium for the Inspector and Designer agents.
# The Playwright version here must match "playwright" in package.json.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

ENV NODE_ENV=production \
    TZ=America/Chicago \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

CMD ["node", "src/index.js"]
