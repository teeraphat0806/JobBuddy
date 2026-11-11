# LINE

- Prefer replies, which are free. Push messages count against the OA's monthly quota, so we only push interview reminders.
- Limits we hit in practice:
  - quick-reply labels: 20 characters
  - URI actions: 1000 characters (which is why link URLs are capped)
  - text: 5000 characters
  - carousels: 12 bubbles
  - one reply: 5 messages
- Postback data is a small encoded key/value object, with `a` as the action. Build it with the postback helpers instead of writing strings by hand, and keep it short.
  - Datetime pickers return their value in `params.datetime`. The handler exposes it to the action as `dt`.
- Multi-step conversations (wizard, notes, renaming, interview time and place) are stored as a session with a flow name and a TTL. Menu taps and job/list actions clear the session, so a half-finished flow is abandoned; wizard buttons continue it. `ยกเลิก` cancels.
- Saved and applied lists default to a compact paged list bubble, with a carousel view as an alternative.
- Never put user data into URLs. Link previews and shared cards only carry the job's own link and the add-friend URL.
