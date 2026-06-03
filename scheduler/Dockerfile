FROM node:22-alpine

WORKDIR /app

COPY notification-scheduler.mjs ./notification-scheduler.mjs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "notification-scheduler.mjs"]
