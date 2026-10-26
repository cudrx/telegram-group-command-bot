FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY llm ./llm
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -o node -g node /app/data /media

FROM runtime AS python
ENV PATH="/opt/media-tools/bin:${PATH}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv \
  && python3 -m venv /opt/media-tools \
  && rm -rf /var/lib/apt/lists/*

FROM python AS video-tools
ARG YT_DLP_VERSION=2026.10.21
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && pip install --no-cache-dir "yt-dlp[default,curl-cffi]==${YT_DLP_VERSION}" \
  && rm -rf /var/lib/apt/lists/*

FROM video-tools AS video
COPY --from=build /app/dist/src/media/service*.js ./dist/src/media/
COPY --from=build /app/dist/scripts/media-service.js ./dist/scripts/
ENV MEDIA_SERVICE_KIND=video MEDIA_PORT=8081
USER node:node
RUN yt-dlp --version && ffmpeg -version && ffprobe -version
CMD ["node", "dist/scripts/media-service.js"]

FROM python AS gallery-tools
ARG GALLERY_DL_VERSION=1.32.17
RUN pip install --no-cache-dir "gallery-dl==${GALLERY_DL_VERSION}"

FROM gallery-tools AS gallery
COPY --from=build /app/dist/src/media/service*.js ./dist/src/media/
COPY --from=build /app/dist/scripts/media-service.js ./dist/scripts/
ENV MEDIA_SERVICE_KIND=gallery MEDIA_PORT=8082
USER node:node
RUN gallery-dl --version
CMD ["node", "dist/scripts/media-service.js"]

FROM runtime AS bot
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/llm ./llm
USER node:node
CMD ["node", "dist/src/index.js"]
