# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine

ARG VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE
LABEL org.opencontainers.image.title="team-mokea" \
      org.opencontainers.image.description="Multi-account Claude proxy with automatic quota-based rotation" \
      org.opencontainers.image.source="https://github.com/The-MOKEA-Studio/TEAM-MOKEA" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN apk add --no-cache tini su-exec

ENV NODE_ENV=production \
    TEAM_MOKEA_DISABLE_AUTOUPDATE=1 \
    TEAM_MOKEA_CONFIG=/data/team-mokea.json \
    TEAM_MOKEA_HOST=0.0.0.0

WORKDIR /app

COPY --chown=root:root package.json LICENSE ./
RUN npm install --omit=dev --ignore-scripts --no-package-lock
COPY --chown=root:root --chmod=755 src/ ./src/

RUN ln -s /app/src/cli.js /usr/local/bin/team-mokea

COPY --chown=root:root --chmod=755 docker-entrypoint.sh /usr/local/bin/

RUN mkdir -p /data && chown node:node /data

WORKDIR /data

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const c=process.env.TEAM_MOKEA_CONFIG||'/data/team-mokea.json';let p=3456;try{p=require(c).proxy?.port||p}catch{};fetch('http://127.0.0.1:'+p+'/team-mokea/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh", "team-mokea"]
CMD ["server", "--headless"]
