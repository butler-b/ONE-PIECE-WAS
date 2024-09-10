# 베이스 이미지 선택
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /root/WANT-PIECE-WAS

# package.json과 package-lock.json 복사
COPY package*.json ./

RUN npm install pm2 -g && npm install

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV PORT=8080

EXPOSE 8080
# 앱을 빌드하고 시작하는 명령어
CMD ["pm2-runtime", "index.js"]


