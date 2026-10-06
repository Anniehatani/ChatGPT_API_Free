// App Frontend Logic
document.addEventListener('DOMContentLoaded', () => {
    const messagesContainer = document.getElementById('messagesContainer');
    const userInput = document.getElementById('userInput');
    const btnSendMessage = document.getElementById('btnSendMessage');
    const btnNewChat = document.getElementById('btnNewChat');
    const btnRestartBrowser = document.getElementById('btnRestartBrowser');
    const logsStream = document.getElementById('logsStream');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    // Modal API elements
    const btnToggleApiModal = document.getElementById('btnToggleApiModal');
    const btnCloseApiModal = document.getElementById('btnCloseApiModal');
    const apiModal = document.getElementById('apiModal');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    let isBusy = false;

    // Configure marked for Markdown rendering
    if (window.marked) {
        marked.setOptions({
            breaks: true,
            highlight: function(code, lang) {
                if (window.hljs) {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                }
                return code;
            }
        });
    }

    // Auto resize textarea
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
    });

    // Enter to send, Shift + Enter for new line
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    btnSendMessage.addEventListener('click', () => {
        sendMessage();
    });

    btnNewChat.addEventListener('click', async () => {
        if (isBusy) return;
        setBusy(true);
        addLogItem({ message: 'Đang gửi yêu cầu tạo đoạn chat mới...', type: 'info' });

        try {
            const res = await fetch('/api/new-chat', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                messagesContainer.innerHTML = `
                    <div class="welcome-card" id="welcomeCard">
                        <div class="welcome-icon">⚡</div>
                        <h2>Đã Tạo Đoạn Chat Mới Thành Công</h2>
                        <p>Hội thoại trước đã được xóa sạch. Bạn có thể bắt đầu phiên hỏi đáp mới với ChatGPT.</p>
                        <div class="quick-prompts">
                            <button class="quick-btn" onclick="sendQuickPrompt('Giải thích ngắn gọn cơ chế hoạt động của Docker trong 3 gạch đầu dòng')">
                                🐳 Giải thích Docker trong 3 gạch đầu dòng
                            </button>
                            <button class="quick-btn" onclick="sendQuickPrompt('Viết một hàm Javascript tính số Fibonacci bằng đệ quy và memoization')">
                                💻 Viết hàm JS tính Fibonacci tối ưu
                            </button>
                        </div>
                    </div>
                `;
                addLogItem({ message: 'Đã tạo phiên chat mới thành công!', type: 'success' });
            } else {
                alert('Lỗi tạo đoạn chat mới: ' + data.error);
            }
        } catch (err) {
            alert('Lỗi kết nối server: ' + err.message);
        } finally {
            setBusy(false);
        }
    });

    btnRestartBrowser.addEventListener('click', async () => {
        if (confirm('Bạn có chắc muốn khởi động lại trình duyệt Chrome?')) {
            addLogItem({ message: 'Đang khởi động lại trình duyệt Chrome...', type: 'warning' });
            try {
                const res = await fetch('/api/browser/restart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ headless: false })
                });
                const data = await res.json();
                if (data.success) {
                    addLogItem({ message: 'Trình duyệt đã khởi động lại thành công!', type: 'success' });
                }
            } catch (err) {
                addLogItem({ message: 'Lỗi restart: ' + err.message, type: 'error' });
            }
        }
    });

    // Modal API events
    btnToggleApiModal.addEventListener('click', () => {
        apiModal.classList.add('active');
    });

    btnCloseApiModal.addEventListener('click', () => {
        apiModal.classList.remove('active');
    });

    apiModal.addEventListener('click', (e) => {
        if (e.target === apiModal) {
            apiModal.classList.remove('active');
        }
    });

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Send Message function
    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text || isBusy) return;

        // Remove welcome card if present
        const welcomeCard = document.getElementById('welcomeCard');
        if (welcomeCard) welcomeCard.remove();

        // Append user message
        appendMessage('user', text);
        userInput.value = '';
        userInput.style.height = 'auto';

        setBusy(true);

        // Placeholder for assistant
        const assistantRow = appendMessage('assistant', 'Đang gửi prompt vào ChatGPT và chờ cào phản hồi...');
        const bubble = assistantRow.querySelector('.message-bubble-content');

        try {
            const startTime = Date.now();
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });

            const data = await res.json();
            if (data.success) {
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                
                // Render markdown
                if (window.marked) {
                    bubble.innerHTML = marked.parse(data.reply);
                } else {
                    bubble.innerText = data.reply;
                }

                // Add meta stats
                const meta = assistantRow.querySelector('.message-meta');
                if (meta) {
                    meta.innerHTML = `
                        <span>Thời gian: ${duration}s • Model: ChatGPT Guest</span>
                        <button class="btn-copy-reply" onclick="copyReplyText(this)">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            Sao chép
                        </button>
                    `;
                }

                // Render KaTeX math formulas if available
                if (window.renderMathInElement) {
                    try {
                        renderMathInElement(bubble, {
                            delimiters: [
                                { left: '$$', right: '$$', display: true },
                                { left: '$', right: '$', display: false }
                            ],
                            throwOnError: false
                        });
                    } catch (e) {
                        console.warn('KaTeX render error:', e);
                    }
                }

                if (window.hljs) {
                    assistantRow.querySelectorAll('pre code').forEach((block) => {
                        hljs.highlightElement(block);
                    });
                }
            } else {
                bubble.innerHTML = `<span style="color: var(--danger)">Lỗi: ${data.error}</span>`;
            }
        } catch (err) {
            bubble.innerHTML = `<span style="color: var(--danger)">Lỗi kết nối tới server: ${err.message}</span>`;
        } finally {
            setBusy(false);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    function appendMessage(role, text) {
        const row = document.createElement('div');
        row.className = `message-row ${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerText = role === 'user' ? 'Bạn' : 'GPT';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        const content = document.createElement('div');
        content.className = 'message-bubble-content';
        content.innerText = text;

        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.innerHTML = `<span>${new Date().toLocaleTimeString('vi-VN')}</span>`;

        bubble.appendChild(content);
        bubble.appendChild(meta);

        if (role === 'user') {
            row.appendChild(bubble);
            row.appendChild(avatar);
        } else {
            row.appendChild(avatar);
            row.appendChild(bubble);
        }

        messagesContainer.appendChild(row);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return row;
    }

    function setBusy(busy) {
        isBusy = busy;
        btnSendMessage.disabled = busy;
        btnNewChat.disabled = busy;
        if (busy) {
            statusDot.className = 'status-dot busy';
            statusText.innerText = 'Đang xử lý / Cào câu trả lời...';
        } else {
            statusDot.className = 'status-dot pulsing';
            statusText.innerText = 'Sẵn sàng (ChatGPT Guest)';
        }
    }

    function addLogItem(log) {
        const item = document.createElement('div');
        item.className = `log-item ${log.type || 'info'}`;

        const time = document.createElement('span');
        time.className = 'log-time';
        time.innerText = log.timestamp || new Date().toLocaleTimeString('vi-VN');

        const text = document.createElement('span');
        text.className = 'log-text';
        text.innerText = log.message;

        item.appendChild(time);
        item.appendChild(text);

        logsStream.insertBefore(item, logsStream.firstChild);

        // Keep maximum 50 logs in UI
        while (logsStream.children.length > 50) {
            logsStream.removeChild(logsStream.lastChild);
        }
    }

    // Connect to Server-Sent Events (SSE) for real-time automation logs
    function setupSSE() {
        const evtSource = new EventSource('/api/events');

        evtSource.addEventListener('log', (event) => {
            const data = JSON.parse(event.data);
            addLogItem(data);
        });

        evtSource.addEventListener('status', (event) => {
            const data = JSON.parse(event.data);
            if (data.status === 'busy' || data.isBusy) {
                setBusy(true);
            } else if (data.status === 'ready') {
                setBusy(false);
            }
        });

        evtSource.onerror = () => {
            console.log('SSE connection lost, retrying in 3s...');
            evtSource.close();
            setTimeout(setupSSE, 3000);
        };
    }

    setupSSE();
});

// Quick prompt helper
window.sendQuickPrompt = function(promptText) {
    const input = document.getElementById('userInput');
    if (input) {
        input.value = promptText;
        input.dispatchEvent(new Event('input'));
        const btn = document.getElementById('btnSendMessage');
        if (btn) btn.click();
    }
};

// Copy code helper for API docs
window.copyCode = function(button) {
    const pre = button.parentElement.querySelector('pre');
    if (pre) {
        navigator.clipboard.writeText(pre.innerText).then(() => {
            const orig = button.innerText;
            button.innerText = 'Đã sao chép!';
            setTimeout(() => { button.innerText = orig; }, 2000);
        });
    }
};

// Copy assistant reply text
window.copyReplyText = function(button) {
    const bubble = button.closest('.message-bubble');
    const content = bubble ? bubble.querySelector('.message-bubble-content') : null;
    if (content) {
        navigator.clipboard.writeText(content.innerText).then(() => {
            button.innerText = 'Đã chép!';
            setTimeout(() => {
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Sao chép
                `;
            }, 2000);
        });
    }
};
