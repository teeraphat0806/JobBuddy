# Testing

- Tests run on Vitest. Most behaviour tests use the in-memory fake bot (`createFakeBot`):
  - `say` sends a text message, `tap` sends a postback and `pick` answers a datetime picker. Each returns the reply as text, with `[flex]` standing in for Flex messages.
  - `addJob` seeds a job, and `linkPreview.next` sets what the next link preview returns.
  - You can inspect the in-memory rows directly.
- When you add a repository method, implement it in the fake too, and in any `satisfies JobRepository` mocks.
- For real SQL checks, use PGlite: `npx pglite-server -p <port> -m 4`. With fewer connections it can hang.
- Write one-off scripts as `.mts` files in the scratchpad, run them with `npx tsx`, and import project files as `file:///D:/JobBuddy/...`.
- On Windows, write text containing Thai with the file tools rather than shell heredocs, because heredocs can mangle it.
