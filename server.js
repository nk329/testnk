import express from 'express';
import { google } from 'googleapis';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import axios from 'axios';
import bcrypt from 'bcrypt';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors()); // CORS 설정 추가

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 환경 변수로 API 키 설정

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    console.log('새로운 Refresh Token:', tokens.refresh_token);
  }
  console.log('새로운 Access Token:', tokens.access_token);
});

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// 사용자 등록 API
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword]
    );

    res.status(201).json({ message: '회원가입 성공!' });
  } catch (error) {
    res.status(500).json({ error: '회원가입 중 오류 발생' });
  }
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

function parseSchedule(message) {
  let title, month, day, startHour, startMinute, endHour, endMinute;
  
  // 내일 일정 처리
  const tomorrowFormat = /내일\s(\d{1,2})시\s(.*)/;
  const tomorrowMatch = message.match(tomorrowFormat);
  
  if (tomorrowMatch) {
    title = tomorrowMatch[2];
    startHour = tomorrowMatch[1];
    startMinute = '00'; // 분을 00으로 설정
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1); // 하루 더하기
    return {
      title,
      month: tomorrow.getMonth() + 1,
      day: tomorrow.getDate(),
      startHour,
      startMinute,
      endHour: startHour,
      endMinute: startMinute,
    };
  }
  // 형식 1: 슬래시 구분 (예: "회의 10/15 14:00부터 16:00까지")
  const format1 = /(\S+)\s(\d{1,2})\/(\d{1,2})\s(\d{1,2}):(\d{2})부터\s(\d{1,2}):(\d{2})까지/;
  const format1Match = message.match(format1);

  if (format1Match) {
    title = format1Match[1];
    month = format1Match[2];
    day = format1Match[3];
    startHour = format1Match[4];
    startMinute = format1Match[5];
    endHour = format1Match[6];
    endMinute = format1Match[7];
    return { title, month, day, startHour, startMinute, endHour, endMinute };
  }

  // 형식 2: 월, 일 구분 (예: "회의 10월 15일 14시부터 16시까지")
  const format2 = /(\S+)\s(\d{1,2})월\s(\d{1,2})일\s(\d{1,2})시부터\s(\d{1,2})시까지/;
  const format2Match = message.match(format2);

  if (format2Match) {
    title = format2Match[1];
    month = format2Match[2];
    day = format2Match[3];
    startHour = format2Match[4];
    endHour = format2Match[5];
    startMinute = '00';  // 시만 있을 경우 분을 00으로 설정
    endMinute = '00';
    return { title, month, day, startHour, startMinute, endHour, endMinute };
  }

  // 형식 3: 간단한 형식 처리 (예: "10/11~10/12 17시")
  const format3 = /(\S+)\s(\d{1,2})\/(\d{1,2})~(\d{1,2})\/(\d{1,2})\s(\d{1,2})시/;
  const format3Match = message.match(format3);
  
  if (format3Match) {
    title = format3Match[1];
    const startMonth = format3Match[2];
    const startDay = format3Match[3];
    const endMonth = format3Match[4];
    const endDay = format3Match[5];
    startHour = format3Match[6];
    startMinute = '00'; // 기본값으로 분 설정
    endHour = startHour; // 끝 시간도 동일하게 설정
    endMinute = '00';
    return { title, month: startMonth, day: startDay, startHour, startMinute, endHour, endMinute };
  }

  // 형식 4: 특정한 형식으로 예를 들어 "10/11 17시" 또는 "10/11 오후 5시"
  const format4 = /(\S+)\s(\d{1,2})\/(\d{1,2})\s(오후|오전)?\s?(\d{1,2})시/;
  const format4Match = message.match(format4);
  
  if (format4Match) {
    title = format4Match[1];
    month = format4Match[2];
    day = format4Match[3];
    const meridiem = format4Match[4];
    const hour = format4Match[5];
    startHour = meridiem === '오후' ? parseInt(hour) + 12 : hour; // 오전/오후 처리
    startMinute = '00'; // 분 기본값
    endHour = startHour; // 끝 시간을 동일하게 설정
    endMinute = '00';
    return { title, month, day, startHour, startMinute, endHour, endMinute };
  }

  // 둘 중 하나의 형식에도 맞지 않는 경우 null 반환
  return null;
}


// /api/chat POST 요청에서 일정 추가 처리
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // 일정 명령인 경우 처리
    const scheduleData = parseSchedule(message);
    if (scheduleData) {
      const { title, month, day, startHour, startMinute, endHour, endMinute } = scheduleData;

      const currentYear = new Date().getFullYear();
      const startTime = new Date(currentYear, month - 1, day, startHour, startMinute).toISOString();
      const endTime = new Date(currentYear, month - 1, day, endHour, endMinute).toISOString();

      // Google Calendar 이벤트 생성
      const event = {
        summary: title,
        start: { dateTime: startTime, timeZone: 'Asia/Seoul' },
        end: { dateTime: endTime, timeZone: 'Asia/Seoul' },
      };

      const calendarResponse = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      res.json({ reply: `일정이 추가되었습니다: ${title}`, event: calendarResponse.data });
    } else {
      // 일정 명령이 아닌 일반 질문 처리 (OpenAI API 사용)
      const openAiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: message }],
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // OpenAI 응답에서 텍스트 추출
      const reply = openAiResponse.data.choices[0].message.content;
      res.json({ reply });
    }
  } catch (error) {
    console.error('Error processing chat or adding event:', error);
    res.status(500).json({ error: '처리 중 오류 발생', details: error.message });
  }
});

// 구글 캘린더 이벤트 가져오기
app.get('/api/events', async (req, res) => {
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: (new Date()).toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    res.json(response.data.items);
  } catch (error) {
    console.error('Error fetching events:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Error fetching events', details: error.message });
  }
});

// 일정 추가 API
app.post('/api/add-event', async (req, res) => {
  try {
    const event = req.body;
    console.log('Received event:', event); // 요청 데이터 로그 출력
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error adding event:', error); // 오류 메시지 로그 출력
    res.status(500).json({ error: 'Error adding event' });
  }
});

// 일정 삭제 API
app.delete('/api/delete-event/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
    res.json({ message: '이벤트 삭제됨' });
  } catch (error) {
    console.error('Error deleting event:', error); // 오류 메시지 로그 출력
    res.status(500).json({ error: 'Error deleting event' });
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`Server running on port ${process.env.PORT || 3001}`);
});
