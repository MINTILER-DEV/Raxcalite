FROM node:24-bookworm AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY frontend frontend
COPY shared shared
COPY tools tools
ARG RAX_PROXY_ORIGIN
ENV RAX_PROXY_ORIGIN=$RAX_PROXY_ORIGIN
RUN node tools/build.mjs

FROM rust:1.93-bookworm AS backend
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY backend backend
RUN cargo build --release --locked

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend /build/target/release/raxcalite ./raxcalite
COPY --from=frontend /build/frontend/dist ./frontend/dist
COPY shared shared
COPY tools tools
ENV RAX_BIND=0.0.0.0 RAX_TRUSTED_GATEWAY=1
USER node
EXPOSE 3030 3031
CMD ["node", "--max-old-space-size=512", "tools/serve.mjs"]
