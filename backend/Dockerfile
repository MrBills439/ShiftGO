FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
# Admin commands run inside the deployed container, next to the database:
#   npm run agency:create -- --name "…" --hr-email … --hr-name "…"
#   node scripts/migrateRtwToS3.js
COPY scripts ./scripts

EXPOSE 4000

CMD ["node", "src/server.js"]
