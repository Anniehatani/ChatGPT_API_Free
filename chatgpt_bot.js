const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

puppeteer.use(StealthPlugin());

class ChatGPTBot extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.browser = null;
        this.page = null;
        this.isBusy = false;
        this.status = 'idle'; // 'starting', 'ready', 'busy', 'error'
        this.profileDir = path.join(__dirname, 'chatgpt_profile');
        this.chromePath = this.detectBrowserPath();
        this.popupWatcherInterval = null;
        this.recentLogs = [];

        if (!fs.existsSync(this.profileDir)) {
            fs.mkdirSync(this.profileDir, { recursive: true });
        }
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString('vi-VN');
        const logEntry = { timestamp, message, type };
        console.log(`[ChatGPTBot ${timestamp}] ${message}`);
        this.recentLogs.unshift(logEntry);
        if (this.recentLogs.length > 50) this.recentLogs.pop();
        this.emit('log', logEntry);
    }

    detectBrowserPath() {
        const paths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        for (const p of paths) {
            if (p && fs.existsSync(p)) {
                return p;
            }
        }
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    async init(headless = true) {
        if (this.browser) return;

        this.status = 'starting';
        this.log(`Khởi chạy trình duyệt Chrome ngầm (Headless: ${headless})...`);

        this.browser = await puppeteer.launch({
            executablePath: this.chromePath,
            headless: headless ? 'new' : false,
            userDataDir: this.profileDir,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1280,900'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const pages = await this.browser.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 900 });
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');

        this.browser.on('disconnected', () => {
            this.log('Trình duyệt đã bị đóng.', 'warning');
            this.stopPopupWatcher();
            this.browser = null;
            this.page = null;
            this.status = 'uninitialized';
            this.emit('status', { status: this.status });
        });

        this.log('Đang truy cập https://chatgpt.com (Chế độ Khách - Không cần đăng nhập)...');
        try {
            await this.page.goto('https://chatgpt.com', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
        } catch (e) {
            this.log(`Tải trang: ${e.message}`, 'warning');
        }

        // Handle any immediate cookie / startup banners
        await this.handlePopups();

        // Start background watcher for popups (Clear chat dialog, Login modal 'X', cookies)
        this.startPopupWatcher();

        this.status = 'ready';
        this.log('ChatGPT đã sẵn sàng nhận câu hỏi!', 'success');
        this.emit('status', { status: this.status });
    }

    startPopupWatcher() {
        if (this.popupWatcherInterval) clearInterval(this.popupWatcherInterval);

        this.popupWatcherInterval = setInterval(async () => {
            if (!this.page || this.page.isClosed()) return;
            try {
                await this.handlePopups();
            } catch (err) {
                // Ignore transient evaluation errors when page is navigating
            }
        }, 800);
    }

    stopPopupWatcher() {
        if (this.popupWatcherInterval) {
            clearInterval(this.popupWatcherInterval);
            this.popupWatcherInterval = null;
        }
    }

    /**
     * Handles popups automatically:
     * 1. "Clear current chat?" -> Click "Clear chat"
     * 2. Login / Sign-up dialog -> Click "X" close button
     * 3. Cookie / Stay logged out banners -> Click "Accept all" / "Stay logged out"
     */
    async handlePopups() {
        if (!this.page || this.page.isClosed()) return [];

        try {
            const actions = await this.page.evaluate(() => {
                const results = [];

                function isVisible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 20;
                }

                // 1. Check for "Clear current chat?" modal (As shown in user's image)
                const clearDialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], div')).filter(d => {
                    const text = d.innerText || '';
                    return (text.includes('Clear current chat?') || text.includes('Xóa đoạn chat')) && isVisible(d);
                });

                for (const d of clearDialogs) {
                    const buttons = Array.from(d.querySelectorAll('button')).filter(isVisible);
                    for (const b of buttons) {
                        const bText = b.innerText.trim().toLowerCase();
                        if (bText === 'clear chat' || bText === 'xóa đoạn chat' || bText === 'clear') {
                            b.click();
                            results.push({ action: 'clear_chat', message: 'Tự động nhấn "Clear chat" tạo hội thoại mới' });
                            return results;
                        }
                    }
                }

                // 2. Check for Login / Sign up modal (after sending or idle) -> Click "X" to dismiss
                const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [data-state="open"]')).filter(d => {
                    if (!isVisible(d)) return false;
                    if (d.dataset.dismissAttempted && Date.now() - Number(d.dataset.dismissAttempted) < 3000) return false;
                    const text = (d.innerText || '');
                    return (
                        (text.includes('Sign up') || text.includes('Log in') || text.includes('Đăng nhập') || text.includes('Try advanced features') || text.includes('Get smarter responses')) &&
                        !text.includes('Clear current chat?')
                    );
                });

                for (const d of dialogs) {
                    const closeBtns = Array.from(d.querySelectorAll('button')).filter(isVisible);
                    for (const b of closeBtns) {
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        const bText = b.innerText.trim();
                        if (
                            aria === 'close' || aria === 'đóng' || aria === 'dismiss' ||
                            bText === '✕' || bText === '×' || bText === 'Close'
                        ) {
                            d.dataset.dismissAttempted = String(Date.now());
                            b.click();
                            results.push({ action: 'dismiss_login', message: 'Tự động nhấn nút [X] đóng popup đăng nhập' });
                            return results;
                        }
                    }

                    // Try finding SVG with path resembling a cross
                    const svgs = Array.from(d.querySelectorAll('button svg'));
                    for (const svg of svgs) {
                        const parentBtn = svg.closest('button');
                        if (parentBtn && isVisible(parentBtn)) {
                            d.dataset.dismissAttempted = String(Date.now());
                            parentBtn.click();
                            results.push({ action: 'dismiss_login_svg', message: 'Tự động nhấn biểu tượng [X] đóng popup đăng nhập' });
                            return results;
                        }
                    }
                }

                // 3. Cookie banners or "Stay logged out"
                const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
                for (const b of buttons) {
                    const t = b.innerText.trim().toLowerCase();
                    if (t === 'accept all' || t === 'stay logged out' || t === 'continue without signing in') {
                        b.click();
                        results.push({ action: 'dismiss_cookie', message: `Tự động nhấn "${b.innerText.trim()}"` });
                        return results;
                    }
                }

                return results;
            });

            if (actions && actions.length > 0) {
                for (const act of actions) {
                    this.log(act.message, 'info');
                }
            }
            return actions;
        } catch (err) {
            return [];
        }
    }

    async newChat() {
        if (!this.page) {
            throw new Error('Trình duyệt chưa được khởi động.');
        }

        if (this.isBusy) {
            throw new Error('Đang xử lý câu hỏi, vui lòng chờ...');
        }

        this.isBusy = true;
        this.status = 'busy';
        this.log('Bắt đầu tạo đoạn chat mới...', 'info');

        try {
            // Step 1: Click "New chat" button in ChatGPT interface
            let clicked = await this.page.evaluate(() => {
                const newChatEl = document.querySelector('a[aria-label="New chat"], button[aria-label="New chat"], a[href="/"], a[href*="recent_chat_failed"]');
                if (newChatEl) {
                    newChatEl.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                this.log('Đã nhấn nút "New chat" trên giao diện ChatGPT.', 'info');
            } else {
                this.log('Không tìm thấy nút New chat, điều hướng lại https://chatgpt.com...', 'info');
                await this.page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
            }

            // Step 2: Wait briefly and handle "Clear current chat?" modal if it appears
            await new Promise(r => setTimeout(r, 1000));
            await this.handlePopups();

            // Step 3: Wait for textarea to be ready
            await this.page.waitForFunction(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('textarea');
                return !!ta;
            }, { timeout: 15000 });

            this.log('Đoạn chat mới đã được tạo thành công!', 'success');
            return { success: true, message: 'Đã tạo đoạn chat mới trên ChatGPT.' };
        } catch (err) {
            this.log(`Lỗi khi tạo đoạn chat mới: ${err.message}`, 'error');
            throw err;
        } finally {
            this.isBusy = false;
            this.status = 'ready';
            this.emit('status', { status: this.status });
        }
    }

    async sendMessage(prompt, options = {}) {
        if (!this.page) {
            throw new Error('Trình duyệt chưa được khởi động.');
        }

        if (this.isBusy) {
            throw new Error('ChatGPT đang tạo câu trả lời. Vui lòng đợi hoàn tất.');
        }

        this.isBusy = true;
        this.status = 'busy';
        this.emit('status', { status: this.status });

        try {
            this.log(`Nhận câu hỏi (${prompt.length} ký tự): "${prompt.slice(0, 60)}..."`, 'info');

            // Pre-check and clear popups
            await this.handlePopups();

            // Check if prompt textarea exists
            let textarea = await this.page.$('#prompt-textarea, textarea, div[contenteditable="true"]');
            if (!textarea) {
                this.log('Không thấy ô nhập, điều hướng lại https://chatgpt.com...', 'warning');
                await this.page.goto('https://chatgpt.com', { waitUntil: 'networkidle2', timeout: 30000 });
                await this.handlePopups();
                textarea = await this.page.waitForSelector('#prompt-textarea, textarea, div[contenteditable="true"]', { timeout: 15000 });
            }

            // Get initial count of assistant responses
            const initialCount = await this.page.evaluate(() => {
                const assistantEls = document.querySelectorAll('li[data-message-role="assistant"], [data-message-author-role="assistant"], article');
                return assistantEls.length;
            });

            // Focus and enter prompt
            await textarea.click();
            await this.page.evaluate((text) => {
                const ta = document.querySelector('#prompt-textarea') || 
                           document.querySelector('textarea') || 
                           document.querySelector('div[contenteditable="true"]');
                if (!ta) return false;

                ta.focus();
                if (ta.tagName.toLowerCase() === 'textarea') {
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeSetter.call(ta, text);
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (ta.isContentEditable) {
                    ta.innerText = text;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return true;
            }, prompt);

            await new Promise(r => setTimeout(r, 300));

            // Trigger Send (Click send button or press Enter)
            const sendClicked = await this.page.evaluate(() => {
                const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Gửi tin nhắn"]');
                if (sendBtn && !sendBtn.disabled) {
                    sendBtn.click();
                    return true;
                }
                return false;
            });

            if (!sendClicked) {
                this.log('Gửi prompt qua phím Enter...', 'info');
                await this.page.keyboard.press('Enter');
            } else {
                this.log('Đã nhấn nút Gửi (Send).', 'info');
            }

            // Immediately check and dismiss any login modal that pops up after sending
            await new Promise(r => setTimeout(r, 600));
            await this.handlePopups();

            // Wait for response to begin and complete
            this.log('Đang chờ ChatGPT phản hồi và sao chép câu trả lời...', 'info');
            const startTime = Date.now();
            const timeoutMs = options.timeout || 120000;
            let lastText = '';
            let stableCount = 0;
            let hasStarted = false;

            while (Date.now() - startTime < timeoutMs) {
                await new Promise(r => setTimeout(r, 600));

                // Continually dismiss any login popup or limit dialog
                await this.handlePopups();

                const state = await this.page.evaluate(() => {
                    // Check if limit reached or session expired
                    const bodyText = document.body ? document.body.innerText : '';
                    const isLimitReached = (
                        bodyText.includes("You've reached our limit") ||
                        bodyText.includes("Too many requests") ||
                        bodyText.includes("Clear current chat?")
                    );

                    // Check stop button (streaming indicator)
                    const stopBtn = document.querySelector(
                        'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Dừng tạo"]'
                    );
                    const isStreaming = !!stopBtn || !!document.querySelector('.result-streaming');

                    // Extract assistant messages
                    const assistantList = Array.from(document.querySelectorAll('li[data-message-role="assistant"], [data-message-author-role="assistant"]'));
                    let replyText = '';
                    let replyHtml = '';

                    function extractCleanText(root) {
                        if (!root) return '';
                        const clone = root.cloneNode(true);

                        // 1. Convert KaTeX display / block math (.katex-display, .math.math-display, [data-katex-display])
                        clone.querySelectorAll('.katex-display, .math.math-display, div[data-display="true"]').forEach(kd => {
                            const annotation = kd.querySelector('annotation[encoding="application/x-tex"], annotation');
                            let tex = annotation ? annotation.textContent.trim() : (kd.getAttribute('data-tex') || '');
                            if (tex) {
                                kd.replaceWith(document.createTextNode('\n\n$$\n' + tex + '\n$$\n\n'));
                            }
                        });

                        // 2. Convert KaTeX inline math (.katex, .math.math-inline)
                        clone.querySelectorAll('.katex, .math.math-inline').forEach(k => {
                            if (!k.isConnected) return;
                            const annotation = k.querySelector('annotation[encoding="application/x-tex"], annotation');
                            let tex = annotation ? annotation.textContent.trim() : (k.getAttribute('data-tex') || '');
                            if (tex) {
                                if (tex.includes('\n') || tex.length > 80 || /\\begin\{(aligned|align|matrix|cases)/.test(tex)) {
                                    k.replaceWith(document.createTextNode('\n\n$$\n' + tex + '\n$$\n\n'));
                                } else {
                                    k.replaceWith(document.createTextNode(' $' + tex + '$ '));
                                }
                            }
                        });

                        // 3. Preserve Code Blocks cleanly with language
                        clone.querySelectorAll('pre').forEach(pre => {
                            const codeEl = pre.querySelector('code');
                            let lang = '';
                            if (codeEl) {
                                const m = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/);
                                if (m) lang = m[1];
                            }
                            let codeText = codeEl ? codeEl.innerText : pre.innerText;
                            codeText = codeText.replace(/^Copy code\s*/i, '').trim();
                            pre.replaceWith(document.createTextNode('\n```' + lang + '\n' + codeText + '\n```\n'));
                        });

                        // 4. Remove attribution headers ("ChatGPT said:")
                        clone.querySelectorAll('h4[data-message-attribution], h4').forEach(h => {
                            if (h.innerText && h.innerText.includes('ChatGPT said')) h.remove();
                        });

                        // 5. Remove response action buttons (Copy, Share) and banners
                        clone.querySelectorAll('[data-assistant-message-actions], [data-message-actions], [data-conversation-inline-beacon], button').forEach(el => {
                            el.remove();
                        });

                        // Temporarily mount clone into document so innerText layout calculations are 100% accurate
                        const tempContainer = document.createElement('div');
                        tempContainer.style.cssText = 'position: absolute; left: -9999px; top: -9999px; opacity: 0; pointer-events: none;';
                        tempContainer.appendChild(clone);
                        document.body.appendChild(tempContainer);

                        let text = clone.innerText || '';
                        tempContainer.remove();

                        text = text.replace(/^ChatGPT said:\s*/i, '');
                        text = text.replace(/\n*ChatGPT is AI and can make mistakes\..*$/i, '');
                        text = text.replace(/\n*ChatGPT có thể mắc lỗi\..*$/i, '');
                        return text.trim();
                    }

                    if (assistantList.length > 0) {
                        const lastAssistant = assistantList[assistantList.length - 1];
                        replyText = extractCleanText(lastAssistant);
                        replyHtml = lastAssistant.innerHTML || '';
                    } else {
                        // Fallback: check transcript script tag
                        const scriptEl = document.querySelector('#octane-conversation-transcript');
                        if (scriptEl && scriptEl.textContent) {
                            try {
                                const parsed = JSON.parse(scriptEl.textContent);
                                if (parsed && parsed.rows && parsed.rows.length > 0) {
                                    const lastRow = parsed.rows[parsed.rows.length - 1];
                                    if (lastRow.role === 'assistant' && lastRow.text) {
                                        replyText = lastRow.text.trim();
                                    }
                                }
                            } catch (e) {}
                        }
                    }

                    return {
                        isStreaming,
                        isLimitReached,
                        replyText,
                        replyHtml,
                        assistantCount: assistantList.length
                    };
                });

                // If limit reached, automatically click clear chat and restart
                if (state.isLimitReached) {
                    this.log('Phát hiện thông báo giới hạn / hết hạn đoạn chat, tự động tạo mới...', 'warning');
                    await this.newChat();
                    // Retry sending the message in the clean chat
                    this.isBusy = false;
                    return await this.sendMessage(prompt, options);
                }

                if (state.replyText && state.replyText.length > 0) {
                    hasStarted = true;
                }

                if (hasStarted) {
                    if (state.replyText === lastText) {
                        stableCount++;
                        // If text is unchanged for ~1.8s and not streaming => finished!
                        if (stableCount >= 3 && !state.isStreaming) {
                            const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
                            this.log(`Phản hồi hoàn tất! (${state.replyText.length} ký tự, ${durationSec}s)`, 'success');
                            return {
                                success: true,
                                response: state.replyText,
                                html: state.replyHtml,
                                durationMs: Date.now() - startTime
                            };
                        }
                    } else {
                        lastText = state.replyText;
                        stableCount = 0;
                    }
                }
            }

            if (lastText && lastText.length > 0) {
                this.log('Hết thời gian chờ, gửi lại nội dung nhận được.', 'warning');
                return {
                    success: true,
                    response: lastText,
                    durationMs: Date.now() - startTime,
                    warning: 'Phản hồi có thể chưa hoàn thành do timeout.'
                };
            }

            throw new Error('Quá thời gian chờ (120s) nhưng không nhận được phản hồi từ ChatGPT.');
        } catch (err) {
            this.log(`Lỗi trong quá trình gửi: ${err.message}`, 'error');
            throw err;
        } finally {
            this.isBusy = false;
            this.status = 'ready';
            this.emit('status', { status: this.status });
        }
    }

    getStatus() {
        return {
            status: this.status,
            isBusy: this.isBusy,
            isBrowserOpen: !!this.browser,
            activeModel: 'ChatGPT (Guest Mode - Không cần đăng nhập)',
            recentLogs: this.recentLogs.slice(0, 20)
        };
    }

    async close() {
        this.stopPopupWatcher();
        if (this.browser) {
            this.log('Đóng trình duyệt...', 'info');
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.status = 'uninitialized';
        }
    }
}

module.exports = ChatGPTBot;
