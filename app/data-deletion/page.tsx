// วิธีขอลบข้อมูล (Meta App Review บังคับให้มี URL นี้)
export const metadata = { title: "Data deletion — XERR Autoteam chat" };

export default function DataDeletion() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", lineHeight: 1.7, color: "#111" }}>
      <h1>วิธีขอลบข้อมูลของคุณ</h1>
      <ol>
        <li>ทักแชทร้าน XERR Autoteam ทาง Messenger ของเพจ หรือ LINE: @xerrautoteam</li>
        <li>พิมพ์ว่า <b>"ขอลบข้อมูล"</b> และแจ้งเลขออเดอร์ (ถ้ามี เช่น XR-ABCD)</li>
        <li>แอดมินจะลบข้อมูลจัดส่งและประวัติคำสั่งซื้อของคุณออกจากระบบของร้านภายใน 30 วัน แล้วแจ้งกลับในแชท</li>
      </ol>
      <p>
        ประวัติแชทที่อยู่ใน Messenger / LINE คุณลบเองได้ในแอปนั้น ๆ · ถ้าต้องเก็บข้อมูลบางส่วนไว้ตามกฎหมายบัญชี/ภาษี
        เราจะแจ้งให้ทราบ
      </p>
      <hr style={{ margin: "32px 0" }} />
      <h2>How to delete your data</h2>
      <ol>
        <li>Message the XERR Autoteam Facebook Page or our LINE account (@xerrautoteam).</li>
        <li>Send "delete my data" and your order number if you have one.</li>
        <li>We delete your shipping details and order records from our systems within 30 days and confirm in the chat.</li>
      </ol>
      <p>
        You can delete the chat history itself in Messenger or LINE. If any record must be kept by law (for example tax
        records), we will tell you.
      </p>
    </main>
  );
}
