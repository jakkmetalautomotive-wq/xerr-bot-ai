/**
 * บันทึกออเดอร์จากบอท LINE ลง Google Sheet (ชีทส่วนตัว — ห้ามแชร์ เพราะมีชื่อ/เบอร์/ที่อยู่ลูกค้า)
 * วิธีติดตั้ง: README หัวข้อ "บันทึกออเดอร์ลง Google Sheet"
 *   1) เปิดชีทออเดอร์ → ส่วนขยาย › Apps Script → วางโค้ดนี้ทั้งไฟล์ → บันทึก
 *      เปิดจากชีทไม่ได้ ("ไม่สามารถเปิดไฟล์ได้") = ล็อกอินหลายบัญชี → ไปที่ script.google.com ด้วยบัญชีเจ้าของชีท
 *      › โปรเจกต์ใหม่ › วางโค้ด แล้วข้อ 2 เพิ่ม Script Property SHEET_ID = id ชีท (ส่วนระหว่าง /d/ กับ /edit ในลิงก์ชีท)
 *   2) ตั้งค่าโปรเจกต์ (รูปเฟือง) › Script Properties → เพิ่ม SECRET = รหัสลับที่ตั้งเอง (ตัวอักษรอังกฤษ+ตัวเลข 20 ตัวขึ้นไป)
 *   3) ทำให้ใช้งานได้ › การทำให้ใช้งานได้รายการใหม่ › ประเภท "เว็บแอป" · ดำเนินการในฐานะ "ฉัน" · ผู้มีสิทธิ์เข้าถึง "ทุกคน"
 *   4) คัดลอก URL เว็บแอป → Vercel: ORDER_LOG_URL = URL นั้น · ORDER_LOG_SECRET = รหัสเดียวกับข้อ 2 → Redeploy
 * "ทุกคน" เข้าถึงได้แค่ส่งข้อมูลเข้ามา และต้องมีรหัส SECRET ตรง ถึงจะเขียนลงชีทได้ (ไม่มีใครอ่านชีทผ่าน URL นี้ได้)
 */
const SHEET_NAME = 'ออเดอร์ LINE';
const TZ = 'Asia/Bangkok';
const HEADERS = [
  'วันที่', 'รหัสออเดอร์', 'สถานะ', 'สินค้า', 'ตัวเลือก', 'ป้ายภาษี พรบ.', 'ราคาสินค้า', 'ราคาป้ายภาษี', 'ค่าส่ง', 'ยอดชำระ',
  'ชื่อผู้รับ', 'เบอร์', 'ที่อยู่', 'รหัสไปรษณีย์', 'หมายเหตุ', 'ชื่อ LINE', 'LINE user ID', 'อัปเดตสถานะเมื่อ', 'เลขพัสดุ',
];
const COL_CODE = 2, COL_STATUS = 3, COL_LINE_ID = 17, COL_UPDATED = 18, COL_TRACKING = 19;
const PAID = ['ชำระแล้ว', 'จัดส่งแล้ว']; // นับเป็นยอดขาย

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
      const details = [o.product, o.picks, o.tax ? 'เพิ่ม' : '-', o.base, o.taxPrice, o.shipping, o.total, o.name, "'" + o.phone, o.address, "'" + o.zip, o.note, o.lineName, o.lineUserId];
      const row = findRow_(sh, o.code);
      if (row) {
        // แอดมินกดสถานะไปก่อนข้อมูลจะมาถึง (มีแถวสถานะอยู่แล้ว) → เติมรายละเอียดลงแถวเดิม ไม่ซ้ำ · คงสถานะเดิมไว้
        sh.getRange(row, 4, 1, details.length).setValues([details]);
        return reply({ ok: true, merged: true });
      }
      sh.appendRow([now, o.code, data.status || 'รอตรวจสลิป'].concat(details).concat([now]));
      return reply({ ok: true });
    }
    if (data.action === 'summary') return reply(weeklySummary_(sh, data.days || 7));
    // แอดมินใส่เลขพัสดุ (ผ่านแชทบอท) → คอลัมน์ เลขพัสดุ + สถานะ จัดส่งแล้ว
    if (data.action === 'set_tracking') {
      const row = findRow_(sh, data.code);
      if (!row) return reply({ ok: false, error: 'not found' });
      sh.getRange(row, COL_TRACKING).setValue("'" + data.tracking);
      sh.getRange(row, COL_STATUS).setValue('จัดส่งแล้ว');
      sh.getRange(row, COL_UPDATED).setValue(now);
      return reply({ ok: true });
    }
    // ลูกค้ากดปุ่ม ขอเลขพัสดุ → ส่งเลข + LINE user ID ของออเดอร์ (บอทเช็คว่าเป็นเจ้าของออเดอร์)
    if (data.action === 'get_tracking') {
      const row = findRow_(sh, data.code);
      if (!row) return reply({ ok: true, found: false });
      const r = sh.getRange(row, 1, 1, COL_TRACKING).getValues()[0];
      return reply({ ok: true, found: true, tracking: String(r[COL_TRACKING - 1] || '').replace(/^'/, '').trim(), lineUserId: String(r[COL_LINE_ID - 1] || ''), status: String(r[COL_STATUS - 1]) });
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
  const props = PropertiesService.getScriptProperties();
  let sheet = '';
  try { sheet = sheet_().getParent().getName(); } catch (err) { sheet = 'เปิดชีทไม่ได้: ' + err; }
  return reply({ ok: true, note: 'XERR order log พร้อมใช้งาน', secretSet: Boolean(props.getProperty('SECRET')), sheet: sheet });
}

function sheet_() {
  // สคริปต์ที่สร้างจาก script.google.com (ไม่ได้ผูกกับชีท) → ใช้ชีทตาม Script Property SHEET_ID
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
    sh.getRange('G:J').setNumberFormat('#,##0');
  }
  // ชีทที่สร้างก่อนมีคอลัมน์ เลขพัสดุ → เติมหัวคอลัมน์ให้
  if (sh.getRange(1, COL_TRACKING).getValue() !== 'เลขพัสดุ') sh.getRange(1, COL_TRACKING).setValue('เลขพัสดุ');
  return sh;
}

// สรุปยอด N วันล่าสุด (นับจากวันที่ลงออเดอร์) → ลงแท็บ "สรุปรายสัปดาห์" + ส่งกลับให้บอทส่งเข้า LINE แอดมิน
// ยอดขาย = เฉพาะออเดอร์สถานะ "ชำระแล้ว"
const SUMMARY_SHEET = 'สรุปรายสัปดาห์';
const SUMMARY_HEADERS = ['ส่งสรุปเมื่อ', 'ตั้งแต่', 'ถึง', 'ออเดอร์ชำระแล้ว', 'ยอดขาย', 'เพิ่มป้ายภาษี', 'รอตรวจสลิป', 'ยอดไม่ตรง', 'แยกตามสินค้า'];

function weeklySummary_(sh, days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const s = { paidCount: 0, paidTotal: 0, taxCount: 0, waiting: 0, mismatch: 0, byProduct: {} };
  rows.forEach(function (r) {
    const at = toDate_(r[0]);
    if (!at || at < from || at > to) return;
    const status = String(r[COL_STATUS - 1]);
    if (status === 'รอตรวจสลิป') s.waiting++;
    if (status === 'ยอดไม่ตรง') s.mismatch++;
    if (PAID.indexOf(status) < 0) return;
    const total = Number(r[9]) || 0;
    s.paidCount++;
    s.paidTotal += total;
    if (String(r[5]) === 'เพิ่ม') s.taxCount++;
    const product = String(r[3] || 'ไม่ระบุสินค้า');
    const p = s.byProduct[product] || (s.byProduct[product] = { count: 0, total: 0 });
    p.count++;
    p.total += total;
  });
  const fmt = function (d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); };
  const result = { ok: true, from: fmt(from), to: fmt(to), paidCount: s.paidCount, paidTotal: s.paidTotal, taxCount: s.taxCount, waiting: s.waiting, mismatch: s.mismatch, byProduct: s.byProduct };

  const ss = sh.getParent();
  let sum = ss.getSheetByName(SUMMARY_SHEET);
  if (!sum) {
    sum = ss.insertSheet(SUMMARY_SHEET);
    sum.appendRow(SUMMARY_HEADERS);
    sum.setFrozenRows(1);
    sum.getRange(1, 1, 1, SUMMARY_HEADERS.length).setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
    sum.getRange('E:E').setNumberFormat('#,##0');
  }
  const products = Object.keys(s.byProduct).map(function (k) { return k + ' ' + s.byProduct[k].count + ' (' + s.byProduct[k].total + ')'; }).join(' · ');
  sum.appendRow([Utilities.formatDate(to, TZ, 'yyyy-MM-dd HH:mm'), result.from, result.to, s.paidCount, s.paidTotal, s.taxCount, s.waiting, s.mismatch, products]);
  return result;
}

// วันที่ในชีท: Google แปลงเป็น Date ให้เอง หรือยังเป็นข้อความ "yyyy-MM-dd HH:mm" (เวลาไทย)
function toDate_(v) {
  if (v instanceof Date) return v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + ('0' + (m[4] || '0')).slice(-2) + ':' + (m[5] || '00') + ':00+07:00') : null;
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
