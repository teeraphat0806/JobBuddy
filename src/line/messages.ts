import { formatPrefs } from '../prefs/format.js';
import type { PrefsInput } from '../prefs/types.js';
import type { OutgoingMessage } from './messenger.js';
import { postbackButton, sayButton, text } from './ui.js';

const nameOf = (displayName?: string | null) => (displayName ? `คุณ${displayName}` : 'คุณ');

export function welcome(displayName?: string | null): OutgoingMessage {
  return text(
    `สวัสดี${nameOf(displayName)} 👋 ยินดีต้อนรับสู่ JobBuddy\n\n` +
      'ผู้ช่วยหางานที่รวมทุกอย่างไว้ใน LINE:\n' +
      '🔍 หางานที่ตรงกับคุณจากหลายแหล่ง\n' +
      '✅ บันทึกงานที่สมัครไว้ ย้อนดูได้\n' +
      '📅 จดวันสัมภาษณ์ พร้อมเตือนล่วงหน้า\n' +
      '📝 จดโน้ต และแชร์งานให้เพื่อน',
  );
}

export function welcomeBack(displayName?: string | null): OutgoingMessage {
  return text(`ยินดีต้อนรับกลับมา${nameOf(displayName)} 👋`);
}

export function consentPrompt(): OutgoingMessage {
  return text(
    '🔒 ก่อนเริ่มใช้งาน ขอแจ้งเรื่องข้อมูลส่วนตัว (PDPA)\n\n' +
      'JobBuddy จะเก็บ:\n' +
      '• ชื่อและรูปโปรไฟล์ LINE\n' +
      '• งานที่คุณตั้งค่า บันทึก สมัคร และโน้ตที่จด\n' +
      '• ตำแหน่งบ้าน/ที่พัก ถ้าคุณส่งมาเอง (ใช้คำนวณระยะทางเท่านั้น)\n\n' +
      'ใช้เพื่อหางานและเตือนนัดให้คุณเท่านั้น ไม่ขายหรือส่งต่อให้ใคร\n' +
      'ลบข้อมูลทั้งหมดได้ทุกเมื่อ โดยพิมพ์ "ลบข้อมูลของฉัน"',
    [postbackButton('✅ ยอมรับและเริ่มใช้งาน', { a: 'consent', v: 'accept' }, 'ยอมรับ')],
  );
}

export function helpMessage(): OutgoingMessage {
  return text(
    '❓ วิธีใช้ JobBuddy\n\n' +
      '⚙️ ตั้งค่างาน — บอกว่าอยากได้งานแบบไหน\n' +
      '🔍 งานใหม่วันนี้ — ดูงานที่ตรงกับคุณ\n' +
      '⭐ ที่เก็บไว้ / 📋 ที่สมัครไว้ — ย้อนดูงาน\n' +
      '📅 นัดสัมภาษณ์ — ดูนัดและการเตือน\n\n' +
      '📥 เจองานจากเว็บไหนก็ได้ ส่งลิงก์มาในแชท ระบบจะบันทึกให้\n' +
      '📝 กด "โน้ต" ที่การ์ดงานเพื่อจดโน้ต · 🔄 อัปเดตสถานะการสมัครได้\n' +
      '📅 กด "นัดสัมภาษณ์" ที่การ์ดงานที่สมัครไว้ แล้วระบบจะเตือนก่อนวันนัด\n' +
      '🏠 ตั้งบ้าน/คอนโด แล้วการ์ดงานจะบอกระยะทางให้\n\n' +
      'ใช้ปุ่มเมนูด้านล่างได้เลย หรือพิมพ์:\n' +
      '• "ตั้งค่า" — ตั้งค่างานที่อยากได้\n' +
      '• "นัด" — ดูนัดสัมภาษณ์ · "ปิดเตือน" / "เปิดเตือน"\n' +
      '• "บ้าน" — ตั้งที่พักเพื่อดูระยะทางไปทำงาน\n' +
      '• "ลบข้อมูลของฉัน" — ลบข้อมูลทั้งหมด',
    [sayButton('⚙️ ตั้งค่า', 'ตั้งค่า')],
  );
}

export function notUnderstood(): OutgoingMessage {
  return text('ผมยังไม่เข้าใจข้อความนี้ครับ 😅 ลองใช้เมนูด้านล่าง หรือกดปุ่มนี้', [
    sayButton('❓ วิธีใช้', 'วิธีใช้'),
    sayButton('⚙️ ตั้งค่า', 'ตั้งค่า'),
  ]);
}

const FEATURE_NAMES: Record<string, string> = {
  feed: '🔍 งานใหม่วันนี้',
  saved: '⭐ งานที่เก็บไว้',
  applied: '📋 งานที่สมัครไว้',
  interviews: '📅 นัดสัมภาษณ์',
};

export function comingSoon(feature: string): OutgoingMessage {
  const name = FEATURE_NAMES[feature] ?? 'ฟีเจอร์นี้';
  return text(`${name} กำลังพัฒนาอยู่ครับ 🚧 เร็วๆ นี้ใช้ได้แน่นอน`);
}

export function currentPrefs(prefs: PrefsInput): OutgoingMessage {
  return text(`งานที่คุณมองหาตอนนี้ 👇\n\n${formatPrefs(prefs)}`, [
    postbackButton('✏️ แก้ไข', { a: 'prefs', v: 'edit' }),
  ]);
}

export function replyFailed(): OutgoingMessage {
  return text('ขออภัยครับ 🙏 แสดงผลไม่สำเร็จ ทีมงานได้รับแจ้งแล้ว ลองใหม่อีกครั้งภายหลังนะครับ');
}

export function needsPrefs(): OutgoingMessage {
  return text('ก่อนหางาน ขอรู้ก่อนว่าคุณอยากได้งานแบบไหนครับ 🙂');
}

export function wizardExpired(): OutgoingMessage {
  return text('การตั้งค่าหมดเวลาแล้วครับ ⏰ เริ่มใหม่ได้เลย', [
    postbackButton('⚙️ ตั้งค่างานใหม่', { a: 'prefs', v: 'edit' }),
  ]);
}

export function deleteConfirm(): OutgoingMessage {
  return text(
    '⚠️ ต้องการลบข้อมูลทั้งหมดของคุณใช่ไหมครับ?\n' +
      'งานที่ตั้งค่า บันทึก สมัคร โน้ต และที่พักทั้งหมดจะถูกลบถาวร กู้คืนไม่ได้',
    [
      postbackButton('🗑️ ลบทั้งหมด', { a: 'delete', v: 'confirm' }),
      postbackButton('ไม่ลบ', { a: 'delete', v: 'cancel' }),
    ],
  );
}

export function deleted(): OutgoingMessage {
  return text('ลบข้อมูลทั้งหมดของคุณเรียบร้อยแล้วครับ 🗑️\nถ้าอยากกลับมาใช้ใหม่ ทักมาได้ทุกเมื่อ');
}

export function deleteCancelled(): OutgoingMessage {
  return text('โอเคครับ ไม่ได้ลบอะไร 👍');
}
