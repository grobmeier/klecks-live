FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY LICENSE UPSTREAM_LICENSE ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY upstream.json ./
COPY patches ./patches
COPY scripts ./scripts
RUN npm run prepare:klecks && npm --prefix .build/klecks ci --ignore-scripts --no-audit --no-fund
RUN node scripts/audit-klecks.mjs
COPY public ./public
RUN PARCEL_WORKERS=2 npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/grobmeier/klecks-live" \
      org.opencontainers.image.revision="$SOURCE_REVISION"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5055
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY LICENSE UPSTREAM_LICENSE ./
COPY server ./server
COPY public/protocol.js ./public/protocol.js
COPY scripts/smoke-online.mjs ./scripts/smoke-online.mjs
COPY --from=build /app/dist ./dist
USER 1000:1000
EXPOSE 5055
HEALTHCHECK --interval=30s --timeout=3s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:5055/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["server/index.mjs"]
