FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY infra/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip Windows line endings (they would break the #!/bin/sh line) and make it executable.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health/ready" >/dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/apps/api/src/main.js"]