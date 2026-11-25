"use client";
import { useState } from "react";

const S = {
  page: { maxWidth: 420, margin: "0 auto", textAlign: "center" as const, color: "#111" },
  card: { background: "#f4f6fb", borderRadius: 14, padding: 20, marginTop: 8 },
  number: { fontSize: 30, fontWeight: 800, letterSpacing: 1, margin: "10px 0" },
  btn: { width: "100%", padding: 16, fontSize: 18, fontWeight: 700, color: "#fff", background: "#1BA5E1", border: 0, borderRadius: 12, marginTop: 16 },
  hint: { fontSize: 14, color: "#555", marginTop: 14, lineHeight: 1.6 },
};

export default function CopyBox({ number, bank, owner }: { number: string; bank: string; owner: string }) {
  const [copied, setCopied] = useState(false);
  if (!number) return <main style={S.page}>ไม่พบเลขบัญชี กรุณากลับไปที่แชทครับ</main>;
  const digits = number.replace(/\D/g, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(digits);
    } catch {
      // เบราว์เซอร์ในแอปบางตัวไม่ให้ใช้ clipboard → เลือกข้อความให้ลูกค้ากดคัดลอกเอง
      const el = document.getElementById("acct");
      if (el) window.getSelection()?.selectAllChildren(el);
      document.execCommand?.("copy");
    }
    setCopied(true);
  }

  return (
    <main style={S.page}>
      <h2 style={{ margin: "0 0 4px" }}>📋 คัดลอกเลขบัญชี</h2>
      <div style={S.card}>
        {bank && <div style={{ fontSize: 16, fontWeight: 600 }}>{bank}</div>}
        <div id="acct" style={S.number}>{number}</div>
        {owner && <div style={{ fontSize: 15 }}>ชื่อบัญชี {owner}</div>}
        <button style={{ ...S.btn, background: copied ? "#06C755" : S.btn.background }} onClick={copy}>
          {copied ? "คัดลอกแล้ว ✅" : "คัดลอกเลขบัญชี"}
        </button>
      </div>
      <p style={S.hint}>
        {copied ? "ปิดหน้านี้ แล้ววางเลขบัญชีในแอปธนาคารได้เลยครับ" : "กดปุ่มด้านบนเพื่อคัดลอก แล้ววางในแอปธนาคาร"}
        <br />โอนแล้วกลับไปกดปุ่ม &quot;แจ้งที่อยู่+แนบสลิป&quot; ในแชทได้เลยครับ 🙏
      </p>
    </main>
  );
}
