FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY config.sample.json ./

RUN mkdir -p logs

USER node

ENV CONFIG_ENV=uat

CMD ["npm", "start"]
