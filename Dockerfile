# syntax=docker/dockerfile:1

# Deps stage: install production dependencies with cache-friendly layering.
FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build stage: full install (incl. Vite) to produce the dist-dashboard/ bundle.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./vite.config.js
COPY dashboard ./dashboard
RUN npm run build:ui

# Runtime stage: minimal Node.js image with only the tools this app actually needs.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV HOME=/home/app \
    NODE_ENV=production \
    PORT=7071

# git is required at runtime because the git-blame feature shells out to git.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 app && \
    useradd --create-home --gid 10001 --home-dir /home/app --shell /usr/sbin/nologin --uid 10001 app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist-dashboard ./dist-dashboard
COPY --chown=app:app server.js ./server.js
COPY --chown=app:app lib ./lib
COPY --chown=app:app src ./src

USER app

EXPOSE 7071

CMD ["node", "server.js"]
