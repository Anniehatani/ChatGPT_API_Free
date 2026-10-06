const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

puppeteer.use(StealthPlugin());

class DeepSeekBot {
    constructor(options = {}) {
        this.options = options;
        this.browser = null;
        this.page = null;
        this.isBusy = false;
        this.isLoggedIn = false;
        this.status = 'idle'; // 'uninitialized', 'starting', 'need_login', 'ready', 'busy'
        this.profileDir = path.join(__dirname, 'chrome_profile');
        this.chromePath = this.detectBrowserPath();
        
        // Ensure profile directory exists
        if (!fs.existsSync(this.profileDir)) {
            fs.mkdirSync(this.profileDir, { recursive: true });
        }
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

    async init(headless = false) {
        if (this.browser) {
            return;
        }

        this.status = 'starting';
        console.log(`[DeepSeekBot] Đang khởi chạy trình duyệt... (Headless: ${headless})`);
        console.log(`[DeepSeekBot] Sử dụng profile lưu tại: ${this.profileDir}`);
        console.log(`[DeepSeekBot] Trình duyệt thực thi: ${this.chromePath}`);

        this.browser = await puppeteer.launch({
            executablePath: this.chromePath,
            headless: headless,
            userDataDir: this.profileDir,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1280,850'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const pages = await this.browser.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();

        // Listen for close events
        this.browser.on('disconnected', () => {
            console.log('[DeepSeekBot] Trình duyệt đã bị đóng.');
            this.browser = null;
            this.page = null;
            this.isLoggedIn = false;
            this.status = 'uninitialized';
        });

        console.log('[DeepSeekBot] Đang mở trang DeepSeek Chat (https://chat.deepseek.com)...');
        try {
            await this.page.goto('https://chat.deepseek.com', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
        } catch (e) {
            console.log('[DeepSeekBot] Cảnh báo khi tải trang:', e.message);
        }

        await this.checkLoginStatus();
    }

    async checkLoginStatus() {
        if (!this.page) {
            this.isLoggedIn = false;
            this.status = 'uninitialized';
            return { isLoggedIn: false, status: this.status };
        }

        try {
            const currentUrl = this.page.url();
            console.log(`[DeepSeekBot] URL hiện tại: ${currentUrl}`);

            if (currentUrl.includes('/sign_in') || currentUrl.includes('/login')) {
                this.isLoggedIn = false;
                this.status = 'need_login';
                return { isLoggedIn: false, status: 'need_login', url: currentUrl };
            }

            // Check if chat textarea exists
            const hasChatInput = await this.page.evaluate(() => {
                const ta = document.querySelector('textarea.ds-textarea__textarea') || 
                           document.querySelector('textarea') ||
                           document.querySelector('div[contenteditable="true"]');
                return !!ta;
            });

            if (hasChatInput) {
                this.isLoggedIn = true;
                this.status = this.isBusy ? 'busy' : 'ready';
                return { isLoggedIn: true, status: this.status, url: currentUrl };
            }

            // If neither /sign_in nor textarea, could be loading or splash screen
            const isNeedLoginText = await this.page.evaluate(() => {
                const text = document.body ? document.body.innerText : '';
                return text.includes('Log in') || text.includes('Đăng nhập') || text.includes('Sign up');
            });

            if (isNeedLoginText) {
                this.isLoggedIn = false;
                this.status = 'need_login';
            } else {
                this.isLoggedIn = true;
                this.status = this.isBusy ? 'busy' : 'ready';
            }

            return { isLoggedIn: this.isLoggedIn, status: this.status, url: currentUrl };
        } catch (err) {
            console.error('[DeepSeekBot] Lỗi kiểm tra trạng thái đăng nhập:', err.message);
            return { isLoggedIn: this.isLoggedIn, status: this.status, error: err.message };
        }
    }

    async bringToFront() {
        if (this.page) {
            try {
                await this.page.bringToFront();
            } catch (e) {}
        }
    }

    async newChat() {
        if (!this.page) {
            throw new Error('Trình duyệt chưa được khởi tạo. Vui lòng khởi động lại bot.');
        }

        if (this.isBusy) {
            throw new Error('Bot đang bận xử lý câu hỏi trước, vui lòng chờ...');
        }

        this.isBusy = true;
        this.status = 'busy';

        try {
            console.log('[DeepSeekBot] Đang tạo phiên chat mới...');
            
            // Try clicking the new chat button first
            let clicked = false;
            try {
                clicked = await this.page.evaluate(() => {
                    // Try finding buttons or links that represent "New chat"
                    const elements = Array.from(document.querySelectorAll('div, button, a'));
                    for (const el of elements) {
                        const txt = (el.innerText || '').trim();
                        const aria = el.getAttribute('aria-label') || '';
                        if (
                            txt === 'New chat' || txt === 'Cuộc trò chuyện mới' || txt === '新对话' ||
                            aria.includes('New chat') || aria.includes('Cuộc trò chuyện mới')
                        ) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });
            } catch (e) {
                clicked = false;
            }

            if (!clicked) {
                // Navigate directly to root chat url
                await this.page.goto('https://chat.deepseek.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
            }

            // Wait for textarea to appear
            await this.page.waitForFunction(() => {
                return !!(document.querySelector('textarea.ds-textarea__textarea') || document.querySelector('textarea'));
            }, { timeout: 15000 });

            // Small settle delay
            await new Promise(r => setTimeout(r, 1000));
            console.log('[DeepSeekBot] Tạo đoạn chat mới thành công!');

            this.status = 'ready';
            return { success: true, message: 'Đã tạo phiên trò chuyện mới trên DeepSeek.' };
        } catch (err) {
            console.error('[DeepSeekBot] Lỗi tạo đoạn chat mới:', err.message);
            throw err;
        } finally {
            this.isBusy = false;
            this.status = 'ready';
        }
    }

    async sendMessage(prompt, options = {}) {
        if (!this.page) {
            throw new Error('Trình duyệt chưa được khởi động.');
        }

        const loginStatus = await this.checkLoginStatus();
        if (!loginStatus.isLoggedIn) {
            throw new Error('Chưa đăng nhập DeepSeek! Vui lòng đăng nhập trên cửa sổ trình duyệt DeepSeek trước.');
        }

        if (this.isBusy) {
            throw new Error('DeepSeek đang bận tạo câu trả lời. Vui lòng chờ hoàn thành.');
        }

        this.isBusy = true;
        this.status = 'busy';

        try {
            console.log(`[DeepSeekBot] Gửi prompt (${prompt.length} ký tự): "${prompt.slice(0, 50)}..."`);

            // Step 1: Count current messages before sending
            const initialMessageCount = await this.page.evaluate(() => {
                return document.querySelectorAll('.ds-markdown').length;
            });
            console.log(`[DeepSeekBot] Số lượng tin nhắn markdown hiện tại: ${initialMessageCount}`);

            // Step 2: Inject text into textarea using React-compatible setter
            const inputSuccess = await this.page.evaluate((text) => {
                const textarea = document.querySelector('textarea.ds-textarea__textarea') || 
                                 document.querySelector('textarea') ||
                                 document.querySelector('div[contenteditable="true"]');
                if (!textarea) return false;

                textarea.focus();
                if (textarea.tagName.toLowerCase() === 'textarea') {
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeSetter.call(textarea, text);
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    textarea.innerText = text;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return true;
            }, prompt);

            if (!inputSuccess) {
                throw new Error('Không tìm thấy khung chat của DeepSeek. Hãy kiểm tra xem bạn đã đăng nhập chưa.');
            }

            await new Promise(r => setTimeout(r, 400));

            // Step 3: Trigger submit
            // Option A: Click send button if present
            const sendClicked = await this.page.evaluate(() => {
                // Find send button: circle button or button with send SVG
                const buttons = Array.from(document.querySelectorAll('div[class*="functionRowRightColumn"] button, button[class*="ds-icon-button"], div[role="button"], button'));
                for (const btn of buttons) {
                    const svg = btn.querySelector('svg');
                    const aria = btn.getAttribute('aria-label') || '';
                    if (aria.toLowerCase().includes('send') || aria.toLowerCase().includes('gửi') || aria.toLowerCase().includes('发送')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            });

            // Option B: Press Enter if send button wasn't explicitly found
            if (!sendClicked) {
                console.log('[DeepSeekBot] Nhấn phím Enter để gửi prompt...');
                await this.page.keyboard.press('Enter');
            } else {
                console.log('[DeepSeekBot] Đã click nút gửi thành công.');
            }

            // Step 4: Wait for DeepSeek to start and finish generating
            console.log('[DeepSeekBot] Đang chờ DeepSeek trả lời và hoàn tất...');
            const startTime = Date.now();
            const timeoutMs = options.timeout || 120000; // 2 minutes max
            let lastText = '';
            let stableCount = 0;
            let hasStarted = false;

            while (Date.now() - startTime < timeoutMs) {
                await new Promise(r => setTimeout(r, 600));

                const state = await this.page.evaluate((prevCount) => {
                    const markdowns = document.querySelectorAll('.ds-markdown');
                    const currentCount = markdowns.length;
                    
                    // Check if generation is ongoing (Stop button or loading state)
                    let isGenerating = false;
                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    for (const b of buttons) {
                        const aria = b.getAttribute('aria-label') || '';
                        const txt = (b.innerText || '').trim();
                        if (
                            txt === 'Stop' || txt === '停止生成' || txt === 'Dừng' ||
                            aria.includes('Stop') || aria.includes('停止')
                        ) {
                            isGenerating = true;
                            break;
                        }
                    }

                    function extractCleanText(root) {
                        if (!root) return '';
                        const clone = root.cloneNode(true);

                        // 1. Convert KaTeX display / block math
                        clone.querySelectorAll('.katex-display, .math.math-display, div[data-display="true"]').forEach(kd => {
                            const annotation = kd.querySelector('annotation[encoding="application/x-tex"], annotation');
                            let tex = annotation ? annotation.textContent.trim() : (kd.getAttribute('data-tex') || '');
                            if (tex) {
                                kd.replaceWith(document.createTextNode('\n\n$$\n' + tex + '\n$$\n\n'));
                            }
                        });

                        // 2. Convert KaTeX inline math
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

                        // 3. Preserve Code Blocks cleanly
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

                        const tempContainer = document.createElement('div');
                        tempContainer.style.cssText = 'position: absolute; left: -9999px; top: -9999px; opacity: 0; pointer-events: none;';
                        tempContainer.appendChild(clone);
                        document.body.appendChild(tempContainer);

                        let text = clone.innerText || '';
                        tempContainer.remove();
                        return text.trim();
                    }

                    let lastMarkdownText = '';
                    let lastMarkdownHtml = '';
                    if (currentCount > prevCount || currentCount > 0) {
                        const target = markdowns[markdowns.length - 1];
                        lastMarkdownText = target ? extractCleanText(target) : '';
                        lastMarkdownHtml = target ? target.innerHTML : '';
                    }

                    return {
                        currentCount,
                        isGenerating,
                        lastMarkdownText,
                        lastMarkdownHtml
                    };
                }, initialMessageCount);

                if (state.lastMarkdownText && state.lastMarkdownText.trim().length > 0) {
                    hasStarted = true;
                }

                // If DeepSeek was generating and now stop button is gone
                if (hasStarted) {
                    if (state.lastMarkdownText === lastText) {
                        stableCount++;
                        // If text is stable for 3 checks (approx 1.8s) and not generating => response complete!
                        if (stableCount >= 3 && !state.isGenerating) {
                            console.log(`[DeepSeekBot] Trả lời hoàn tất! (${state.lastMarkdownText.length} ký tự, thời gian: ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
                            return {
                                success: true,
                                response: state.lastMarkdownText,
                                html: state.lastMarkdownHtml,
                                durationMs: Date.now() - startTime
                            };
                        }
                    } else {
                        lastText = state.lastMarkdownText;
                        stableCount = 0;
                    }
                }
            }

            // If reached timeout but we got text, return whatever we have
            if (lastText && lastText.length > 0) {
                console.log('[DeepSeekBot] Hết thời gian chờ tối đa, trả về nội dung thu được.');
                return {
                    success: true,
                    response: lastText,
                    durationMs: Date.now() - startTime,
                    warning: 'Phản hồi có thể chưa hoàn thành toàn bộ do vượt quá thời gian chờ.'
                };
            }

            throw new Error('Quá thời gian chờ (timeout) nhưng không nhận được câu trả lời từ DeepSeek.');
        } catch (err) {
            console.error('[DeepSeekBot] Lỗi gửi tin nhắn:', err.message);
            throw err;
        } finally {
            this.isBusy = false;
            this.status = 'ready';
        }
    }

    async close() {
        if (this.browser) {
            console.log('[DeepSeekBot] Đóng trình duyệt...');
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isLoggedIn = false;
            this.status = 'uninitialized';
        }
    }
}

module.exports = DeepSeekBot;
