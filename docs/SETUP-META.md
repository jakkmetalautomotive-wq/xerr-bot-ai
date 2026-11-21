# ตั้งค่าบอท Facebook Messenger + Instagram DM

บอทใช้สมองตัวเดียวกับ LINE (คลังความรู้ ราคา การ์ดสินค้า รีวิว สรุปยอด) — ส่วนนี้ต้องทำเองในบัญชี Meta เพราะต้องยืนยันตัวตนและให้สิทธิ์บัญชี
**ห้ามส่ง Token / App Secret ในแชท** ใส่ใน Vercel เองเท่านั้น

> ชื่อเมนูใน Meta เปลี่ยนบ่อย ถ้าหาไม่เจอให้ดูคำที่ใกล้เคียง หรือถ่ายหน้าจอมาถามได้

---

## 0. เตรียมก่อน
- [ ] เพจ Facebook ของร้าน (จักรเป็นแอดมินเพจ)
- [ ] Instagram เป็น **บัญชีมืออาชีพ (Professional / Business)** และ **ผูกกับเพจ** แล้ว
      (เพจ › การตั้งค่า › บัญชีที่เชื่อมโยง › Instagram)
- [ ] ในแอป Instagram: การตั้งค่า › ข้อความและการตอบกลับ › **อนุญาตให้เข้าถึงข้อความ (Allow access to messages)** = เปิด

## 1. สร้างแอป Meta
1. เข้า https://developers.facebook.com › **My Apps › Create App**
2. เลือก use case **"Engage with customers on Messenger from Meta"** และเพิ่ม **Instagram (Manage messaging)**
3. ผูกกับ Business portfolio ของร้าน

## 2. ตั้งค่าใน Vercel ก่อน (ต้องมีก่อนกด Verify)
Vercel › โปรเจค xerr-bot-ai › Settings › Environment Variables เพิ่ม 3 ตัว:

| ชื่อ | ค่า | เอามาจาก |
|---|---|---|
| `META_VERIFY_TOKEN` | คำอะไรก็ได้ที่จักรตั้งเอง เช่น `xerr-ตามด้วยตัวเลขสุ่ม` | ตั้งเอง |
| `META_APP_SECRET` | App Secret | แอป › App settings › Basic › App Secret (กด Show) |
| `META_PAGE_ACCESS_TOKEN` | Page access token | ขั้นที่ 3 ข้อ 2 |

แล้วกด **Redeploy** (Deployments › ⋯ › Redeploy)

## 3. Messenger
แอป › Messenger › **Messenger API Settings**
1. **Configure webhooks**
   - Callback URL: `https://xerr-bot-ai.vercel.app/api/meta-webhook`
   - Verify token: คำเดียวกับ `META_VERIFY_TOKEN`
   - กด **Verify and save**
2. **Generate access tokens** › Connect เพจร้าน › Generate token › คัดลอกไปใส่ `META_PAGE_ACCESS_TOKEN` ใน Vercel (แล้ว Redeploy)
3. ช่อง Webhook ของเพจ › **Add subscriptions** ติ๊ก: `messages`, `messaging_postbacks`, `message_echoes`
   (`message_echoes` = แอดมินตอบเองในกล่องข้อความ → บอทเงียบกับลูกค้าคนนั้น 10 นาที)

## 4. Instagram
แอป › Instagram (API setup with Facebook login / Messenger API for Instagram)
1. Webhook object **instagram** › Callback URL + Verify token เดียวกับข้อ 3
2. Subscribe: `messages`, `messaging_postbacks`
3. ใช้ Page access token ตัวเดียวกับ Messenger ได้เลย (IG ผูกกับเพจแล้ว)

## 5. ทดสอบ (โหมด Development)
- เปิด https://xerr-bot-ai.vercel.app/api/health ดูว่า `"meta": {"pageToken": true, "appSecret": true, "verifyToken": true}`
- ทักเพจ / IG **จากบัญชีของจักรเอง** (โหมดนี้บอทตอบได้เฉพาะคนที่มีบทบาทในแอป: Admin / Developer / Tester)
- ลอง: "สั่งซื้อ", "ขอดูรีวิว Yaris", ส่งรูปสลิป → แอดมินต้องได้แจ้งเตือนใน LINE

## 6. เปิดให้ลูกค้าทุกคน (Go Live)
1. แอป › App Review › ขอ **Advanced Access**: `pages_messaging`, `instagram_manage_messages`
   (อาจต้องมี `pages_manage_metadata`, `instagram_basic`, `business_management` และ **ยืนยันธุรกิจ (Business Verification)**)
2. แนบคลิปอัดหน้าจอการใช้งานบอท (ทักเพจ → บอทตอบ → การ์ดสินค้า) — ผมช่วยเขียนคำอธิบายให้ได้
3. ผ่านแล้ว สลับแอปเป็น **Live**
4. Meta Business Suite › กล่องข้อความ › ระบบอัตโนมัติ: **ปิด "ตอบกลับทันที" / คำถามที่พบบ่อย** ที่ตั้งไว้เดิม กันตอบซ้ำกับบอท

---

## ต่างจาก LINE ตรงไหน
- **ที่อยู่จัดส่ง**: แบบฟอร์มกรอกที่อยู่ใช้ได้เฉพาะในแอป LINE → ลูกค้า FB/IG ได้ข้อความให้พิมพ์ ชื่อ / เบอร์ / ที่อยู่ ในแชท (ใบปะหน้าอัตโนมัติจึงยังไม่มีสำหรับออเดอร์ช่องทางนี้)
- **สลิป**: ลูกค้าส่งรูป → แอดมินได้แจ้งเตือน + รูปใน LINE · ยืนยันยอดแล้วตอบลูกค้าใน Meta Business Suite
- **กฎ 24 ชม.**: Meta ให้ตอบได้ภายใน 24 ชม. หลังข้อความล่าสุดของลูกค้า
- การ์ดหน้าตาเรียบกว่า LINE (การ์ดของ Messenger มีชื่อ / คำอธิบายสั้น / รูป / ปุ่มไม่เกิน 3)
