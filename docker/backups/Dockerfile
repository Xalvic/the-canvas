FROM node:24.21.0-bookworm-slim AS node
FROM postgres:18.6-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY scripts/backup-tools.mjs scripts/backup.mjs scripts/restore.mjs /opt/scribble/
ENV BACKUP_NATIVE_TOOLS=1
USER postgres
ENTRYPOINT ["node"]
CMD ["/opt/scribble/backup.mjs"]
