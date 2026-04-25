require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const SYSTEM_PROMPT = require('./prompt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory conversation store (keyed by session id)
const sessions = {};

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ error: 'sessionId and message are required.' });
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  sessions[sessionId].push({ role: 'user', content: message });

  try {
    // Stream the response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await client.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: sessions[sessionId],
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        const text = chunk.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    sessions[sessionId].push({ role: 'assistant', content: fullResponse });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Anthropic error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Clear session
app.post('/api/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
  }
  res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: 'claude-opus-4-5' });
});

app.listen(PORT, () => {
  console.log(`\n🎬 Video Edit Co-Pilot running at http://localhost:${PORT}\n`);
});
