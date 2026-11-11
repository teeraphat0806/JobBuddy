# JobBuddy

A public LINE Official Account bot that helps Thai job seekers find jobs, save links from any job site, and track applications, notes and interviews.

The user talks in Thai; reply in Thai. Bot-facing copy is Thai, code and comments are English.

## Commands

- Check before committing: `npm run typecheck && npm run lint && npm test` (and `npm run format` for Prettier)
- After a schema change: `npm run db:generate`, then `npm run db:init-sql` to refresh the manual init script

## Ground rules

- Only use sources that allow it: public ATS APIs, or a single metadata read of a page the user sent us. No scraping of sites whose terms forbid it, and no proxies/Tor or other ways around blocks.
- Secrets (LINE tokens, database URLs) are set by the user in Railway, never pasted in chat. Destructive database commands are run by the user after confirmation.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## More context, when the task needs it

- [docs/agents/domain.md](docs/agents/domain.md) — jobs, link jobs, statuses and stages, interviews and reminders
- [docs/agents/line.md](docs/agents/line.md) — LINE API limits and how postbacks and conversation flows work
- [docs/agents/data-sources.md](docs/agents/data-sources.md) — which job sources are allowed and how links are read
- [docs/agents/database.md](docs/agents/database.md) — Drizzle migrations and deploy behaviour
- [docs/agents/testing.md](docs/agents/testing.md) — the fake bot, real-database checks and scratch scripts
