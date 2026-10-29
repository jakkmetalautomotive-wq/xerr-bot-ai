// รูปที่ลบพื้นหลังแล้ว (ตัวสินค้าบนพื้นขาว) อยู่ใน public/products/<id>.jpg — เฉพาะกรอบป้ายอะคริลิค (42 รูป) — จักรเลือก 30 ต.ค. 2026 · สินค้าอื่นใช้รูปต้นฉบับ
// ค่า = ลายนิ้วมือ (sha1) ของรูปต้นฉบับใน Drive ตอนที่ตัด · จักรอัปโหลดเวอร์ชันใหม่ → ลายนิ้วมือไม่ตรง → ใช้รูปใหม่จาก Drive แทนอัตโนมัติ
export const CLEAN_PHOTOS: Record<string, string> = {
  "1ObHYDZaanBdC3UhtulEtHT41kmFgfrGh": "23879e4b732c41446e41ebd65e4b1cecb03814ec", // อะคริลิค สี สีดำ มีเส้นขอบ (+1 การ์ด)
  "1f-jaB0clYwpcbD0cHq0jo-C4WRWUyzYS": "e3156668f08671bf76803ad7e5330102c9571aa0", // อะคริลิค สี สีดำ ไร้เส้นขอบ
  "1Bk9tNOmRx0WlxdyIHuywAYgKKnGYuFAr": "4c69353ff39649782d6e741a14c35e09d7dc6609", // อะคริลิค สี สีขาว มีเส้นขอบ
  "1Bc_jT1pwapeYlJnifEfiI_jctIt1hu8w": "5a9c32bbb42f577fc0e884ad822e5121bfe2ad3d", // อะคริลิค สี สีขาว ไร้เส้นขอบ
  "1n0xoAFjp5HDd8t_bJ59ZDZieHgcBFCyT": "c4dc056e112b433394679d775607dfab633b46d8", // อะคริลิค สี สีเทา มีเส้นขอบ
  "14RPn5ODPEMbqh0Mbqaqz-V6yuYWH-pFn": "968ff94696928797b42a359a4dc8f063cc2da6b9", // อะคริลิค สี สีเทา ไร้เส้นขอบ
  "15UyD2nLQugAuI4-F8Ezdkz3YpnrfbwRe": "8f9c6689be2b9f3714410c971c547dac4f4ce207", // อะคริลิค สี ลายเคฟล่า ดำ มีเส้นขอบ
  "1FlW6iibbam4RdKeJG0TUB3afz2ghnLnq": "04497ff13762cd2d41e57fc0fe1731c480f39e4c", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีดำ มีเส้นขอบ
  "1mWrtE62y7tdMG8WErkXH7uwCGxZcHpVl": "8a6227293cfa7ce2cf96cf2bbd0edc6f17968528", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีดำ ไร้เส้นขอบ
  "127L_zbSGsLxSyn9cqXK5G6mA6y78blV7": "7045e47c78d3645775c70eb9d662989784ace2e1", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีขาว มีเส้นขอบ
  "1x_OO49-VXTB_R9b4MfhKWVZujInAV53W": "4f211b429eb86b8743a6fb3319be152baf8a9e7e", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีขาว ไร้เส้นขอบ
  "1LRc1yj2Q_bgUm1qsqwf9FWuSBU8V_SpL": "6434335e3953c5352a4b16c7719c3a5d33964f47", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีเทา มีเส้นขอบ
  "1enKtjEX68h-Qb1lzo08RSf2hE2EJKO9k": "3a56182643cacfdf821c1afd0714badd5fc20d5b", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก สีเทา ไร้เส้นขอบ
  "1EvnP_5z-CX7w7BdNBm3F3Xpl4c3NFzVY": "8a0b990b789477433c658d003732975410fea10b", // อะคริลิค ขนาด สั้น-สั้น · หลังเลือก เคฟล่า
  "1kDIlMmdNoPmZnYLlzMXirxntVlZDSYU-": "23879e4b732c41446e41ebd65e4b1cecb03814ec", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีดำ มีเส้นขอบ
  "1gFuPHekCbWgO_QByIgMgXp0Ely3FWL01": "e3156668f08671bf76803ad7e5330102c9571aa0", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีดำ ไร้เส้นขอบ
  "1EiF--8BRR_41iaAYS9XuJXyFRVMDTXz2": "4c69353ff39649782d6e741a14c35e09d7dc6609", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีขาว มีเส้นขอบ
  "1CJ6dXRluUnO9NirTEFbcwAOAErO5AfQF": "5a9c32bbb42f577fc0e884ad822e5121bfe2ad3d", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีขาว ไร้เส้นขอบ
  "1BtRbn3P39BJrXeGwoxK2bICNODa-umJR": "c4dc056e112b433394679d775607dfab633b46d8", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีเทา มีเส้นขอบ
  "1ynSs_Ou_VIJG9B7IPCaGgst5tsHPvzQP": "968ff94696928797b42a359a4dc8f063cc2da6b9", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก สีเทา ไร้เส้นขอบ
  "17jNY6cKQtBJBgaCV610H9-oxVBvsqPLx": "8f9c6689be2b9f3714410c971c547dac4f4ce207", // อะคริลิค ขนาด สั้น-ยาว · หลังเลือก เคฟล่า
  "1zACDwk5KM6adU38sC-ox4aHiKDPxhfGQ": "e8a85ee87431652037bfed4c4c201dca2014c564", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีดำ มีเส้นขอบ
  "1tl6gvmJEqlV0Bai-bJSfpMJS8h4sqdBY": "8af5d2b86325f2a333b42d6632a693327f9a1855", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีดำ ไร้เส้นขอบ
  "1hy27d_Z0-yPcosQqNQ-3VMCXSXkPpN5r": "2469141849078eb5a1fa9b50413d846785269e88", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีขาว มีเส้นขอบ
  "1Sd-YYoJxTtYzSU25-8V8p7Uxp7l-fECv": "cb0e2ebc9d2d21506251cfec83655673f60e61be", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีขาว ไร้เส้นขอบ
  "1xa-8_-G_VeOUoa35pkOgfXbWhz4-FFfU": "6c9243a53ccc4354efcb5e12984be94704ac400a", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีเทา มีเส้นขอบ
  "1CfWNC6D4Ut5nYSIUakJXXgsPFjDm8jOI": "97b73632480e25098d4914cb25e761c5d049d714", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก สีเทา ไร้เส้นขอบ
  "10tdDU2byg_VYzM3Wc1C-A6u_UF24ReAt": "2cac4cff8b183efdc9d9b2064cad0a1c73067f85", // อะคริลิค ขนาด ยาว-ยาว · หลังเลือก เคฟล่า
  "1tKfPrhPhwUBbo60kaIImSsCzMUoid1EP": "212b6f1d13406d0dbdedde2ff47b6b55b52238d7", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีดำ มีเส้นขอบ
  "1_4nnP3o97N6mVoZrklUZuu9Q24uL5AaA": "810be4eb6f0e10c49c9d2e574a217a119ce76056", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีดำ ไร้เส้นขอบ
  "1WO5Js6IoyOqgasdzlgkrk86eienEobWg": "7248eec1c6bba3f8595ff8b2a7b458d32f12d500", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีขาว มีเส้นขอบ
  "1ORK9I7P2cVTKm92lh_kjPFt0mh6Cv0sP": "bef28af591c918358322116c06fc215a38d13bd0", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีขาว ไร้เส้นขอบ
  "1_00_lctue9apYqp-r2b0XhFteL6Rcssq": "c6023f81a428716d633434c45a27e75cae487217", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีเทา มีเส้นขอบ
  "19Uxy0BPvp1sP9xqDFKAWdjGx6py-nJlW": "07d5f51b4e999f613edf79cb794fe437d16f7841", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก สีเทา ไร้เส้นขอบ
  "1gP84LSaYFk1j5MzDAHe2WteWU_FvtE0B": "c699b046e0b7e90235d7df17c4804429596f299e", // อะคริลิค เส้นคาดกลาง มีเส้นคาดกลาง · หลังเลือก เคฟล่า
  "14lsmzpjO2vJR21NLZly11zArLaqwcU6s": "23879e4b732c41446e41ebd65e4b1cecb03814ec", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีดำ มีเส้นขอบ
  "13Rg89Gks42-HJbUwm2yzaXugMmehis_c": "e3156668f08671bf76803ad7e5330102c9571aa0", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีดำ ไร้เส้นขอบ
  "123bQxpKGcnG_lisZ_LRRWcGb2X-E36RC": "4c69353ff39649782d6e741a14c35e09d7dc6609", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีขาว มีเส้นขอบ
  "1CqCAdaXC5GpIqWyKqtrT49joR0_EjDVu": "5a9c32bbb42f577fc0e884ad822e5121bfe2ad3d", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีขาว ไร้เส้นขอบ
  "1CAUUx62YVu0mXKORhoFWZoXXPAXOm1ky": "c4dc056e112b433394679d775607dfab633b46d8", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีเทา มีเส้นขอบ
  "1eK8f5P7tlmHG-T7TRsaez8j_EjvJzkTe": "5abec856b6361b03fd60c5e243409caf98acdd48", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก สีเทา ไร้เส้นขอบ
  "1MUgrrN9Y2ZZToufBJmYEVgN-HjhB6Ols": "8f9c6689be2b9f3714410c971c547dac4f4ce207", // อะคริลิค เส้นคาดกลาง ไม่มีเส้นคาดกลาง · หลังเลือก เคฟล่า
};
