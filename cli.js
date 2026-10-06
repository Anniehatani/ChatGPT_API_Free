#!/usr/bin/env node

const http = require('http');
const readline = require('readline');

const API_PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${API_PORT}`;

// Colors for terminal output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    gray: "\x1b[90m"
};

function postRequest(endpoint, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const options = {
            hostname: 'localhost',
            port: API_PORT,
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 120000
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve(parsed);
                } catch (e) {
                    resolve({ success: false, raw: body });
                }
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error(`Không thể kết nối tới server tại ${API_URL}.\nVui lòng chạy 'npm start' ở một terminal khác trước!`));
            } else {
                reject(err);
            }
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Yêu cầu quá thời gian chờ (timeout 120s).'));
        });

        req.write(payload);
        req.end();
    });
}

async function sendPrompt(message, isNew = false) {
    process.stdout.write(`${colors.gray}⏳ Đang gửi prompt vào ChatGPT và chờ cào câu trả lời...${colors.reset}\r`);
    const startTime = Date.now();

    try {
        const res = await postRequest('/api/chat', { message, newChat: isNew });
        process.stdout.write(' '.repeat(65) + '\r'); // Clear line

        if (res.success && res.reply) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n${colors.bright}${colors.green}🤖 ChatGPT (${duration}s):${colors.reset}\n`);
            console.log(res.reply);
            console.log(`\n${colors.gray}------------------------------------------------------------${colors.reset}`);
        } else {
            console.log(`\n${colors.red}❌ Lỗi: ${res.error || res.raw || 'Không nhận được câu trả lời'}${colors.reset}\n`);
        }
    } catch (err) {
        process.stdout.write(' '.repeat(65) + '\r');
        console.log(`\n${colors.red}❌ ${err.message}${colors.reset}\n`);
    }
}

async function main() {
    // If user provided prompt as arguments: e.g. node cli.js "Tính tích phân..."
    const args = process.argv.slice(2);
    if (args.length > 0) {
        const prompt = args.join(' ');
        console.log(`${colors.cyan}💬 Câu hỏi:${colors.reset} ${prompt}`);
        await sendPrompt(prompt);
        process.exit(0);
    }

    // Interactive REPL Mode
    console.log(`\n${colors.bright}${colors.cyan}==============================================================${colors.reset}`);
    console.log(`${colors.bright}🤖 ChatGPT Terminal API Client (Hỏi Đáp Trực Tiếp)${colors.reset}`);
    console.log(`${colors.gray}Server: ${API_URL}${colors.reset}`);
    console.log(`- Nhập câu hỏi và nhấn ${colors.bright}[Enter]${colors.reset} để nhận câu trả lời.`);
    console.log(`- Gõ ${colors.yellow}'/new'${colors.reset} để tạo đoạn chat mới.`);
    console.log(`- Gõ ${colors.yellow}'/exit'${colors.reset} để thoát.`);
    console.log(`${colors.bright}${colors.cyan}==============================================================${colors.reset}\n`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${colors.bright}${colors.cyan}Bạn > ${colors.reset}`
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        if (input.toLowerCase() === '/exit' || input.toLowerCase() === 'exit') {
            console.log(`${colors.gray}Tạm biệt!${colors.reset}`);
            process.exit(0);
        }

        if (input.toLowerCase() === '/new' || input.toLowerCase() === 'new') {
            console.log(`${colors.yellow}Đang tạo đoạn chat mới...${colors.reset}`);
            try {
                const res = await postRequest('/api/new-chat', {});
                console.log(`${colors.green}✔ ${res.message || 'Đã tạo đoạn chat mới!'}${colors.reset}\n`);
            } catch (e) {
                console.log(`${colors.red}❌ ${e.message}${colors.reset}\n`);
            }
            rl.prompt();
            return;
        }

        await sendPrompt(input);
        rl.prompt();
    });

    rl.on('close', () => {
        console.log(`\n${colors.gray}Đã đóng CLI.${colors.reset}`);
        process.exit(0);
    });
}

main();
