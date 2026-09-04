FROM node:22-bookworm-slim AS pos-build

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci

COPY client/package*.json ./client/
RUN cd client && npm ci

COPY server ./server
COPY client ./client

RUN cd server && npm run build
RUN cd client && npm run build

FROM node:22-bookworm-slim AS pos-runtime

ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY --from=pos-build /app/server/dist ./server/dist
COPY --from=pos-build /app/client/dist ./client/dist

RUN mkdir -p /app/server/uploads

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4001/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]

FROM postgres:16-alpine AS pos-migrate

COPY db /app-db
COPY docker/postgres/migrate.sh /usr/local/bin/pos-migrate
RUN chmod +x /usr/local/bin/pos-migrate

ENTRYPOINT ["/usr/local/bin/pos-migrate"]
