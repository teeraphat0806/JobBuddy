# Domain

- **Job**: one posting. Synced jobs come from ATS boards and are identified by `(provider, board, externalId)`. A job missing from a later sync of a board that succeeded is marked inactive, never deleted. A board that failed to sync keeps its jobs.
- **Link job**: a job a user added by sending a URL (`provider = 'link'`, board = host, externalId = canonical URL). It is shared by every user who sends the same URL, and it never appears in the feed.
  - Renaming is allowed only while it still has the placeholder title (`งานจาก {host}`), or when no other user tracks it.
  - A link pointing at a synced ATS posting reuses that synced job instead.
- **User job**: the user's relation to a job. Status is `saved`, `applied` or `hidden`. Applied jobs also have a stage: applied → contacted → interview → waiting → offer / rejected.
  - Applying never gets downgraded by re-saving the job.
  - Sending a link that is already saved or applied counts as a duplicate: the bot reports it and doesn't save it again.
  - `stage_changed_at` records when the current stage began; the bot shows "N days" in it. It restarts only when the stage actually changes. Each stage offers its likely next steps as buttons (applied -> contacted -> book interview / interviewed -> waiting -> offer / rejected).
- **Places**: up to 5 per user (home, condo...), saved from a shared LINE location. They're used only for straight-line distances to jobs and never sent anywhere.
- **Geocodes** cache job-location text to coordinates, shared by all users. Province-level matches are stored as "not found", since they say nothing useful about a commute.
- **Notes** belong to a user and a job.
- **Interviews** have a start time and an optional place.
  - Reminders go out at 19:00 the evening before and 2 hours before.
  - Each reminder is claimed atomically in the database before it is pushed.
  - A reminder that was already due when the interview was booked is skipped.
  - Users can type `ปิดเตือน` / `เปิดเตือน` to turn reminders off or on.
- Times are stored in UTC and shown in `APP_TIMEZONE` (Asia/Bangkok). Thai date and time input is parsed by hand, not with a library.
