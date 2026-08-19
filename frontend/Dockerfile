# Built from the repository root so the shared workspace is in context:
#   docker build -f frontend/Dockerfile .

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN yarn install --frozen-lockfile
COPY shared ./shared
COPY frontend ./frontend
# NEXT_PUBLIC_* is baked into the client bundle here, not read at runtime.
# It has to be a build arg or the image ships with the default forever.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN yarn workspace @onestack/shared build && yarn workspace @onestack/frontend build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 'standalone' emits a self-contained server plus only the modules it needs.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
