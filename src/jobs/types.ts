export type Provider = 'greenhouse' | 'lever' | 'smartrecruiters' | 'workable' | 'breezy';
export type Workplace = 'onsite' | 'hybrid' | 'remote';

/** A job board we pull from: one company on one ATS provider. */
export interface JobSource {
  provider: Provider;
  /** Board token / company identifier on that provider. */
  board: string;
  /** Display name, used when the API doesn't return one. */
  company: string;
}

/** A posting normalised from any provider. */
export interface JobListing {
  provider: Provider;
  board: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  department: string | null;
  workplace: Workplace | null;
  url: string;
  postedAt: Date | null;
}
