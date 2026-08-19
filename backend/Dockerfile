# Built from the repository root so the shared workspace is in context:
#   docker build -f backend/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN yarn install --frozen-lockfile
COPY shared ./shared
COPY backend ./backend
RUN yarn workspace @onestack/shared build && yarn workspace @onestack/backend build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
USER node
EXPOSE 4000
CMD ["node", "backend/dist/main.js"]
