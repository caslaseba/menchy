FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV MENCHY_CLOUD=1
ENV MENCHY_NO_OPEN=1
ENV TZ=America/Argentina/Buenos_Aires
ENV DATA_DIR=/data
EXPOSE 3847
CMD ["node", "server.js"]
