# ---- dashboard stage ----
FROM node:24-alpine AS dashboard-builder

WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build
# ---- Python builder stage ----
FROM python:3.13-slim AS builder

WORKDIR /app
COPY . .
COPY --from=dashboard-builder /dashboard/dist ./Server/assets
RUN pip install --no-cache-dir "setuptools>=68.0" && \
    pip install --no-cache-dir --no-build-isolation --prefix=/install .

# ---- runtime stage ----
FROM python:3.13-slim

COPY --from=builder /install /usr/local
WORKDIR /data

EXPOSE 8000

ENTRYPOINT ["janus"]
