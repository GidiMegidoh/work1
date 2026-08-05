# שרת שיבוץ החי — אפס תלויות npm, אז אין שלב install בכלל.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY server ./server
# tenants/ ו-data/ מגיעים כ-volumes מ-docker-compose — עריכת טננט לא דורשת build

ENV NODE_ENV=production
EXPOSE 8080

# exec form ⇒ node הוא PID 1 ומקבל SIGHUP/SIGTERM ישירות (טעינת טננטים מחדש)
CMD ["node", "server/index.js"]
