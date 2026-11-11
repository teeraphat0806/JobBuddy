# Database

- Stack: Postgres (Railway) with Drizzle ORM and postgres.js. Generate migrations with `npm run db:generate`, and commit the SQL and the journal together.
- Migrations run in Railway's pre-deploy step and again at server startup. If required tables are still missing afterwards, the server refuses to start, so an empty database fails loudly.
- Drizzle's journal (`drizzle.__drizzle_migrations`) stores a hash of each migration file. Don't edit a migration that has already shipped: add a new one.
- `npm run db:init-sql` regenerates a single SQL script (every migration plus the journal rows). It's for users who need to set up a database by hand.
- postgres.js raw `sql` templates don't take `Date` values: pass `.toISOString()`.
