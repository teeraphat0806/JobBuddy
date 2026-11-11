# Data sources

- **Synced feed**: public ATS APIs only (Greenhouse, Lever, SmartRecruiters, Workable widget).
  - We keep Thailand jobs only and store a summary that links back to the posting.
  - To add a company, first confirm that its board has Thai jobs.
  - Workable sits behind Cloudflare rate limits (429/1015), so don't hammer it while testing.
- **Job boards we do not crawl or sync**, because their terms forbid scraping or bulk use: JobsDB, JobThai, JobBKK, JobTopGun, LinkedIn, Indeed, Jooble, Careerjet. The README lists the reasons.
- **Links users send** are read once, at the user's request, at link-preview level:
  - Known ATS links go through their API.
  - Other links: one SSRF-safe page fetch that reads only meta tags, schema.org JSON-LD `JobPosting`, and a few per-site rules (JobThai description and title, JobsDB title and advertiser markup, JobBKK JSON-LD).
  - A board's homepage slogan is not a job title. When nothing useful is found, use the placeholder title and ask the user for one.
- The SSRF guard checks the address on the real socket lookup: no private or reserved IPs, only ports 80/443, and every redirect is re-checked. Keep every page fetch going through it.
