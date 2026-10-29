// หน้าเช็คสถานะ — เปิด production URL แล้วเห็นหน้านี้ = เว็บขึ้นแล้ว
export default function Home() {
  const env = ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "GEMINI_API_KEY", "SHEET_CSV_URL", "ADMIN_LINE_USER_ID", "PAYMENT_INFO", "LIFF_ID", "LINE_LOGIN_CHANNEL_ID"];
  return (
    <main>
      <h1>XERR LINE Bot ✅</h1>
      <p>Webhook URL: <code>/api/line-webhook</code></p>
      <ul>
        {env.map((k) => (
          <li key={k}>
            {k}: {process.env[k] ? "ตั้งค่าแล้ว ✅" : ["ADMIN_LINE_USER_ID", "PAYMENT_INFO", "LIFF_ID", "LINE_LOGIN_CHANNEL_ID"].includes(k) ? "ยังไม่ตั้ง (ใช้กับระบบสั่งซื้อ)" : "ยังไม่ตั้ง ❌"}
          </li>
        ))}
      </ul>
    </main>
  );
}

export const dynamic = "force-dynamic";
