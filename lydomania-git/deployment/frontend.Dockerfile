# =====================================================================
# Lydomania — Frontend (CRA → static build → nginx)
# Multi-stage: build the React bundle, then serve via nginx:alpine.
# REACT_APP_BACKEND_URL must be set at BUILD time (CRA inlines env vars).
# =====================================================================
FROM node:20-alpine AS build
WORKDIR /build

# Yarn cache
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

# App source
COPY frontend .

# Empty REACT_APP_BACKEND_URL → frontend calls relative `/api/*` (same origin
# as the page) and Caddy proxies it to the backend container.
ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL \
    DISABLE_ESLINT_PLUGIN=true \
    GENERATE_SOURCEMAP=false \
    CI=false

RUN yarn build

# ----- Runtime stage -----
FROM nginx:1.27-alpine
COPY --from=build /build/build /usr/share/nginx/html
COPY deployment/frontend-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz >/dev/null 2>&1 || exit 1
