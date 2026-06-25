FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache aws-cli

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY config.sample.json ./
COPY setup-sso.sh start.sh ./

RUN chmod +x setup-sso.sh start.sh && mkdir -p logs && chown -R node:node /app

USER node

ENV CONFIG_ENV=prod

EXPOSE 3847

CMD ["./start.sh"]
