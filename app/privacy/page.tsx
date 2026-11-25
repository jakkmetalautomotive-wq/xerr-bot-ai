// นโยบายความเป็นส่วนตัวของบอทแชท (Meta App Review บังคับให้มี URL นี้) · ร่างจากการทำงานจริงของระบบ — จักรตรวจก่อนใช้
export const metadata = { title: "Privacy Policy — XERR Autoteam chat" };

const S = { page: { maxWidth: 760, margin: "0 auto", lineHeight: 1.7, color: "#111" }, h2: { marginTop: 28 } };

export default function Privacy() {
  return (
    <main style={S.page}>
      <h1>นโยบายความเป็นส่วนตัว — แชทบอท XERR Autoteam</h1>
      <p>ปรับปรุงล่าสุด: 23 พฤศจิกายน 2026</p>
      <p>
        ร้าน XERR Autoteam (เซอร์ ประดับยนต์) ใช้ระบบตอบแชทอัตโนมัติใน LINE Official Account และ Facebook Messenger
        เพื่อตอบคำถามสินค้าและรับคำสั่งซื้อกรอบป้ายทะเบียน หน้านี้อธิบายว่าเราเก็บและใช้ข้อมูลอะไรบ้าง
      </p>

      <h2 style={S.h2}>ข้อมูลที่เราได้รับ</h2>
      <ul>
        <li>ข้อความ รูปภาพ และปุ่มที่คุณกดในแชทกับร้าน</li>
        <li>ชื่อโปรไฟล์และรหัสผู้ใช้ที่ LINE / Facebook ส่งให้ร้าน (ใช้ระบุว่าแชทนี้เป็นของใคร)</li>
        <li>ข้อมูลจัดส่งที่คุณกรอกเอง: ชื่อ เบอร์โทร ที่อยู่ รหัสไปรษณีย์ หมายเหตุ</li>
        <li>รายการสินค้าที่สั่งและยอดชำระ รวมถึงรูปสลิปที่คุณส่งมา</li>
      </ul>

      <h2 style={S.h2}>เราใช้ข้อมูลเพื่อ</h2>
      <ul>
        <li>ตอบคำถาม ส่งรูปสินค้า/รีวิว และสรุปคำสั่งซื้อให้คุณ</li>
        <li>ตรวจยอดโอน จัดส่งสินค้า ทำใบปะหน้าพัสดุ และแจ้งเลขพัสดุ</li>
        <li>ส่งต่อให้แอดมินของร้านเมื่อบอทตอบไม่ได้</li>
      </ul>
      <p>เราไม่ขายข้อมูลของคุณ และไม่ส่งข้อความโฆษณาโดยที่คุณไม่ได้ทักมาก่อน</p>

      <h2 style={S.h2}>ผู้ให้บริการที่ประมวลผลข้อมูลแทนร้าน</h2>
      <ul>
        <li>LINE และ Meta (Facebook Messenger) — ช่องทางรับส่งข้อความ</li>
        <li>Google Gemini — อ่านข้อความ/รูปในแชทเพื่อช่วยร่างคำตอบ</li>
        <li>Google Sheets / Google Drive — บันทึกคำสั่งซื้อและเก็บรูปสินค้า</li>
        <li>Vercel และ Upstash — เซิร์ฟเวอร์และหน่วยความจำชั่วคราวของระบบ</li>
      </ul>

      <h2 style={S.h2}>ระยะเวลาเก็บข้อมูล</h2>
      <ul>
        <li>บริบทการสนทนาสำหรับตอบต่อเนื่อง: ไม่เกิน 30 นาที</li>
        <li>ข้อมูลทำใบปะหน้า (ชื่อ ที่อยู่): 60 วัน</li>
        <li>รูปสลิปที่แนบในแบบฟอร์ม: 30 วัน</li>
        <li>ประวัติคำสั่งซื้อ: เก็บไว้เพื่อการจัดส่ง บริการหลังการขาย และบัญชีของร้าน</li>
        <li>ประวัติแชทเก็บอยู่ในระบบของ LINE / Meta ตามนโยบายของแต่ละแพลตฟอร์ม</li>
      </ul>

      <h2 style={S.h2}>สิทธิ์ของคุณ</h2>
      <p>
        คุณขอดู แก้ไข หรือลบข้อมูลของคุณได้ โดยทักแชทร้าน (LINE: @xerrautoteam หรือ Messenger ของเพจ XERR Autoteam)
        แล้วพิมพ์ว่า "ขอลบข้อมูล" — ดูขั้นตอนที่ <a href="/data-deletion">หน้าการลบข้อมูล</a>
      </p>

      <hr style={{ margin: "36px 0" }} />
      <h2>Privacy Policy (English summary)</h2>
      <p>
        XERR Autoteam uses an automated chat assistant on LINE and Facebook Messenger to answer product questions and take
        orders for licence-plate frames. We receive the messages, photos and button taps you send us, your profile name and
        platform user ID, and the shipping details you enter (name, phone, address). We use them only to reply to you,
        process and ship your order, and hand your conversation to our staff when needed. Service providers that process
        data for us: LINE, Meta, Google (Gemini, Sheets, Drive), Vercel and Upstash. Conversation context is kept for up to
        30 minutes, shipping-label data for 60 days, payment slips attached in the form for 30 days, and order records as needed for delivery, after-sales service and
        accounting. We do not sell your data or send promotional messages you did not ask for. To access or delete your
        data, message our Page or LINE account with "delete my data" — see the <a href="/data-deletion">data deletion page</a>.
      </p>
    </main>
  );
}
