import type { JobSource } from './types.js';

/**
 * Company job boards with Thailand postings, found by probing public ATS APIs (Nov 2026).
 * Add a company: confirm its board returns Thai jobs, then append here.
 */
export const JOB_SOURCES: JobSource[] = [
  // Greenhouse
  { provider: 'greenhouse', board: 'agoda', company: 'Agoda' },
  { provider: 'greenhouse', board: 'xendit', company: 'Xendit' },
  { provider: 'greenhouse', board: 'binance', company: 'Binance' },
  { provider: 'greenhouse', board: 'airbnb', company: 'Airbnb' },
  { provider: 'greenhouse', board: 'okx', company: 'OKX' },
  { provider: 'greenhouse', board: 'stripe', company: 'Stripe' },
  // Lever
  { provider: 'lever', board: 'lalamove', company: 'Lalamove' },
  { provider: 'lever', board: 'ninjavan', company: 'Ninja Van' },
  // SmartRecruiters
  { provider: 'smartrecruiters', board: 'BoschGroup', company: 'Bosch' },
  { provider: 'smartrecruiters', board: 'Continental', company: 'Continental' },
  { provider: 'smartrecruiters', board: 'Grab', company: 'Grab' },
  { provider: 'smartrecruiters', board: 'Expeditors', company: 'Expeditors' },
  { provider: 'smartrecruiters', board: 'Accor', company: 'Accor' },
  { provider: 'smartrecruiters', board: 'Abbvie', company: 'AbbVie' },
  { provider: 'smartrecruiters', board: 'MinorInternational', company: 'Minor International' },
];
