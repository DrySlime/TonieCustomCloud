# Multi-stage Dockerfile for custom TeddyCloud with custom Web UI

# Stage 1: Build the custom React Web UI inside Docker (no local npm required)
FROM node:22-alpine AS web-builder
WORKDIR /app

# Install dependencies
COPY teddycloud_web/package*.json ./
RUN npm ci

# Copy source code and build production assets
COPY teddycloud_web/ ./
RUN npm run build

# Stage 2: Official TeddyCloud backend with our custom Web UI
FROM ghcr.io/toniebox-reverse-engineering/teddycloud:latest

# Pre-seed dev server certificates to prevent slow 4096-bit RSA generation on fresh start
COPY dev-sandbox/certs/server/ /teddycloud/certs/server/

# Copy Consumer PWA and landing redirect
COPY contrib/data/www/pwa/ /teddycloud/data/www/pwa/
COPY contrib/data/www/index.html /teddycloud/data/www/index.html

# Overwrite default web frontend with our custom build
COPY --from=web-builder /app/dist/ /teddycloud/data/www/web/