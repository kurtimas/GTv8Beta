# Grain Tracker v2 — full-stack (Vite frontend + Hono/tRPC API + Drizzle/MySQL)
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000
# Boots dist/boot.js: applies DB migrations + demo seed (if empty), then serves.
CMD ["npm", "start"]
