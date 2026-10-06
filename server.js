const express = require('express');
const cors = require('cors');
const path = require('path');
const ChatGPTBot = require('./chatgpt_bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize ChatGPT bot
const bot = new ChatGPTBot();

// Connected SSE clients for live updates
const sseClients = new Set();

function broadcastEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.write(payload);
    }
}

bot.on('log', (logEntry) => {
    broadcastEvent('log', logEntry);
});

bot.on('status', (statusData) => {
    broadcastEvent('status', statusData);
});

// SSE endpoint for dashboard real-time updates
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial status
    res.write(`event: status\ndata: ${JSON.stringify(bot.getStatus())}\n\n`);

    sseClients.add(res);

    req.on('close', () => {
        sseClients.delete(res);
    });
});

// Status check API
app.get('/api/status', (req, res) => {
    res.json(bot.getStatus());
});

// Create new chat
app.post('/api/new-chat', async (req, res) => {
    try {
        const result = await bot.newChat();
        res.json({ success: true, message: result.message });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Send chat message
app.post('/api/chat', async (req, res) => {
    const { message, newChat } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Tham số "message" không được để trống.' });
    }

    try {
        if (newChat) {
            await bot.newChat();
        }

        const result = await bot.sendMessage(message.trim());
        res.json({
            success: true,
            reply: result.response,
            html: result.html,
            durationMs: result.durationMs,
            model: 'chatgpt-guest'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// OpenAI compatible completions endpoint: POST /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
    const { messages, model } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
            error: { message: 'Messages array is required', type: 'invalid_request_error' }
        });
    }

    // Extract latest user prompt
    const userMessages = messages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1];

    if (!lastUserMessage || !lastUserMessage.content) {
        return res.status(400).json({
            error: { message: 'No user message found', type: 'invalid_request_error' }
        });
    }

    try {
        const result = await bot.sendMessage(lastUserMessage.content);
        const completionId = 'chatcmpl-' + Math.random().toString(36).substring(2, 15);

        res.json({
            id: completionId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model || 'chatgpt-free',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: result.response
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: Math.ceil(lastUserMessage.content.length / 4),
                completion_tokens: Math.ceil(result.response.length / 4),
                total_tokens: Math.ceil((lastUserMessage.content.length + result.response.length) / 4)
            }
        });
    } catch (err) {
        res.status(500).json({
            error: { message: err.message, type: 'api_error' }
        });
    }
});

// Restart or open browser
app.post('/api/browser/restart', async (req, res) => {
    try {
        const { headless = false } = req.body;
        await bot.close();
        await bot.init(headless);
        res.json({ success: true, message: 'Đã khởi động lại trình duyệt ChatGPT thành công.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const { exec } = require('child_process');

// Start Express server and launch bot
app.listen(PORT, async () => {
    console.log(`=======================================================`);
    console.log(`🚀 ChatGPT Auto-Tool & Free API Server đã sẵn sàng!`);
    console.log(`🌐 Giao diện Web:   http://localhost:${PORT}`);
    console.log(`💬 Chat Terminal:   npm run cli (hoặc: node cli.js)`);
    console.log(`⚡ Gọi trực tiếp:   node cli.js "câu hỏi của bạn"`);
    console.log(`📡 Cổng API:        POST http://localhost:${PORT}/api/chat`);
    console.log(`=======================================================`);

    try {
        // Run Chrome in headless mode so no annoying blank/black window appears
        const isHeadless = process.env.HEADLESS === 'false' ? false : true;
        await bot.init(isHeadless);

        // Auto open dashboard in user's default browser
        exec(`start http://localhost:${PORT}`);
    } catch (err) {
        console.error('Lỗi khởi động ChatGPT bot:', err.message);
    }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nĐang dừng server...');
    await bot.close();
    process.exit(0);
});
