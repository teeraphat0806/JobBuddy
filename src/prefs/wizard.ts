import type { OutgoingMessage } from '../line/messenger.js';
import { postbackButton, sayButton, text } from '../line/ui.js';
import { formatPrefs } from './format.js';
import {
  parseExcluded,
  parseLocations,
  parsePositions,
  parseSalary,
  parseWorkMode,
  type Parsed,
} from './parse.js';
import { WORK_MODE_LABELS, WORK_MODES, type PrefsInput } from './types.js';

/**
 * Preferences setup as a pure state machine: (state, input) -> result.
 * Persistence and LINE I/O live in the event handler, so this is fully unit-testable.
 */
export const WIZARD_FLOW = 'prefs';

export const STEPS = [
  'positions',
  'locations',
  'workMode',
  'minSalary',
  'excluded',
  'confirm',
] as const;
export type Step = (typeof STEPS)[number];

export interface WizardState {
  step: Step;
  draft: Partial<PrefsInput>;
}

/** Text the user typed, or a value chosen from a wizard postback button (`a=wiz&v=...`). */
export type WizardInput = { kind: 'text'; text: string } | { kind: 'choice'; value: string };

export type WizardResult =
  | { kind: 'continue'; state: WizardState; messages: OutgoingMessage[] }
  | { kind: 'save'; prefs: PrefsInput; messages: OutgoingMessage[] }
  | { kind: 'cancel'; messages: OutgoingMessage[] };

const CANCEL_WORDS = ['ยกเลิก', 'cancel', 'ออก'];

const choice = (label: string, value: string) => postbackButton(label, { a: 'wiz', v: value });

const POSITION_SUGGESTIONS = [
  'Data Analyst',
  'Software Engineer',
  'Marketing',
  'บัญชี',
  'HR',
  'Sales',
  'Graphic Designer',
];

function prompt(step: Step, draft: Partial<PrefsInput>): OutgoingMessage {
  switch (step) {
    case 'positions':
      return text(
        '1/5 💼 อยากได้งานตำแหน่งอะไรครับ?\n' +
          'พิมพ์ได้หลายตำแหน่ง คั่นด้วยเครื่องหมาย , (สูงสุด 5)\n' +
          'เช่น Data Analyst, Business Analyst',
        POSITION_SUGGESTIONS.map((p) => sayButton(p)),
      );
    case 'locations':
      return text('2/5 📍 อยากทำงานแถวไหนครับ?\nพิมพ์จังหวัดหรือเขตได้เลย คั่นด้วย ,', [
        sayButton('กรุงเทพฯ'),
        sayButton('กรุงเทพฯ และปริมณฑล', 'กรุงเทพฯ, นนทบุรี, ปทุมธานี, สมุทรปราการ'),
        sayButton('ชลบุรี'),
        sayButton('เชียงใหม่'),
        sayButton('ทั่วประเทศ'),
      ]);
    case 'workMode':
      return text(
        '3/5 🏢 สะดวกทำงานรูปแบบไหนครับ?',
        WORK_MODES.map((m) => choice(WORK_MODE_LABELS[m], m)),
      );
    case 'minSalary':
      return text(
        '4/5 💰 เงินเดือนขั้นต่ำที่ต้องการ (บาท/เดือน)?\nพิมพ์ตัวเลขเองก็ได้ เช่น 28000',
        [
          choice('ไม่ระบุ', 'none'),
          sayButton('15,000', '15000'),
          sayButton('20,000', '20000'),
          sayButton('30,000', '30000'),
          sayButton('40,000', '40000'),
          sayButton('60,000', '60000'),
        ],
      );
    case 'excluded':
      return text(
        '5/5 🚫 มีคำที่ไม่อยากเห็นในประกาศงานไหมครับ?\nเช่น ขายประกัน, MLM (ไม่มีกด "ข้าม")',
        [choice('ข้าม', 'none'), sayButton('ขายประกัน'), sayButton('ขายตรง, MLM')],
      );
    case 'confirm':
      return text(`สรุปงานที่คุณมองหา 👇\n\n${formatPrefs(complete(draft))}\n\nถูกต้องไหมครับ?`, [
        choice('✅ บันทึก', 'save'),
        choice('✏️ เริ่มใหม่', 'restart'),
        choice('❌ ยกเลิก', 'cancel'),
      ]);
  }
}

function complete(d: Partial<PrefsInput>): PrefsInput {
  return {
    positions: d.positions ?? [],
    locations: d.locations ?? [],
    workMode: d.workMode ?? 'any',
    minSalary: d.minSalary ?? null,
    excludedKeywords: d.excludedKeywords ?? [],
  };
}

export function startWizard(): WizardResult & { kind: 'continue' } {
  const state: WizardState = { step: 'positions', draft: {} };
  return {
    kind: 'continue',
    state,
    messages: [
      text('มาตั้งค่างานที่อยากได้กันครับ ✨ มี 5 คำถามสั้นๆ (พิมพ์ "ยกเลิก" ได้ตลอด)'),
      prompt(state.step, state.draft),
    ],
  };
}

function next(step: Step): Step {
  return STEPS[STEPS.indexOf(step) + 1] ?? 'confirm';
}

function apply(state: WizardState, raw: string): Parsed<Partial<PrefsInput>> {
  const map = <T>(p: Parsed<T>, f: (v: T) => Partial<PrefsInput>): Parsed<Partial<PrefsInput>> =>
    p.ok ? { ok: true, value: f(p.value) } : p;
  switch (state.step) {
    case 'positions':
      return map(parsePositions(raw), (positions) => ({ positions }));
    case 'locations':
      return map(parseLocations(raw), (locations) => ({ locations }));
    case 'workMode':
      return map(parseWorkMode(raw), (workMode) => ({ workMode }));
    case 'minSalary':
      return map(parseSalary(raw === 'none' ? 'ไม่ระบุ' : raw), (minSalary) => ({ minSalary }));
    case 'excluded':
      return map(parseExcluded(raw === 'none' ? 'ข้าม' : raw), (excludedKeywords) => ({
        excludedKeywords,
      }));
    case 'confirm':
      return { ok: false, error: 'กดปุ่ม ✅ บันทึก หรือ ✏️ เริ่มใหม่ ด้านล่างได้เลยครับ' };
  }
}

export function advanceWizard(state: WizardState, input: WizardInput): WizardResult {
  const raw = input.kind === 'text' ? input.text.trim() : input.value;

  if (CANCEL_WORDS.includes(raw.toLowerCase())) {
    return {
      kind: 'cancel',
      messages: [text('ยกเลิกการตั้งค่าแล้วครับ กด ⚙️ ตั้งค่างาน ได้ทุกเมื่อ')],
    };
  }

  if (state.step === 'confirm' && input.kind === 'choice') {
    if (raw === 'save') {
      const prefs = complete(state.draft);
      return {
        kind: 'save',
        prefs,
        messages: [
          text(
            `บันทึกแล้ว ✅\n\n${formatPrefs(prefs)}\n\n` +
              'กด 🔍 ดูงานเลย หรือเมนู งานใหม่วันนี้ ด้านล่างได้ทุกเมื่อครับ',
            [postbackButton('🔍 ดูงานเลย', { a: 'feed', p: '1' })],
          ),
        ],
      };
    }
    if (raw === 'restart') return startWizard();
  }

  const result = apply(state, raw);
  if (!result.ok) {
    return {
      kind: 'continue',
      state,
      messages: [text(`⚠️ ${result.error}`), prompt(state.step, state.draft)],
    };
  }

  const nextState: WizardState = {
    step: next(state.step),
    draft: { ...state.draft, ...result.value },
  };
  return {
    kind: 'continue',
    state: nextState,
    messages: [prompt(nextState.step, nextState.draft)],
  };
}

/** Narrow unknown JSON from the DB back into a WizardState (null if it's not one). */
export function asWizardState(value: unknown): WizardState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { step?: unknown; draft?: unknown };
  if (typeof v.step !== 'string' || !(STEPS as readonly string[]).includes(v.step)) return null;
  if (typeof v.draft !== 'object' || v.draft === null) return null;
  return { step: v.step as Step, draft: v.draft as Partial<PrefsInput> };
}
