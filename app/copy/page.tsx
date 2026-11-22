// หน้าคัดลอกเลขบัญชี (เปิดจากปุ่มใน Messenger — Messenger ไม่มีปุ่มคัดลอกในตัว)
// /copy?n=054-0-20552-4&b=ธนาคารกรุงไทย&o=ชื่อบัญชี
import CopyBox from "./CopyBox";

export const dynamic = "force-dynamic";

export default function CopyPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const number = (searchParams.n ?? "").trim();
  const ok = /^[\d-]{10,20}$/.test(number);
  return (
    <CopyBox
      number={ok ? number : ""}
      bank={(searchParams.b ?? "").slice(0, 40)}
      owner={(searchParams.o ?? "").slice(0, 60)}
    />
  );
}
