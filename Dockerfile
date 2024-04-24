FROM node:20-alpine

COPY src /app/src
COPY package.json /app/package.json
COPY tsconfig.json /app/tsconfig.json
COPY database.db /app/configuration/database.db
COPY configuration.json /app/configuration/configuration.json

RUN apk update && apk add curl

HEALTHCHECK --interval=5s --timeout=2s CMD curl -f http://localhost:8080/health || exit 1 

WORKDIR /app

ENV PORT=8080

RUN npm i
RUN npx tsc

CMD [ "dist/index.js", "serve", "--configuration", "/app/configuration"]