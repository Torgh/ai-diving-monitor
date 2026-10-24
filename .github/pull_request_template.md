## Summary

<!-- What changes for the diver, and why. Which roadmap stage it belongs to. -->

## Checklist

- [ ] `bun run check` passes locally (typecheck, lint, tests with coverage, build), and `pytest` while the Python version is still in the repo
- [ ] New behaviour has tests; bug fixes have a test that failed before the fix
- [ ] Parsing or analysis changes: `python scripts/export_golden.py` re-run and the TypeScript port still matches the golden fixtures
- [ ] Storage changes: tested against a temporary data folder, never the real dive log
- [ ] README updated
- [ ] UI changes: checked in the browser (screenshot attached if it looks different)
