# Lets Railway build the worker straight from the repo root
# (works whether or not "Root Directory" is set in Railway).
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

ENV NODE_ENV=production \
    TZ=America/Chicago \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY worker/package.json ./
RUN npm install --omit=dev
COPY worker/src ./src

CMD ["node", "src/index.js"]
