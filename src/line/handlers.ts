import type { webhook } from '@line/bot-sdk';
import type { SessionRepository } from '../conversation/repository.js';
import type { User } from '../db/schema.js';
import { errorFields, type Logger } from '../lib/logger.js';
import type { PrefsRepository } from '../prefs/repository.js';
import {
  advanceWizard,
  asWizardState,
  startWizard,
  WIZARD_FLOW,
  type WizardInput,
  type WizardResult,
} from '../prefs/wizard.js';
import type { LineProfile, UserRepository } from '../users/repository.js';
import * as msg from './messages.js';
import type { LineMessenger, OutgoingMessage } from './messenger.js';
import { decodePostback, type PostbackData } from './postback.js';

export interface HandlerDeps {
  users: UserRepository;
  prefs: PrefsRepository;
  sessions: SessionRepository;
  line: LineMessenger;
  logger: Logger;
}

export type EventsHandler = (events: webhook.Event[]) => Promise<void>;

/** What the user did, normalised from text messages and postbacks. */
type Input =
  { kind: 'text'; text: string } | { kind: 'postback'; data: PostbackData } | { kind: 'other' };

const HELP_WORDS = ['วิธีใช้', 'help', 'เมนู', 'ช่วยด้วย', '?'];
const PREFS_WORDS = ['ตั้งค่า', 'ตั้งค่างาน', 'settings'];
const DELETE_WORDS = ['ลบข้อมูลของฉัน', 'ลบข้อมูล'];

function userIdOf(event: webhook.Event): string | undefined {
  return event.source?.type === 'user' ? event.source.userId : undefined;
}

function inputOf(event: webhook.Event): Input | undefined {
  if (event.type === 'postback')
    return { kind: 'postback', data: decodePostback(event.postback.data) };
  if (event.type === 'message') {
    return event.message.type === 'text'
      ? { kind: 'text', text: event.message.text.trim() }
      : { kind: 'other' };
  }
  return undefined;
}

export function createEventsHandler(deps: HandlerDeps): EventsHandler {
  const { users, prefs, sessions, line, logger } = deps;

  /** Persist a wizard step's outcome and return what to reply. */
  async function applyWizard(user: User, result: WizardResult): Promise<OutgoingMessage[]> {
    if (result.kind === 'continue') await sessions.set(user.id, WIZARD_FLOW, result.state);
    else {
      if (result.kind === 'save') await prefs.save(user.id, result.prefs);
      await sessions.clear(user.id);
    }
    return result.messages;
  }

  async function showOrStartPrefs(user: User): Promise<OutgoingMessage[]> {
    const existing = await prefs.get(user.id);
    if (existing) return [msg.currentPrefs(existing)];
    return applyWizard(user, startWizard());
  }

  async function onFollow(lineUserId: string): Promise<OutgoingMessage[]> {
    let profile: LineProfile = {};
    try {
      profile = await line.getProfile(lineUserId);
    } catch (err) {
      logger.warn('getProfile failed; continuing without profile', errorFields(err));
    }
    const user = await users.upsertOnFollow(lineUserId, profile);
    if (!user.pdpaConsentedAt) return [msg.welcome(user.displayName), msg.consentPrompt()];
    return [msg.welcomeBack(user.displayName), ...(await showOrStartPrefs(user))];
  }

  async function onInput(lineUserId: string, input: Input): Promise<OutgoingMessage[]> {
    const pb = input.kind === 'postback' ? input.data : undefined;
    const typed = input.kind === 'text' ? input.text : undefined;

    // Data deletion works regardless of consent or any in-progress flow.
    if (typed && DELETE_WORDS.includes(typed)) return [msg.deleteConfirm()];
    if (pb?.a === 'delete') {
      if (pb.v !== 'confirm') return [msg.deleteCancelled()];
      await users.deleteByLineUserId(lineUserId);
      return [msg.deleted()];
    }

    const user = await users.ensure(lineUserId);

    if (!user.pdpaConsentedAt) {
      if (pb?.a !== 'consent' || pb.v !== 'accept') return [msg.consentPrompt()];
      await users.recordConsent(user.id);
      return showOrStartPrefs(user);
    }
    if (pb?.a === 'consent') return showOrStartPrefs(user); // double tap on an old button

    // Menu taps always win, abandoning any half-finished flow.
    if (pb?.a === 'menu') {
      await sessions.clear(user.id);
      switch (pb.m) {
        case 'prefs':
          return showOrStartPrefs(user);
        case 'help':
          return [msg.helpMessage()];
        default:
          return [msg.comingSoon(pb.m ?? '')];
      }
    }
    if (pb?.a === 'prefs' && pb.v === 'edit') return applyWizard(user, startWizard());

    const session = await sessions.get(user.id);
    const wizard = session?.flow === WIZARD_FLOW ? asWizardState(session.state) : null;
    if (wizard) {
      let wizardInput: WizardInput | undefined;
      if (typed !== undefined) wizardInput = { kind: 'text', text: typed };
      else if (pb?.a === 'wiz' && pb.v) wizardInput = { kind: 'choice', value: pb.v };
      if (wizardInput) return applyWizard(user, advanceWizard(wizard, wizardInput));
    }
    if (pb?.a === 'wiz') return [msg.wizardExpired()];

    if (typed !== undefined) {
      const lower = typed.toLowerCase();
      if (PREFS_WORDS.includes(lower)) return showOrStartPrefs(user);
      if (HELP_WORDS.includes(lower)) return [msg.helpMessage()];
    }
    return [msg.notUnderstood()];
  }

  async function handle(event: webhook.Event): Promise<void> {
    const lineUserId = userIdOf(event);
    if (!lineUserId) return; // groups/rooms aren't supported

    if (event.type === 'unfollow') {
      await users.markUnfollowed(lineUserId);
      return;
    }

    let replyToken: string;
    let messages: OutgoingMessage[];

    if (event.type === 'follow') {
      replyToken = event.replyToken;
      messages = await onFollow(lineUserId);
    } else {
      const input = inputOf(event);
      if (!input || !('replyToken' in event) || !event.replyToken) {
        logger.debug('Ignoring unsupported event', { type: event.type });
        return;
      }
      replyToken = event.replyToken;
      messages = await onInput(lineUserId, input);
    }

    // A single reply holds at most 5 messages.
    if (messages.length > 0) await line.reply(replyToken, messages.slice(0, 5));
  }

  return async (events) => {
    // Handle each event independently so one failure doesn't drop the rest.
    const results = await Promise.allSettled(events.map(handle));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error('Event handling failed', {
          eventType: events[i]?.type,
          webhookEventId: events[i]?.webhookEventId,
          ...errorFields(r.reason),
        });
      }
    });
  };
}
