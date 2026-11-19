# ShiftGO web app (Next.js, standalone server).
#   docker build --build-arg API_PROXY_TARGET=https://<api-url> -t shiftgo-web .
# API_PROXY_TARGET is baked into the build (Next.js rewrites), so rebuild when
# the API URL changes. WEB_PROXY_SECRET and TRUSTED_PROXY_HOPS are read at
# runtime (see proxy.ts).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG API_PROXY_TARGET
ENV API_PROXY_TARGET=${API_PROXY_TARGET} NEXT_TELEMETRY_DISABLED=1
RUN test -n "$API_PROXY_TARGET" || (echo "Set --build-arg API_PROXY_TARGET" && exit 1)
RUN npx next build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
