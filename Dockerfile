ARG NODE_IMAGE=node:24.21.0-bookworm-slim
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall generates the project-specific Prisma client without credentials.
RUN npm ci --no-audit --no-fund
COPY server ./server
RUN npm run build:server
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-server ./dist-server
COPY db ./db
COPY docker/container-entrypoint.mjs ./docker/container-entrypoint.mjs
USER node
EXPOSE 3001
ENTRYPOINT ["node", "docker/container-entrypoint.mjs"]
CMD ["server"]
