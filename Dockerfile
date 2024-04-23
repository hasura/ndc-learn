FROM node:20-alpine

COPY src /app/src
COPY package.json /app/package.json
COPY tsconfig.json /app/tsconfig.json
COPY database.db /app/configuration/database.db
COPY configuration.json /app/configuration/configuration.json

WORKDIR /app

ENV PORT=8080

RUN npm i
RUN npx tsc

CMD [ "dist/index.js", "serve", "--configuration", "/app/configuration"]