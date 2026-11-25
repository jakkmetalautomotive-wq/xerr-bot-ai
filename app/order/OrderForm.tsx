"use client";
// แบบฟอร์มกรอกชื่อ-ที่อยู่ ที่เปิดในแอป LINE (LIFF) จากปุ่มในสรุปออเดอร์
import { useEffect, useState } from "react";
import liff from "@line/liff";

// u = ลูกค้า Facebook/Instagram → เปิดในเบราว์เซอร์ของ Messenger ได้เลย ไม่ต้องใช้ LINE
type Draft = { code: string; product: string; picks: string[]; tax: boolean; total?: number; u?: string };

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
const addressSentText = (code: string, total: number, withSlip: boolean) => `📝 ส่งที่อยู่${withSlip ? " + สลิป" : ""}แล้ว · ออเดอร์ ${code} · ยอด ${total.toLocaleString("en-US")}.-`;

// ย่อรูปสลิปในเครื่องลูกค้าก่อนส่ง (รูปจากมือถือใหญ่หลาย MB) → JPEG
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("เปิดรูปนี้ไม่ได้ ลองแคปหน้าจอสลิปแล้วแนบใหม่ครับ"));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  step: { fontSize: 17, margin: "22px 0 4px" },
  drop: { display: "flex", alignItems: "center", gap: 14, border: "2px dashed #999", borderRadius: 12, padding: 14, marginTop: 8, cursor: "pointer" },
  dropOk: { borderColor: "#06C755", background: "#f2fcf6" },
  hint: { fontSize: 13, color: "#666", margin: "8px 0 0", lineHeight: 1.5 },
};

export default function OrderForm({ liffId }: { liffId: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", address: "", zip: "", note: "" });
  const [sending, setSending] = useState(false);
  const [needSlip, setNeedSlip] = useState(true); // ส่งสลิปไปแล้ว (เช่น กลับมาแก้ที่อยู่) → ไม่ต้องแนบซ้ำ
  const [slip, setSlip] = useState("");
  const [done, setDone] = useState<{ code: string; total: number; stage?: "wait" | "slip" | "paid" } | null>(null);

  const web = Boolean(draft?.u); // ลูกค้า Facebook/Instagram

  useEffect(() => {
    const first = tokenFromUrl();
    const fd = first ? readDraft(first) : null;
    if (fd?.u) {
      setToken(first);
      setDraft(fd);
      setReady(true);
      return;
    }
    if (!liffId) return setError("ยังไม่ได้ตั้งค่า LIFF_ID ใน Vercel");
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
  }, [liffId]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/order?o=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => d.ok && setNeedSlip(Boolean(d.needSlip)))
      .catch(() => {});
  }, [token]);

  async function pickSlip(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // เลือกรูปเดิมซ้ำได้
    if (!file) return;
    setError("");
    try {
      setSlip(await shrinkImage(file));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    const problem = checkForm(form) ?? (needSlip && !slip ? "กรุณาแนบสลิปโอนเงินครับ" : null);
    if (problem) return setError(problem);
    setError("");
    setSending(true);
    try {
      const inChat = !web && liff.isInClient();
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(slip ? { slip } : {}), token, idToken: web ? "" : liff.getIDToken(), chatMessageSent: inChat }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "ส่งไม่สำเร็จ");
      if (inChat) await liff.sendMessages([{ type: "text", text: addressSentText(data.code, data.total, Boolean(slip)) }]).catch(() => {});
      setDone({ code: data.code, total: data.total, stage: data.stage });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (done)
    return (
      <main style={S.page}>
        <h2>{done.stage === "slip" ? "รับที่อยู่และสลิปแล้วครับ ✅" : "รับที่อยู่แล้วครับ ✅"}</h2>
        <div style={S.card}>
          ออเดอร์ <b>{done.code}</b>
          <br />
          ยอดชำระ <b>{done.total.toLocaleString("en-US")}.-</b>
          <br />
          {done.stage === "paid"
            ? "ข้อมูลครบแล้ว จัดส่งรอบถัดไปครับ 🙏"
            : done.stage === "slip"
              ? "แอดมินกำลังเช็คยอดให้ครับ ไม่ต้องส่งสลิปในแชทอีกนะครับ 🙏"
              : `โอนแล้วส่งสลิปในแชท${web ? " Messenger" : " LINE"} ได้เลยครับ 🙏`}
        </div>
        {web ? (
          <p style={{ fontSize: 14, color: "#555" }}>ปิดหน้านี้แล้วกลับไปที่แชทได้เลยครับ</p>
        ) : (
          <button style={S.btn} onClick={() => liff.closeWindow()}>
            กลับไปที่แชท
          </button>
        )}
      </main>
    );

  return (
    <main style={S.page}>
      <h2 style={{ marginTop: 0 }}>{needSlip ? "📦 แจ้งชื่อ-ที่อยู่ พร้อมสลิปหลังชำระเงิน" : "📦 ข้อมูลจัดส่ง"}</h2>
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
          {needSlip && <h3 style={S.step}>1. ข้อมูลจัดส่ง</h3>}
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
          {needSlip ? (
            <>
              <h3 style={S.step}>2. แนบสลิปโอนเงิน</h3>
              <label style={{ ...S.drop, ...(slip ? S.dropOk : {}) }}>
                {slip ? <img src={slip} alt="สลิปที่แนบ" style={{ width: 72, height: 96, objectFit: "cover", borderRadius: 8 }} /> : <span style={{ fontSize: 34 }}>🧾</span>}
                <span>
                  <b style={{ color: slip ? "#068a3c" : "#111" }}>{slip ? "✅ แนบสลิปแล้ว" : "แตะเพื่อเลือกรูปสลิป"}</b>
                  <br />
                  <span style={{ fontSize: 13, color: "#666" }}>{slip ? "แตะเพื่อเปลี่ยนรูป" : "เลือกจากอัลบั้มรูปในเครื่อง"}</span>
                </span>
                <input type="file" accept="image/*" onChange={pickSlip} style={{ display: "none" }} />
              </label>
              <p style={S.hint}>แนบรูปไม่ได้? ส่งสลิปในแชทก่อน แล้วเปิดหน้านี้อีกครั้ง จะไม่ต้องแนบซ้ำครับ</p>
            </>
          ) : (
            <p style={{ ...S.hint, color: "#068a3c" }}>✅ ได้รับสลิปของออเดอร์นี้แล้ว ไม่ต้องแนบซ้ำครับ</p>
          )}
          <button style={{ ...S.btn, opacity: sending ? 0.6 : 1 }} disabled={sending} onClick={submit}>
            {sending ? "กำลังส่ง..." : needSlip ? "ส่งข้อมูล" : "ยืนยันที่อยู่จัดส่ง"}
          </button>
        </>
      )}
      {error && <p style={S.err}>{error}</p>}
    </main>
  );
}
