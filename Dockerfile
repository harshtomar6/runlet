# Portable Node image (Railway / Fly / Render / any container host).
FROM node:22-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Runs via tsx (see package.json "start").
CMD ["pnpm", "start"]
