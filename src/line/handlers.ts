import type { webhook } from '@line/bot-sdk';
import type { SessionRepository } from '../conversation/repository.js';
import type { User } from '../db/schema.js';
import { errorFields, httpStatusOf, type Logger } from '../lib/logger.js';
import type { InterviewRepository } from '../interviews/repository.js';
import type { JobRepository, UserJobRepository } from '../jobs/repository.js';
import { extractAllUrls, extractUrl, type LinkPreviewer } from '../links/preview.js';
import type { DigestRepository } from '../followups/repository.js';
import type { JobDistances } from '../geo/service.js';
import type { LinkImportRepository } from '../links/importRepository.js';
import type { NoteRepository } from '../notes/repository.js';
import type { PlaceRepository } from '../places/repository.js';
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
import {
  asPlaceFlow,
  asTimeFlow,
  createInterviewFlows,
  IV_PLACE_FLOW,
  IV_TIME_FLOW,
  REMINDER_OFF_WORDS,
  REMINDER_ON_WORDS,
} from './interviews.js';
import { createFollowUpFlows } from './followups.js';
import { createJobActions } from './jobActions.js';
import * as msg from './messages.js';
import type { LineMessenger, OutgoingMessage } from './messenger.js';
import { asPlaceNameFlow, createPlaceFlows, PLACE_NAME_FLOW, PLACE_WORDS } from './places.js';
import { decodePostback, type PostbackData } from './postback.js';
import { computeStats, statsMessage, STATS_WORDS } from './stats.js';
import {
  asFlowState,
  createTracking,
  LINK_TITLE_FLOW,
  MAX_LINKS_PER_MESSAGE,
  NOTE_FLOW,
} from './tracking.js';

export interface HandlerDeps {
  users: UserRepository;
  prefs: PrefsRepository;
  sessions: SessionRepository;
  jobs: JobRepository;
  userJobs: UserJobRepository;
  notes: NoteRepository;
  interviews: InterviewRepository;
  previewLink: LinkPreviewer;
  line: LineMessenger;
  logger: Logger;
  getAddFriendUrl?: () => string | undefined;
  timeZone?: string;
  now?: () => Date;
  /** Home / condo locations; distance features are off without them. */
  places?: PlaceRepository;
  distances?: JobDistances;
  /** Queue for messages with many links (saved in the background). */
  linkImports?: { repo: LinkImportRepository; kick: () => void };
  /** Look up the user's tracked job locations in the background (after adding a place). */
  warmDistances?: (user: User) => void;
  /** Follow-up snoozes (the daily digest itself runs on a timer). */
  digests?: DigestRepository;
}

export type EventsHandler = (events: webhook.Event[]) => Promise<void>;

/** What the user did, normalised from text messages and postbacks. */
type Input =
  | { kind: 'text'; text: string }
  | { kind: 'postback'; data: PostbackData }
  | { kind: 'location'; lat: number; lng: number }
  | { kind: 'other' };

const HELP_WORDS = ['วิธีใช้', 'help', 'เมนู', 'ช่วยด้วย', '?'];
const PREFS_WORDS = ['ตั้งค่า', 'ตั้งค่างาน', 'settings'];
const FEED_WORDS = ['งาน', 'งานใหม่', 'งานใหม่วันนี้', 'หางาน', 'jobs'];
const INTERVIEW_WORDS = ['นัด', 'นัดสัมภาษณ์', 'สัมภาษณ์', 'interview'];
const DELETE_WORDS = ['ลบข้อมูลของฉัน', 'ลบข้อมูล'];

function userIdOf(event: webhook.Event): string | undefined {
  return event.source?.type === 'user' ? event.source.userId : undefined;
}

function inputOf(event: webhook.Event): Input | undefined {
  if (event.type === 'postback') {
    const data = decodePostback(event.postback.data);
    // Date/time pickers deliver the chosen value outside `data`.
    const dt = event.postback.params?.datetime;
    return { kind: 'postback', data: dt ? { ...data, dt } : data };
  }
  if (event.type === 'message') {
    if (event.message.type === 'text') return { kind: 'text', text: event.message.text.trim() };
    if (event.message.type === 'location') {
      return { kind: 'location', lat: event.message.latitude, lng: event.message.longitude };
    }
    return { kind: 'other' };
  }
  return undefined;
}

export function createEventsHandler(deps: HandlerDeps): EventsHandler {
  const { users, prefs, sessions, line, logger } = deps;
  const jobActions = createJobActions(deps);
  const interviewFlows = createInterviewFlows(deps);
  const followUps = createFollowUpFlows(deps);
  const tz = deps.timeZone ?? 'Asia/Bangkok';
  const clock = deps.now ?? (() => new Date());
  const tracking = createTracking({ ...deps, interviewLines: interviewFlows.linesForJob });
  const placeFlows = deps.places
    ? createPlaceFlows({
        places: deps.places,
        sessions,
        onPlacesChanged: deps.warmDistances,
      })
    : null;

  async function showFeed(user: User, page: number): Promise<OutgoingMessage[]> {
    const result = await jobActions.feed(user, page);
    if (result !== 'needs-prefs') return result;
    return [msg.needsPrefs(), ...(await applyWizard(user, startWizard()))];
  }

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

  async function showStats(user: User): Promise<OutgoingMessage[]> {
    const rows = await deps.userJobs.overview(user.id);
    return [statsMessage(computeStats(rows, clock(), tz))];
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
        case 'feed':
          return showFeed(user, 1);
        case 'saved':
        case 'applied':
          return jobActions.list(user, pb.m);
        case 'prefs':
          return showOrStartPrefs(user);
        case 'help':
          return [msg.helpMessage()];
        case 'interviews':
          return interviewFlows.list(user);
        case 'stats':
          return showStats(user);
        default:
          return [msg.comingSoon(pb.m ?? '')];
      }
    }
    if (pb?.a === 'prefs' && pb.v === 'edit') return applyWizard(user, startWizard());
    if (pb?.a === 'feed') {
      await sessions.clear(user.id);
      const page = Number.parseInt(pb.p ?? '1', 10);
      return showFeed(user, Number.isFinite(page) && page > 0 ? page : 1);
    }
    if (pb?.a === 'list' && (pb.s === 'saved' || pb.s === 'applied')) {
      await sessions.clear(user.id);
      const page = Number.parseInt(pb.p ?? '1', 10);
      return jobActions.list(
        user,
        pb.s,
        pb.v === 'card' ? 'card' : 'list',
        Number.isFinite(page) ? page : 1,
      );
    }
    if (pb?.a === 'job' && pb.v && pb.j) {
      await sessions.clear(user.id); // e.g. abandon a half-typed note
      switch (pb.v) {
        case 'detail':
          return tracking.detail(user, pb.j);
        case 'note':
          return tracking.startNote(user, pb.j);
        case 'stage':
          return tracking.stageMenu(user, pb.j);
        default:
          return jobActions.act(user, pb.v, pb.j);
      }
    }
    if (pb?.a === 'stage' && pb.v && pb.j) {
      await sessions.clear(user.id);
      return tracking.setStage(user, pb.j, pb.v);
    }
    if (pb?.a === 'fu' && pb.j) {
      await sessions.clear(user.id);
      if (pb.v === 'draft') return followUps.draft(user, pb.j);
      if (pb.v === 'snooze') return followUps.snooze(user, pb.j);
      return [msg.notUnderstood()];
    }
    if (pb?.a === 'title') {
      await sessions.clear(user.id);
      if (pb.v === 'edit' && pb.j) return tracking.askTitle(user, pb.j);
      return tracking.skipTitle(user);
    }
    if (input.kind === 'location') {
      // Doesn't touch any flow in progress (e.g. the prefs wizard): it just adds a place.
      if (!placeFlows) return [msg.notUnderstood()];
      return placeFlows.addFromLocation(user, input.lat, input.lng);
    }
    if (pb?.a === 'place' && placeFlows) {
      await sessions.clear(user.id);
      if (pb.v === 'name' && pb.i && pb.l) return placeFlows.rename(user, pb.i, pb.l);
      if (pb.v === 'ask' && pb.i) return placeFlows.askName(user, pb.i);
      if (pb.v === 'del' && pb.i) return placeFlows.remove(user, pb.i);
      return placeFlows.show(user);
    }
    if (pb?.a === 'iv') {
      await sessions.clear(user.id);
      if (pb.v === 'new' && pb.j) return interviewFlows.create(user, pb.j, pb.dt);
      if (pb.v === 'ask' && pb.j) return interviewFlows.ask(user, pb.j);
      if (pb.i) {
        switch (pb.v) {
          case 'move':
            return interviewFlows.move(user, pb.i, pb.dt);
          case 'place':
            return interviewFlows.askPlace(user, pb.i);
          case 'del':
            return interviewFlows.confirmRemove(user, pb.i);
          case 'delok':
            return interviewFlows.remove(user, pb.i);
        }
      }
      return [msg.notUnderstood()];
    }

    const session = await sessions.get(user.id);
    const flow = session ? asFlowState(session.state) : null;
    if (typed !== undefined && session?.flow === IV_TIME_FLOW) {
      const state = asTimeFlow(session.state);
      const reply = state ? await interviewFlows.typedTime(user, state, typed) : null;
      if (reply) return reply;
    }
    if (typed !== undefined && session?.flow === PLACE_NAME_FLOW && placeFlows) {
      const state = asPlaceNameFlow(session.state);
      if (state) return placeFlows.rename(user, state.placeId, typed);
    }
    if (typed !== undefined && session?.flow === IV_PLACE_FLOW) {
      const state = asPlaceFlow(session.state);
      if (state) return interviewFlows.savePlace(user, state, typed);
    }
    if (typed !== undefined && flow) {
      if (session?.flow === NOTE_FLOW) return tracking.saveNote(user, flow.jobId, typed);
      if (session?.flow === LINK_TITLE_FLOW && !extractUrl(typed)) {
        return tracking.nameJob(user, flow.jobId, typed);
      }
    }
    const links = typed !== undefined ? extractAllUrls(typed) : [];
    if (links.length === 1) return tracking.addLink(user, links[0]!);
    if (links.length > MAX_LINKS_PER_MESSAGE) return tracking.queueLinks(user, links);
    if (links.length > 1) return tracking.addLinks(user, links);

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
      if (FEED_WORDS.includes(lower)) return showFeed(user, 1);
      if (HELP_WORDS.includes(lower)) return [msg.helpMessage()];
      if (INTERVIEW_WORDS.includes(lower)) return interviewFlows.list(user);
      if (STATS_WORDS.includes(lower)) return showStats(user);
      if (PLACE_WORDS.includes(lower) && placeFlows) return placeFlows.show(user);
      if (REMINDER_OFF_WORDS.includes(lower)) return interviewFlows.setReminders(user, false);
      if (REMINDER_ON_WORDS.includes(lower)) return interviewFlows.setReminders(user, true);
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

    if (messages.length === 0) return;
    try {
      // A single reply holds at most 5 messages.
      await line.reply(replyToken, messages.slice(0, 5));
    } catch (err) {
      // LINE rejected the message itself (e.g. an invalid Flex property). The reply token
      // isn't used up by a rejected request, so tell the user rather than going silent.
      if (httpStatusOf(err) !== 400) throw err;
      logger.error('LINE rejected reply', {
        eventType: event.type,
        messageTypes: messages.map((m) => m.type),
        ...errorFields(err),
      });
      await line.reply(replyToken, [msg.replyFailed()]);
    }
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
