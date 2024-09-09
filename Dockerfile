# 베이스 이미지 선택
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /usr/src/app

# package.json과 package-lock.json 복사
COPY package*.json ./

# npm을 사용하여 의존성 설치
RUN npm install

# 소스 코드 복사
COPY . .

# 환경 변수 설정
ENV PORT=8080

# 앱을 빌드하고 시작하는 명령어
CMD ["npm", "start"]

# 앱이 리슨할 포트
EXPOSE 8080

