ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
COPY llm ./llm
COPY scripts ./scripts

RUN npm run build \
  && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/media-tools \
  && /opt/media-tools/bin/pip install --no-cache-dir 'yt-dlp[default]' gallery-dl

ENV PATH="/opt/media-tools/bin:${PATH}"

RUN ffmpeg -version && ffprobe -version \
  && yt-dlp --version && gallery-dl --version

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/llm ./llm

RUN mkdir -p /app/data

CMD ["node", "dist/src/index.js"]
