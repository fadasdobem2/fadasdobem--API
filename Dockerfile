FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Dependências primeiro (aproveita cache de camadas)
COPY package.json package-lock.json ./

RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
