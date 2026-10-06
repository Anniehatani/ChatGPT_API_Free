# 🤖 ChatGPT Auto-Scraper & Free API Tool (Guest Mode)

> Công cụ tự động hóa cào dữ liệu ChatGPT Web ở chế độ khách (**không cần đăng nhập**), tự động xử lý popup, tự động nhấn **"Clear chat"** khi hết hạn, cung cấp Web UI và mở cổng API miễn phí (chuẩn JSON & chuẩn OpenAI).

---

## ✨ Tính Năng Nổi Bật

1. **Không cần đăng nhập (Guest Mode)**: Hoạt động trực tiếp trên `https://chatgpt.com` mà không yêu cầu tài khoản.
2. **Tự động nhấn `Clear chat`**: Khi hỏi đến lúc hết hạn phiên hoặc xuất hiện hộp thoại *"Clear current chat?"*, hệ thống tự động nhấn nút `Clear chat` để tạo phiên mới.
3. **Tự động nhấn `[X]` đóng popup đăng nhập**: Khi ChatGPT hiển thị popup mời đăng nhập/đăng ký sau khi gửi prompt, hệ thống tự động tìm và click nút `[X]` để tắt popup ngay lập tức.
4. **Đồng bộ Đoạn chat mới (New Chat)**:
   - Khi bạn nhấn nút "Đoạn chat mới" trên giao diện Web Dashboard, bot tự động reset phiên chat trên ChatGPT.
   - Khi bạn thao tác trực tiếp trên cửa sổ ChatGPT, hệ thống sẽ tự động xác nhận Clear chat nếu có hộp thoại xuất hiện.
5. **Giao diện Web Hiện Đại (HTML & CSS)**:
   - Giao diện Dark Mode chuẩn Cyberpunk Glassmorphism.
   - Hỗ trợ Markdown rendering, tô màu code (syntax highlighting) và nút sao chép nhanh câu trả lời.
   - Nhật ký tự động hóa (Live Activity Log) hiển thị thời gian thực qua Server-Sent Events (SSE).
6. **Mở Cổng API Miễn Phí**:
   - `POST /api/chat`: Định dạng JSON đơn giản (`{ "message": "..." }`).
   - `POST /v1/chat/completions`: Tương thích 100% chuẩn OpenAI API (dùng được với thư viện `openai` của Python, NodeJS, LangChain, NextChat, OpenWebUI...).

---

## 🚀 Hướng Dẫn Sử Dụng

### Cách 1: Khởi động nhanh bằng file `.bat`
Chỉ cần nhấp đúp chuột vào file:
```
start.bat
```
Server và giao diện Web sẽ tự động mở tại: `http://localhost:3000`

### Cách 2: Khởi động qua dòng lệnh (Terminal)
Bạn có thể chạy bằng bất kỳ lệnh nào dưới đây:
```bash
# Chạy server thông thường:
npm start

# Hoặc chế độ dev:
npm run dev

# Hoặc trực tiếp với node:
node server.js
```

Truy cập giao diện tại: **[http://localhost:3000](http://localhost:3000)**

---

### 💬 Cách 3: Chat và Gọi API Trực Tiếp Trên Terminal (CLI)
Sau khi server đã chạy (`npm start`), bạn có thể mở một cửa sổ Terminal khác để tương tác trực tiếp mà không cần mở trình duyệt:

```bash
# 1. Chế độ Chat tương tác trên Terminal:
npm run cli
# hoặc:
node cli.js

# 2. Hoặc gửi câu hỏi một dòng và nhận kết quả ngay:
node cli.js "Tính giới hạn lim x->0 (sin x)/x và viết code Python"
```
*(Bạn cũng có thể nhấp đúp vào file `cli.bat` để mở CLI)*

---

## 📡 Tài Liệu API

### 1. API Đơn Giản: `POST /api/chat`
**Request Body:**
```json
{
  "message": "Giải thích ngắn gọn định luật bảo toàn năng lượng",
  "newChat": false
}
```

**Response:**
```json
{
  "success": true,
  "reply": "Năng lượng không tự nhiên sinh ra cũng không tự nhiên mất đi...",
  "durationMs": 3200,
  "model": "chatgpt-guest"
}
```

#### Ví dụ cURL:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Viết thơ 4 câu về lập trình"}'
```

#### Ví dụ Python:
```python
import requests

url = "http://localhost:3000/api/chat"
res = requests.post(url, json={"message": "Xin chào ChatGPT!"})
print(res.json()["reply"])
```

---

### 2. Chuẩn OpenAI: `POST /v1/chat/completions`
Tương thích hoàn toàn với thư viện `openai` chính thức:

```python
from openai import OpenAI

# Trỏ base_url về server local
client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="none"  # Không cần API key
)

response = client.chat.completions.create(
    model="chatgpt-free",
    messages=[
        {"role": "user", "content": "Viết hàm tính giai thừa bằng Python"}
    ]
)

print(response.choices[0].message.content)
```

---

### 3. API Tạo Chat Mới: `POST /api/new-chat`
```bash
curl -X POST http://localhost:3000/api/new-chat
```

---

## 📁 Cấu Trúc Dự Án
```
deepseektool/
├── chatgpt_bot.js        # Điều khiển trình duyệt, tự động nhấn X, tự động Clear chat
├── server.js             # Express server cung cấp Web UI và API endpoints
├── start.bat             # File khởi động nhanh 1-click cho Windows
├── package.json          # Danh sách gói phụ thuộc (puppeteer-extra, express, cors...)
└── public/
    ├── index.html        # Giao diện Web chính (HTML5 semantic)
    ├── style.css         # Thiết kế Dark Mode Glassmorphism cao cấp
    └── app.js            # Logic frontend, gọi API, kết nối SSE live logs
```
