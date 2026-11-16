# Verification — 11 November 2026

Environment: Windows, Node.js 24.14.0, Microsoft Edge in headless mode. Fixture data and the mock CRM contain only synthetic examples.

## Automated behavior tests

`npm test`: 9 tests passed. These exercise the actual local HTTP service and temporary SQLite databases, including restart persistence, explicit approval, failed delivery/retry, concurrent duplicate prevention, invalid input, local request protections, provider rejection/timeout, and unavailable evaluation data.

Independent review found that the original 20 KB request cap rejected valid long Chinese replies. A regression failed before the fix. The 64 KiB cap now accepts an approved 8,000-character Chinese reply and its escaped-Unicode JSON equivalent, preserves the exact text, and still rejects 8,001 characters and oversized bodies.

## Fixed corpus

`npm run evaluate`: 36 of 36 expected status/source-ID pairs matched in the final run. The public synthetic development set contains 18 answerable, four missing-context, eight unsupported, and six instruction-attack cases. It runs the same analyzer as the application, with no model or cached output involved.

The initial run passed 34 cases. A punctuation-normalization fix addressed the two Traditional Chinese clarification failures without changing expected outcomes. Rules were adjusted after inspecting this corpus; it is not a held-out benchmark. It does not measure response completeness, translation quality, unseen attack resistance, or live-model accuracy.

## Browser workflows

Real browser automation exercised: draft creation, required review, approval reset after edits, simulated failure and retry, source navigation, bilingual knowledge search, Traditional Chinese replies, unsupported/blocked states, evaluation filters, history after reload, and keyboard focus. No page JavaScript exceptions were observed. There was no horizontal overflow at 360, 768, and 1440 pixels. A subsequent visual pass improved mobile selectors and supporting-text readability.

Screenshots are captures of the running application: [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png), [evaluation](screenshots/evaluation.png).

These are workflow and layout checks, not a complete accessibility audit or a performance benchmark.

## Real provider smoke check

Two actual local requests to Ollama using `qwen3.5:9b` succeeded: one through the HTTP verification script and one through the browser. Both persisted an `answered` result with `providerUsed: true` and the `invitations` source. The interface displayed the live-AI label and still required review before handoff. The direct response described the documented invitation procedure and 72-hour expiration. These checks establish that the provider path ran; two repetitions of an English question do not establish model accuracy or Chinese generation quality. No paid API was called.

## Limits still present

- Phrase matching is not semantic retrieval, and citations alone do not establish entailment.
- The CRM is local and simulated; public hosting and real integration are separate work.
- Unsaved edits are only in the current editor until a handoff succeeds; the UI and README explain this.
- No deployed-customer outcomes, traffic statistics, latency benchmark, or business-impact claims were measured.
