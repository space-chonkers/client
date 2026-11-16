FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# Backend origin for real Mars terrain (GET /v1/mars-terrain/{seed}), baked into the bundle.
# Empty: missions use procedural terrain. See docs/map_integration.md.
ARG VITE_MARS_TERRAIN_API_URL=
ENV VITE_MARS_TERRAIN_API_URL=$VITE_MARS_TERRAIN_API_URL
RUN bun run build

FROM nginx:alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
