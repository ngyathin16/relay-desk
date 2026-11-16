# Changelog

## 16 November 2026 — Standalone repository release

- Made [ngyathin16/relay-desk](https://github.com/ngyathin16/relay-desk) public at Harold's request; source and documentation are accessible without signing in.
- Prepared startup instructions for standalone GitHub publication: run `npm start` from the Relay Desk directory containing `package.json`.
- Re-ran `node --test`: all 9 behavior tests passed.
- Re-ran `node scripts/evaluate.mjs`: all 36 expected status/source-ID checks passed. These synthetic development checks do not measure live-model or production accuracy.

The browser, screenshot, and optional live-model evidence in the [verification record](VERIFICATION.md) remains dated 11 November 2026. The standalone source also passed the 9 behavior tests and 36 evaluation cases after export into a clean directory. The repository includes source, screenshots, provenance, and reproducible checks; it does not deploy the application as a public service.
