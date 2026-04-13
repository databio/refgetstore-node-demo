FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY dist/ dist/
EXPOSE 80
ENV PORT=80
CMD ["node", "dist/index.js"]
