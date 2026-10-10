FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY LICENSE UPSTREAM_LICENSE ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY upstream.json ./
COPY patches ./patches
COPY scripts ./scripts
RUN npm run prepare:klecks && npm --prefix .build/klecks ci --ignore-scripts --no-audit --no-fund
COPY public ./public
RUN PARCEL_WORKERS=2 npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5055
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY LICENSE UPSTREAM_LICENSE ./
COPY server ./server
COPY public/protocol.js ./public/protocol.js
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5055
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:5055/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
