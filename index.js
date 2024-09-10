const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require("openai");

// 환경 변수 로드
dotenv.config();

// 필수 환경 변수 확인
if (!process.env.MONGO_URI || !process.env.JWT_SECRET || !process.env.OPENAI_API_KEY) {
  console.error("필수 환경 변수가 설정되지 않았습니다.");
  process.exit(1); // 환경 변수가 없으면 서버 종료
}

// MongoDB 연결 설정
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.catch(error => {
  console.error('MongoDB 연결 오류:', error);
  process.exit(1); // MongoDB 연결 실패 시 서버 종료
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// MongoDB Conversation 스키마 정의
const conversationSchema = new mongoose.Schema({
  userId: String,
  role: String,
  content: String,
  timestamp: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

const app = express();
const port = process.env.PORT || 8080;  // 환경 변수로 포트 설정

// 미들웨어 설정
app.use(cors()); // CORS 허용
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OpenAI 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ChatGPT API와 상호작용하는 함수
async function getChatGPTResponse(messages, systemRole) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemRole || "You are a helpful assistant." },
        ...messages // 이전 대화 기록 추가
      ],
      temperature: 1,
      max_tokens: 256,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("ChatGPT API와 상호작용 중 오류 발생:", error);
    throw new Error('ChatGPT API 오류 발생');
  }
}

// JWT 인증 미들웨어
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: '토큰이 없습니다.' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(403).json({ message: '유효하지 않은 토큰입니다.' });
  }
};

// 사용자 등록 라우트
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: '모든 필드를 입력해주세요.' });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '이미 존재하는 사용자입니다.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({ token, message: '사용자가 성공적으로 등록되었습니다.' });
  } catch (error) {
    console.error("사용자 등록 중 오류:", error);
    res.status(500).json({ message: '서버 오류 발생' });
  }
});

// 사용자 목록 조회 라우트 (GET /api/users)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 }); // 비밀번호 제외
    res.status(200).json(users);
  } catch (error) {
    console.error("사용자 목록 조회 중 오류:", error);
    res.status(500).json({ message: '사용자 조회 중 오류 발생' });
  }
});

// 로그인 라우트
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: '잘못된 이메일 또는 비밀번호입니다.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: '잘못된 이메일 또는 비밀번호입니다.' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, message: '로그인 성공!' });
  } catch (error) {
    console.error("로그인 중 오류:", error);
    res.status(500).json({ message: '서버 오류 발생' });
  }
});

// 대화 기록과 ChatGPT와의 상호작용
app.post('/api/chatbot', authenticateToken, async (req, res) => {
  const { message, systemRole } = req.body;

  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (systemRole) {
      user.systemRole = systemRole;
      await user.save();
    }

    const conversation = await Conversation.find({ userId });

    const botResponse = await getChatGPTResponse([...conversation.map(c => ({
      role: c.role, content: c.content
    })), { role: 'user', content: message }], user.systemRole);

    await new Conversation({ userId, role: 'user', content: message }).save();
    await new Conversation({ userId, role: 'assistant', content: botResponse }).save();

    res.json({ response: botResponse });
  } catch (error) {
    console.error("ChatGPT API와 상호작용 중 오류:", error);
    res.status(500).json({ message: 'ChatGPT와의 상호작용 중 오류 발생' });
  }
});

// 서버 실행
app.listen(port, '0.0.0.0', () => {
  console.log(`서버가 실행 중입니다. http://localhost:${port}`);
});

