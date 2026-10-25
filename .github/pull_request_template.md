## Summary

<!-- What changes for the diver, and why. Which roadmap stage it belongs to. -->

## Checklist

- [ ] `bun run check` passes locally (typecheck, lint, tests with coverage, build)
- [ ] New behaviour has tests; bug fixes have a test that failed before the fix
- [ ] Parsing or analysis changes: `PARSER_VERSION` bumped so stored dives are parsed again; golden fixtures rewritten (`bun run golden`) only for a change meant to alter the numbers, with the diff checked
- [ ] Storage changes: tested against a temporary data folder, never the real dive log
- [ ] README updated
- [ ] UI changes: checked in the browser (screenshot attached if it looks different)
