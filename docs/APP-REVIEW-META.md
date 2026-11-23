# ขอ App Review (Meta) — เปิดบอท Messenger ให้ลูกค้าทุกคน

ตอนนี้แอปอยู่ **โหมด Development** → บอทตอบได้เฉพาะบัญชีที่มีบทบาทในแอป
ต้องได้ **Advanced Access ของ `pages_messaging`** แล้วสลับเป็น **Live** ลูกค้าจริงถึงจะได้คำตอบ

> ชื่อเมนู Meta เปลี่ยนบ่อย ถ้าหาไม่เจอถ่ายหน้าจอมาถามได้ · ส่วนที่เป็นภาษาอังกฤษ = คัดลอกไปวางในฟอร์ม Meta ได้เลย (ผู้ตรวจของ Meta อ่านภาษาอังกฤษ)

---

## ขั้น 0 — เตรียมก่อนกดส่ง (ส่งไม่ได้ถ้าขาด)

developers.facebook.com › แอป › **App settings › Basic**

| ช่อง | ใส่ |
|---|---|
| App icon | โลโก้ร้าน 1024×1024 |
| Privacy Policy URL | `https://xerr-bot-ai.vercel.app/privacy` (หน้านี้ผมร่างไว้แล้ว — ต้อง deploy ก่อน) |
| User data deletion › Data deletion instructions URL | `https://xerr-bot-ai.vercel.app/data-deletion` |
| Category | Business and Pages (หรือ Messaging) |
| Contact email | อีเมลร้านที่จักรเช็คประจำ |

แล้ว:
- [ ] **ยืนยันธุรกิจ (Business Verification)** — Business Settings › Security Center › Start verification (ใช้เอกสารร้าน เช่น ทะเบียนพาณิชย์ / ภพ.20 / บิลค่าน้ำไฟที่มีชื่อร้าน) · Advanced Access ส่วนใหญ่ต้องผ่านข้อนี้ก่อน · ใช้เวลา 1–5 วันทำการ
- [ ] แอปผูกกับ Business portfolio ของร้านแล้ว
- [ ] เพจเปิดสาธารณะ (ผู้ตรวจต้องทักเพจได้)

## ขั้น 1 — เลือกสิทธิ์ที่ขอ

แอป › **App Review › Permissions and Features** (หรือ Use cases › Messenger › Customize)

| สิทธิ์ | ขอ? | เหตุผล |
|---|---|---|
| `pages_messaging` | ✅ **ขอ Advanced Access** | ให้บอทตอบลูกค้าทุกคน (ตัวหลัก) |
| `pages_manage_metadata` | ถ้า Meta บังคับ | ใช้ผูก webhook ของเพจ — ถ้าฟอร์มบอกว่าต้องมี ค่อยขอ ใช้คำอธิบายข้อ 2.2 |
| `pages_show_list` / `pages_read_engagement` | ไม่ต้อง | บอทไม่ได้ใช้ |
| Human Agent | ไม่ต้อง | บอทตอบภายใน 24 ชม. หลังลูกค้าทักเท่านั้น |

---

## ขั้น 2 — ข้อความที่วางในฟอร์ม

### 2.1 `pages_messaging` — "Tell us how you'll use this permission"

```
XERR Autoteam is a small Thai shop that sells car license-plate frames. Our Facebook Page
"XERR Autoteam [เซอร์ ประดับยนต์]" receives many customer questions every day. We use
pages_messaging so our own Page can reply to customers who message us first in Messenger.

How it works:
1. A customer sends a message to our Page (for example "สั่งซื้อ" = "order", a price
   question, or "ขอดูรีวิว Yaris" = "show reviews for Toyota Yaris").
2. Our webhook receives the message and our server replies through the Send API within
   seconds: product cards with photos and buttons, prices, installation videos and real
   customer review photos.
3. When the customer orders, the bot sends an order summary with our bank account and a
   button to fill in the shipping address on our website. When the customer sends a
   payment slip, the shop owner checks it and confirms; the bot then sends the customer
   an order confirmation.
4. If a question cannot be answered automatically, the bot tells the customer an admin
   will reply, and a staff member answers manually in Meta Business Suite. When staff
   reply manually, the bot pauses for that customer.

We only reply to people who messaged our Page, only within the 24-hour standard messaging
window, and we do not send promotional or broadcast messages. Messages are used only to
answer the customer and process their order.
```

### 2.2 `pages_manage_metadata` (ถ้าต้องขอ)

```
We use pages_manage_metadata only to subscribe our app to our own Page's webhooks
(messages, messaging_postbacks, message_echoes) so that our server receives customer
messages sent to our Page. We do not change any Page settings or content.
```

### 2.3 Step-by-step instructions for the reviewer

```
1. Open https://www.facebook.com/ and search for the Page "XERR Autoteam [เซอร์ ประดับยนต์]"
   (Page ID 467028736654467), then tap "Message".
2. Send: สั่งซื้อ   (means "order")
   → The bot replies with product category cards. Tap "เลือกแบบที่ 1" on any card.
3. Keep choosing options on the cards (colour → size → centre line). The bot then asks
   about an optional tax-plate frame; tap either button.
4. The bot sends an order summary with the bank account, a "copy account number" button,
   and a "กรอกชื่อ-ที่อยู่จัดส่ง" (fill in shipping address) button that opens a web form.
5. Send: ขอดูรีวิว Yaris   (means "show reviews for Toyota Yaris")
   → The bot replies with real customer photos.
6. Send: คุยกับแอดมิน   (means "talk to an admin")
   → The bot confirms that a human admin will reply.

No login or test account is needed. All replies are in Thai because our customers are Thai.
```

---

## ขั้น 3 — คลิปอัดหน้าจอ (Screencast)

Meta บังคับแนบคลิป · ยาว 1–3 นาที · ไม่ต้องมีเสียง · **ใส่คำบรรยายภาษาอังกฤษบนจอ** (พิมพ์ทับในแอปตัดต่อ เช่น CapCut) เพราะแชทเป็นภาษาไทย

อัดจาก **มือถือหรือคอมของบัญชีที่ไม่ใช่แอดมินเพจ แต่มีบทบาท Tester ในแอป** (โหมด Development บอทตอบเฉพาะคนมีบทบาท) — หรือบัญชีจักรเองก็ได้

| วินาที | ทำอะไร | คำบรรยายบนจอ (อังกฤษ) |
|---|---|---|
| 0–10 | เปิดเพจ XERR Autoteam กด Message | Customer opens our Page and starts a chat |
| 10–30 | พิมพ์ "สั่งซื้อ" → การ์ดประเภทสินค้าขึ้น | Customer types "order" — the bot replies with product cards |
| 30–60 | กดเลือกแบบตามการ์ดจนจบ → ชวนเพิ่มป้ายภาษี → กดปุ่ม | Customer picks options on the cards |
| 60–80 | สรุปยอด + การ์ดธนาคาร + ปุ่มคัดลอก + ปุ่มกรอกที่อยู่ | The bot sends the order summary and payment details |
| 80–95 | กดกรอกที่อยู่ → หน้าเว็บเปิด (ไม่ต้องกรอกจริงก็ได้) | Shipping address form on our website |
| 95–110 | พิมพ์ "ขอดูรีวิว Yaris" → รูปรีวิว | Customer asks for reviews — real customer photos |
| 110–125 | พิมพ์ "คุยกับแอดมิน" → บอทบอกว่าแอดมินจะตอบ | Customer asks for a human — staff replies in Business Suite |
| 125–140 | (ถ้ามี) เปิด Business Suite ให้เห็นแชทเดียวกัน | Staff can see and answer the same conversation |

---

## ขั้น 4 — หลังอนุมัติ

1. แอป › สลับ **App Mode: Live**
2. เช็ค https://xerr-bot-ai.vercel.app/api/health ส่วน `meta` ยังมี `tokenInfo.valid: true`
3. Meta Business Suite › กล่องข้อความ › **ระบบอัตโนมัติ** → ปิด "ตอบกลับทันที" / "คำถามที่พบบ่อย" เดิม (กันตอบซ้ำกับบอท)
4. ให้คนนอก (เพื่อน/พนักงาน ที่ไม่มีบทบาทในแอป) ทักเพจทดสอบ 1 ครั้ง

## ถ้าถูกปฏิเสธ
ส่งข้อความที่ Meta ตอบกลับมาให้ผม — ส่วนใหญ่เป็นเรื่อง คลิปไม่ชัดว่าใช้สิทธิ์ตรงไหน / ไม่มีคำบรรยายอังกฤษ / Privacy Policy เข้าไม่ได้ ผมแก้ข้อความแล้วส่งใหม่ได้
