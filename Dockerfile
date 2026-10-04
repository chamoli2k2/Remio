FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN VITE_DEMO_MODE=false npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-ssr ./dist-ssr
EXPOSE 4000
USER node
CMD ["node", "server/src/index.js"]
