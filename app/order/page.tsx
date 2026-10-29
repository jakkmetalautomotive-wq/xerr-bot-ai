// หน้าแบบฟอร์มที่อยู่ (LIFF) — อ่าน LIFF_ID จาก Vercel ตอนเปิดหน้า แล้วส่งให้ฟอร์มฝั่งเบราว์เซอร์
import OrderForm from "./OrderForm";

export const dynamic = "force-dynamic";

export default function OrderPage() {
  return <OrderForm liffId={process.env.LIFF_ID || process.env.NEXT_PUBLIC_LIFF_ID || ""} />;
}
