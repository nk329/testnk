import React, { useState } from 'react';
import './Chatbot.css';

function Chatbot() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const handleSendMessage = () => {
    if (input.trim() === '') return;

    const userMessage = { text: input, isUser: true };
    setMessages([...messages, userMessage]);

    fetch('http://localhost:3001/api/chat', { // 서버의 API 엔드포인트
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: input }),
    })
      .then(response => response.json())
      .then(data => {
        const botMessage = { text: data.reply, isUser: false };
        setMessages([...messages, userMessage, botMessage]);

        if (data.event) {
          const eventMessage = { text: `일정 추가됨: ${data.event.summary}`, isUser: false };
          setMessages([...messages, userMessage, botMessage, eventMessage]);
        }
      })
      .catch(err => {
        console.error('Error:', err);
        const errorMessage = { text: '챗봇과 통신 중 오류 발생.', isUser: false };
        setMessages([...messages, userMessage, errorMessage]);
      });

    setInput('');
  };

  return (
    <div className="chatbox">
      <div className="messages">
        {messages.map((msg, index) => (
          <div key={index} className={msg.isUser ? 'message user' : 'message bot'}>
            {msg.text}
          </div>
        ))}
      </div>
      <div className="input-box">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button onClick={handleSendMessage}>전송</button>
      </div>
    </div>
  );
}

export default Chatbot;
