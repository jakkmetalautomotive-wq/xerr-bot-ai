"use client";
// แบบฟอร์มกรอกชื่อ-ที่อยู่ ที่เปิดในแอป LINE (LIFF) จากปุ่มในสรุปออเดอร์
import { useEffect, useState } from "react";
import liff from "@line/liff";

type Draft = { code: string; product: string; picks: string[]; tax: boolean; total?: number };

// อ่านข้อมูลออเดอร์จากลิงก์ (ไว้แสดงผล — ฝั่งเซิร์ฟเวอร์ตรวจลายเซ็นและคิดยอดใหม่เองอีกรอบ)
function readDraft(token: string): Draft | null {
  try {
    const b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function tokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const direct = params.get("o");
  if (direct) return direct;
  // เปิดผ่าน liff.line.me → ค่าจริงอยู่ใน liff.state
  const state = params.get("liff.state");
  return state ? new URLSearchParams(state.replace(/^[^?]*\?/, "")).get("o") ?? "" : "";
}

// ต้องตรงกับ addressSentText() ใน lib/order.ts (บอทใช้ข้อความนี้ยืนยันในแชท)
const addressSentText = (code: string, total: number) => `📝 ส่งที่อยู่แล้ว · ออเดอร์ ${code} · ยอด ${total.toLocaleString("en-US")}.-`;

function checkForm(f: Record<string, string>): string | null {
  if (f.name.trim().length < 2) return "กรุณากรอกชื่อ-นามสกุล";
  if (!/^0\d{8,9}$/.test(f.phone.replace(/[^\d]/g, ""))) return "เบอร์โทรไม่ถูกต้อง (ขึ้นต้นด้วย 0 และมี 9–10 หลัก)";
  if (f.address.trim().length < 10) return "กรุณากรอกที่อยู่ให้ครบ (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด)";
  if (!/^\d{5}$/.test(f.zip.replace(/[^\d]/g, ""))) return "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก";
  return null;
}

const S = {
  page: { maxWidth: 480, margin: "0 auto", padding: 16, fontFamily: "sans-serif", color: "#111" },
  card: { background: "#f6f6f6", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 14, lineHeight: 1.6 },
  label: { display: "block", fontSize: 14, fontWeight: 600, margin: "12px 0 4px" },
  input: { width: "100%", boxSizing: "border-box" as const, padding: 12, fontSize: 16, border: "1px solid #ccc", borderRadius: 8 },
  btn: { width: "100%", padding: 14, fontSize: 17, fontWeight: 700, color: "#fff", background: "#06C755", border: 0, borderRadius: 10, marginTop: 20 },
  err: { color: "#D32F2F", fontSize: 14, marginTop: 12 },
};

export default function OrderPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", zip: "", note: "" });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ code: string; total: number } | null>(null);

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return setError("ยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID)");
    liff
      .init({ liffId })
      .then(() => {
        if (!liff.isLoggedIn()) return liff.login({ redirectUri: window.location.href });
        const t = tokenFromUrl();
        const d = t ? readDraft(t) : null;
        if (!d) return setError("ไม่พบข้อมูลออเดอร์ กรุณากดปุ่มจากแชทอีกครั้งครับ");
        setToken(t);
        setDraft(d);
        setReady(true);
      })
      .catch((e) => setError(`เปิดแบบฟอร์มไม่ได้: ${e?.message ?? e}`));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    const problem = checkForm(form);
    if (problem) return setError(problem);
    setError("");
    setSending(true);
    try {
      const inChat = liff.isInClient();
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, token, idToken: liff.getIDToken(), chatMessageSent: inChat }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "ส่งไม่สำเร็จ");
      if (inChat) await liff.sendMessages([{ type: "text", text: addressSentText(data.code, data.total) }]).catch(() => {});
      setDone({ code: data.code, total: data.total });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (done)
    return (
      <main style={S.page}>
        <h2>รับที่อยู่แล้วครับ ✅</h2>
        <div style={S.card}>
          ออเดอร์ <b>{done.code}</b>
          <br />
          ยอดชำระ <b>{done.total.toLocaleString("en-US")}.-</b>
          <br />
          โอนแล้วส่งสลิปในแชท LINE ได้เลยครับ 🙏
        </div>
        <button style={S.btn} onClick={() => liff.closeWindow()}>
          กลับไปที่แชท
        </button>
      </main>
    );

  return (
    <main style={S.page}>
      <h2 style={{ marginTop: 0 }}>📦 ข้อมูลจัดส่ง</h2>
      {!ready && !error && <p>กำลังโหลด...</p>}
      {draft && (
        <div style={S.card}>
          ออเดอร์ <b>{draft.code}</b>
          <br />
          {draft.product}: {draft.picks.join(" / ")}
          {draft.tax && (
            <>
              <br />+ กรอบป้ายภาษี พรบ. รถยนต์
            </>
          )}
          {typeof draft.total === "number" && (
            <>
              <br />
              ยอดชำระ <b>{draft.total.toLocaleString("en-US")}.-</b>
            </>
          )}
        </div>
      )}
      {ready && (
        <>
          <label style={S.label}>ชื่อ-นามสกุล</label>
          <input style={S.input} value={form.name} onChange={set("name")} autoComplete="name" />
          <label style={S.label}>เบอร์โทร</label>
          <input style={S.input} value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="0812345678" />
          <label style={S.label}>ที่อยู่ (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด)</label>
          <textarea style={{ ...S.input, minHeight: 90 }} value={form.address} onChange={set("address")} autoComplete="street-address" />
          <label style={S.label}>รหัสไปรษณีย์</label>
          <input style={S.input} value={form.zip} onChange={set("zip")} inputMode="numeric" maxLength={5} autoComplete="postal-code" />
          <label style={S.label}>หมายเหตุ (ถ้ามี)</label>
          <input style={S.input} value={form.note} onChange={set("note")} />
          <button style={{ ...S.btn, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={submit}>
            {sending ? "กำลังส่ง..." : "ยืนยันที่อยู่จัดส่ง"}
          </button>
        </>
      )}
      {error && <p style={S.err}>{error}</p>}
    </main>
  );
}
