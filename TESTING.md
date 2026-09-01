# Testing

Run the complete local verification suite with:

```bash
npm run check
```

The project uses Node's built-in `node:test` runner.

- Pure contracts and normalizers live in `test/*.test.js`.
- Server routes must be tested with injected or mocked upstream requests.
- Every bug fix needs a regression test that reproduces the original failure.
- Browser QA covers search, URL restoration, CCTV, weather, mobile layouts, console errors, and API-key boundaries.
- Tests must never read `.env.local`, call live providers, or print credentials.
