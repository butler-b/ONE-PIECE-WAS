const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const dotenv = require('dotenv');
const OpenAI = require("openai");

// 환경 변수 로드
dotenv.config();

// MongoDB 연결 설정
mongoose.connect(process.env.MONGO_URI, {
  // 추가 설정 가능
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
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
const port = 8080;  // 포트 설정 수정

app.use(express.json());
app.use(express.urlencoded({ extended: true }));  // URL-encoded 데이터를 처리

app.set('view engine', 'ejs');

// OpenAI 설정
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set.");
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'default-api-key',  // 환경 변수가 없을 경우 기본값 추가
});

// ChatGPT API와 상호작용하는 함수
async function getChatGPTResponse(messages, systemRole) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemRole || "You are a helpful assistant."
        },
        ...messages // 이전 대화 기록 추가
      ],
      temperature: 1,
      max_tokens: 256,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error interacting with ChatGPT API:", error);
    throw error;
  }
}

// JWT 인증 미들웨어
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).send('Access Denied');
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(400).send('Invalid Token');
  }
};

// 사용자 등록 라우트
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ token, message: 'User registered successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// 사용자 목록 조회 라우트 (GET /users)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find(); // 모든 사용자 가져오기
    res.status(200).send(users);
  } catch (error) {
    res.status(500).send({ message: 'Error fetching users' });
  }
});

// 로그인 라우트
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, message: 'Login successful!' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// 대화 기록과 ChatGPT와의 상호작용
app.all('/api/chatbot', authenticateToken, async (req, res) => {
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

    res.send({ response: botResponse });
  } catch (error) {
    console.error("Error interacting with ChatGPT API:", error);
    res.status(500).send({ message: 'Error interacting with ChatGPT API' });
  }
});

// 서버 실행
app.listen(port, '0.0.0.0', () => {
  console.log(`App running on http://localhost:${port}`);
});

