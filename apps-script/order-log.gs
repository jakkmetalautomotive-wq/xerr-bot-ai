/**
 * บันทึกออเดอร์จากบอท LINE ลง Google Sheet (ชีทส่วนตัว — ห้ามแชร์ เพราะมีชื่อ/เบอร์/ที่อยู่ลูกค้า)
 * วิธีติดตั้ง: README หัวข้อ "บันทึกออเดอร์ลง Google Sheet"
 *   1) เปิดชีทออเดอร์ → ส่วนขยาย › Apps Script → วางโค้ดนี้ทั้งไฟล์ → บันทึก
 *   2) ตั้งค่าโปรเจกต์ (รูปเฟือง) › Script Properties → เพิ่ม SECRET = รหัสลับที่ตั้งเอง (ตัวอักษรอังกฤษ+ตัวเลข 20 ตัวขึ้นไป)
 *   3) ทำให้ใช้งานได้ › การทำให้ใช้งานได้รายการใหม่ › ประเภท "เว็บแอป" · ดำเนินการในฐานะ "ฉัน" · ผู้มีสิทธิ์เข้าถึง "ทุกคน"
 *   4) คัดลอก URL เว็บแอป → Vercel: ORDER_LOG_URL = URL นั้น · ORDER_LOG_SECRET = รหัสเดียวกับข้อ 2 → Redeploy
 * "ทุกคน" เข้าถึงได้แค่ส่งข้อมูลเข้ามา และต้องมีรหัส SECRET ตรง ถึงจะเขียนลงชีทได้ (ไม่มีใครอ่านชีทผ่าน URL นี้ได้)
 */
const SHEET_NAME = 'ออเดอร์ LINE';
const TZ = 'Asia/Bangkok';
const HEADERS = [
  'วันที่', 'รหัสออเดอร์', 'สถานะ', 'สินค้า', 'ตัวเลือก', 'ป้ายภาษี พรบ.', 'ราคาสินค้า', 'ราคาป้ายภาษี', 'ค่าส่ง', 'ยอดชำระ',
  'ชื่อผู้รับ', 'เบอร์', 'ที่อยู่', 'รหัสไปรษณีย์', 'หมายเหตุ', 'ชื่อ LINE', 'LINE user ID', 'อัปเดตสถานะเมื่อ',
];
const COL_CODE = 2, COL_STATUS = 3, COL_UPDATED = 18;

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad json' }); }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || data.secret !== secret) return reply({ ok: false, error: 'secret' });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_();
    const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    if (data.action === 'new') {
      const o = data.order;
      // เบอร์ / รหัสไปรษณีย์ ใส่ ' นำหน้า → เก็บเลข 0 ข้างหน้าไว้
      sh.appendRow([
        now, o.code, data.status || 'รอตรวจสลิป', o.product, o.picks, o.tax ? 'เพิ่ม' : '-', o.base, o.taxPrice, o.shipping, o.total,
        o.name, "'" + o.phone, o.address, "'" + o.zip, o.note, o.lineName, o.lineUserId, now,
      ]);
      return reply({ ok: true });
    }
    if (data.action === 'status') {
      const row = findRow_(sh, data.code);
      if (row) {
        sh.getRange(row, COL_STATUS).setValue(data.status);
        sh.getRange(row, COL_UPDATED).setValue(now);
      } else {
        // หาออเดอร์ไม่เจอ (เช่น ลงก่อนเปิดระบบนี้) → ลงแถวสถานะไว้ให้รู้
        const r = new Array(HEADERS.length).fill('');
        r[0] = now; r[COL_CODE - 1] = data.code; r[COL_STATUS - 1] = data.status; r[COL_UPDATED - 1] = now;
        sh.appendRow(r);
      }
      return reply({ ok: true, found: Boolean(row) });
    }
    return reply({ ok: false, error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}

// เปิด URL เว็บแอปในเบราว์เซอร์ = เช็คว่าติดตั้งแล้ว (ไม่แสดงข้อมูลออเดอร์)
function doGet() {
  return reply({ ok: true, note: 'XERR order log พร้อมใช้งาน', secretSet: Boolean(PropertiesService.getScriptProperties().getProperty('SECRET')) });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
    sh.getRange('G:J').setNumberFormat('#,##0');
  }
  return sh;
}

function findRow_(sh, code) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const codes = sh.getRange(2, COL_CODE, last - 1, 1).getValues();
  for (let i = codes.length - 1; i >= 0; i--) if (String(codes[i][0]) === String(code)) return i + 2;
  return 0;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
