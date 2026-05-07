FROM node:20-alpine
WORKDIR /app
COPY package.json README.md ./
COPY src ./src
COPY test ./test
EXPOSE 3000
CMD ["node", "src/server.js"]
