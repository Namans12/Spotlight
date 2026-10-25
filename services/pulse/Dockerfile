# Build from the Spotlight repository root:
# docker build -f services/pulse/Dockerfile -t release-pulse .
FROM node:22.19-slim
WORKDIR /app

# Shared lib imports resolve dependencies from the repository root. The service
# has its own lockfile, tsx runtime and Qloo executable; both installs are needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/pulse/package.json services/pulse/package-lock.json ./services/pulse/
RUN npm ci --prefix services/pulse --omit=dev && npm cache clean --force

COPY lib ./lib
COPY shared ./shared
COPY data/pulse_cities.json data/collection-shapes.json ./data/
COPY services/pulse/src ./services/pulse/src

ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
# Liveness only: database/data/provider readiness is checked by the runbook.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Exec form avoids npx downloading anything or swallowing container signals.
CMD ["./services/pulse/node_modules/.bin/tsx", "services/pulse/src/server.ts"]
