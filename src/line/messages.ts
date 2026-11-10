import type { OutgoingMessage } from './messenger.js';

export function welcomeMessages(displayName?: string): OutgoingMessage[] {
  const name = displayName ? `คุณ${displayName}` : 'คุณ';
  return [
    {
      type: 'text',
      text:
        `สวัสดี${name} 👋 ยินดีต้อนรับสู่ JobBuddy\n\n` +
        'ผู้ช่วยหางานที่รวมทุกอย่างไว้ใน LINE:\n' +
        '📥 ส่งลิงก์งานมา เดี๋ยวจดให้\n' +
        '✅ บันทึกงานที่สมัครไว้ ย้อนดูได้\n' +
        '📅 จดวันสัมภาษณ์ พร้อมเตือนล่วงหน้า\n' +
        '📝 จดโน้ตแต่ละงาน',
    },
    helpMessage(),
  ];
}

export function helpMessage(): OutgoingMessage {
  return {
    type: 'text',
    text: '🚧 ตอนนี้ JobBuddy กำลังพัฒนาอยู่ เร็วๆ นี้จะใช้งานผ่านเมนูด้านล่างได้ครับ',
  };
}
