FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY website ./website
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine

RUN apk add --no-cache bash git openssh-client openssl

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY repository ./repository
COPY scripts ./scripts

CMD ["bash", "scripts/start-production.sh"]
