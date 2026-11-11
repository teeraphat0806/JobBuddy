import type { JobSource } from './types.js';

/**
 * Company job boards with Thailand postings, found by probing public ATS APIs (Nov 2026;
 * the second group in each provider was added on 2026-11-11).
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
  { provider: 'greenhouse', board: 'sertis', company: 'Sertis' },
  { provider: 'greenhouse', board: 'thoughtworks', company: 'Thoughtworks' },
  { provider: 'greenhouse', board: 'acommerce', company: 'aCommerce' },
  { provider: 'greenhouse', board: 'cloudbeds', company: 'Cloudbeds' },
  { provider: 'greenhouse', board: 'flexport', company: 'Flexport' },
  { provider: 'greenhouse', board: 'koddi', company: 'Koddi' },
  { provider: 'greenhouse', board: 'sohohouseco', company: 'Soho House' },
  // Lever
  { provider: 'lever', board: 'lalamove', company: 'Lalamove' },
  { provider: 'lever', board: 'ninjavan', company: 'Ninja Van' },
  { provider: 'lever', board: 'Coda', company: 'Coda' }, // the slug is case-sensitive
  { provider: 'lever', board: 'omnisend', company: 'Omnisend' },
  // SmartRecruiters
  { provider: 'smartrecruiters', board: 'BoschGroup', company: 'Bosch' },
  { provider: 'smartrecruiters', board: 'Continental', company: 'Continental' },
  { provider: 'smartrecruiters', board: 'Grab', company: 'Grab' },
  { provider: 'smartrecruiters', board: 'Expeditors', company: 'Expeditors' },
  { provider: 'smartrecruiters', board: 'Accor', company: 'Accor' },
  { provider: 'smartrecruiters', board: 'Abbvie', company: 'AbbVie' },
  { provider: 'smartrecruiters', board: 'MinorInternational', company: 'Minor International' },
  { provider: 'smartrecruiters', board: 'westerndigital', company: 'Western Digital' },
  { provider: 'smartrecruiters', board: 'deliveryhero', company: 'Delivery Hero' },
  { provider: 'smartrecruiters', board: 'wise', company: 'Wise' },
  { provider: 'smartrecruiters', board: 'seek', company: 'SEEK' },
  { provider: 'smartrecruiters', board: 'NielsenIQ', company: 'NielsenIQ' },
  { provider: 'smartrecruiters', board: 'AveryDennison', company: 'Avery Dennison' },
  // Workable (rate-limited by Cloudflare: one request per board per sync is fine)
  { provider: 'workable', board: '2c2p', company: '2C2P' },
  { provider: 'workable', board: 'fundingsocieties', company: 'Funding Societies' },
  { provider: 'workable', board: 'datawow', company: 'Data Wow' },
];
