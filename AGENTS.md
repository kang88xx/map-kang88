# Project Guidance

## Testing

- Unit and contract tests: `npm test`
- Full local verification: `npm run check`
- Tests live in `test/` and use Node's built-in `node:test` runner.
- Add a regression test for every behavior fix and error path.
- Never read `.env.local` from tests or print credentials in logs.
