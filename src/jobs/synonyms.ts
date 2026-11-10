/**
 * Most postings from these boards are in English, but users often type Thai.
 * Maps a typed role (lower-case) to extra English phrases to look for in titles.
 */
const SYNONYMS: Record<string, string[]> = {
  บัญชี: ['accountant', 'accounting', 'accounts payable', 'accounts receivable', 'bookkeeper'],
  นักบัญชี: ['accountant', 'accounting'],
  การเงิน: ['finance', 'financial', 'treasury'],
  // Avoid phrases like "brand manager": "manager" is a noise word, so it would reduce to
  // "brand" and match designers.
  การตลาด: ['marketing', 'brand marketing', 'growth'],
  ขาย: ['sales', 'business development', 'account executive'],
  ฝ่ายขาย: ['sales', 'business development'],
  บุคคล: ['hr', 'human resources', 'people', 'talent', 'recruiter', 'recruitment'],
  ทรัพยากรบุคคล: ['hr', 'human resources', 'people', 'talent'],
  hr: ['human resources', 'people', 'talent', 'recruiter', 'recruitment'],
  สรรหา: ['recruiter', 'recruitment', 'talent acquisition'],
  วิศวกร: ['engineer'],
  โปรแกรมเมอร์: ['software engineer', 'developer', 'programmer'],
  นักพัฒนา: ['developer', 'software engineer'],
  นักพัฒนาซอฟต์แวร์: ['software engineer', 'developer'],
  'software engineer': ['software developer', 'developer'],
  developer: ['software engineer'],
  วิเคราะห์ข้อมูล: ['data analyst', 'analyst', 'analytics'],
  นักวิเคราะห์ข้อมูล: ['data analyst', 'analytics'],
  'data analyst': ['analytics', 'business intelligence', 'bi analyst'],
  ba: ['business analyst'],
  qa: ['quality assurance', 'tester', 'test engineer'],
  ทดสอบ: ['qa', 'tester', 'quality assurance'],
  ออกแบบ: ['designer', 'design'],
  กราฟิก: ['graphic designer', 'designer'],
  'graphic designer': ['visual designer', 'designer'],
  'ux/ui': ['ux', 'ui', 'product designer'],
  ux: ['user experience', 'product designer'],
  ui: ['ui designer', 'product designer'],
  บริการลูกค้า: ['customer service', 'customer support', 'customer experience', 'customer success'],
  คอลเซ็นเตอร์: ['call center', 'customer service', 'customer support'],
  โลจิสติกส์: ['logistics', 'supply chain', 'warehouse', 'operations'],
  ซัพพลายเชน: ['supply chain'],
  จัดซื้อ: ['procurement', 'purchasing', 'buyer', 'sourcing'],
  ไอที: ['it', 'information technology', 'it support'],
  it: ['information technology', 'it support', 'helpdesk'],
  กฎหมาย: ['legal', 'lawyer', 'counsel', 'compliance'],
  ธุรการ: ['admin', 'administrative', 'administrator', 'coordinator', 'assistant'],
  แอดมิน: ['admin', 'administrative', 'coordinator'],
  เลขานุการ: ['secretary', 'executive assistant'],
  ผลิต: ['production', 'manufacturing'],
  วิศวกรผลิต: ['production engineer', 'manufacturing engineer', 'process engineer'],
  ซ่อมบำรุง: ['maintenance'],
  คุณภาพ: ['quality', 'qa', 'qc'],
  โรงแรม: ['hotel', 'hospitality', 'front office', 'guest'],
  พ่อครัว: ['chef', 'cook', 'culinary'],
  เชฟ: ['chef', 'culinary'],
  แปล: ['translator', 'interpreter', 'localization'],
  คอนเทนต์: ['content', 'copywriter', 'writer'],
  นักเขียน: ['writer', 'copywriter', 'content'],
  ผู้จัดการ: ['manager'],
  ผู้จัดการโครงการ: ['project manager', 'program manager'],
  'project manager': ['program manager', 'project lead'],
  'product manager': ['product owner'],
  ฝึกงาน: ['intern', 'internship', 'trainee', 'graduate'],
  นักศึกษาฝึกงาน: ['intern', 'internship'],
  จบใหม่: ['graduate', 'junior', 'entry level', 'trainee'],
};

/** All phrases (lower-case) to try for one role the user typed. */
export function expandRole(role: string): string[] {
  const key = role.trim().toLowerCase();
  return [key, ...(SYNONYMS[key] ?? [])];
}
