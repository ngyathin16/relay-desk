# Relay Desk

Relay Desk is a local support workbench for **Harbour**, a fictional contact-management product. Paste an English or Traditional Chinese ticket, inspect its source articles, edit the draft, and explicitly approve a mock CRM handoff. The knowledge browser and evaluation view make the evidence and the system's limits visible.

The default mode is a deterministic extractive baseline with curated bilingual phrase matching and conservative exclusions for unsupported questions. It selects source passages and requires no model, credentials, package downloads, or paid API calls. Optional live mode uses a real configured model to draft from the retrieved evidence. The UI identifies which mode produced a result and whether a model was actually called.

See the [running-app screenshots and verification record](docs/VERIFICATION.md) and [change history](docs/CHANGELOG.md).

## Run locally

Install Node.js **24 or newer**, then open a terminal in the Relay Desk directory containing `package.json`:

```sh
node --version
npm start
```

If PowerShell blocks the `npm.ps1` launcher, use `npm.cmd start` instead. No `npm install` is required: the app uses Node's standard library and has no runtime dependencies. Node's built-in SQLite module may print an experimental-feature warning on some Node 24 releases.

Open **http://127.0.0.1:3210**. Stop the server with `Ctrl+C`. To change the port or data location, copy `.env.example` to `.env`, edit the values, and restart. For example, in PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
npm start
```

Use `.env.example` as a starting point only; keep your own `.env` out of version control. The server creates its local SQLite database under `data` by default. Tickets, drafts, reviewed replies, and delivery attempts persist across restarts. Use invented tickets while exploring the demo.

## Try the workflow

1. Choose an example ticket or write your own. Select English or Traditional Chinese for the response.
2. Generate a draft. Compare the suggested reply with the cited source excerpts. An unfamiliar topic should produce no answer; missing context should produce a clarification request.
3. Edit the reply, explicitly approve it, and deliver it to the mock CRM. Nothing is sent to a real customer or CRM.
4. Use the simulated delivery-failure control to see a failed attempt, then retry. A successful handoff is stored locally and is idempotent per draft; submitting different text after success is rejected.
5. Open Knowledge to inspect all eight bilingual articles. Open Evaluation to run the fixed extractive checks and inspect failures as well as passes.

The approval control is a workflow guard. A person still needs to decide whether the proposed answer is useful, accurate, and appropriate. Blocked and unsupported drafts cannot be delivered. A clarification draft can be reviewed and delivered.

Generated drafts persist immediately. Reply edits are saved when delivery succeeds; they remain in the current editor after a failed attempt, but reopening a draft or refreshing restores the generated text until delivery. Successful handoffs reopen with the delivered reply.

## Optional live model

Live mode is available only when the server has a model configuration. Both local Ollama and a hosted service use an OpenAI-compatible chat-completions endpoint with structured JSON output. Your selected server and model must support that format. Configure a model you have actually installed or have access to; configuring a name does not download it.

For an existing local Ollama installation, add these values to `.env` and replace the model name with one shown by `ollama list`:

```dotenv
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_NAME=your-installed-model
PROVIDER_TIMEOUT_MS=120000
```

For a hosted compatible service:

```dotenv
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=your-structured-output-model
MODEL_API_KEY=your-key
PROVIDER_TIMEOUT_MS=20000
```

`OPENAI_MODEL` and `OPENAI_API_KEY` are accepted aliases. Restart the server after changing configuration. Keep credentials on the server; they do not belong in browser code or ticket text. Hosted live mode sends ticket text and retrieved evidence to your selected provider and may incur charges. The default extractive mode stays local. No live request is made when the local retrieval step finds no eligible evidence or blocks the ticket.

Provider timeouts and invalid output are surfaced as errors. The live adapter validates the result shape and cited article IDs. That validation cannot prove every generated sentence is supported. Source review remains necessary.

## Checks and evaluation

From this project directory:

```powershell
npm test
npm run evaluate
```

Use `npm.cmd` in place of `npm` if needed. Tests use Node's built-in test runner. The evaluation script and `GET /api/evaluation` share the same evaluator and run the actual baseline against `content/evaluation.json`.

The fixed set has **36 synthetic cases**: 18 answerable, four missing-context, eight unsupported, and six instruction attacks. Cases include English, Traditional Chinese, paraphrases, and unsupported questions that still mention a known topic. Every case compares both the outcome and exact cited article IDs. The CLI prints each result, prints expected and actual values for failures, and exits with a nonzero status if any case fails or the evaluation cannot run. The displayed total is computed, not a hard-coded score.

This is a public development regression set, not an independent held-out benchmark. Retrieval rules were adjusted after inspecting the cases. It does not score response completeness, translation quality, live-model grounding, or protection against unseen attacks. A high score describes only these checks against this version of the corpus. See [fixture provenance](content/PROVENANCE.md) for how the data was authored and the initial failure that was fixed without changing expectations.

## Architecture

```text
Browser interface
  -> Local Node HTTP API
      -> Phrase retrieval -> source excerpts -> reviewable draft
      -> Optional live model -> validated draft with source IDs
      -> SQLite drafts, reviewed handoffs, and delivery attempts

Fixed evaluation tickets -> same extractive analyzer -> per-case results
```

| Location | Responsibility |
| --- | --- |
| `public/` | Plain HTML, CSS, and browser JavaScript; ticket, knowledge, and evaluation views |
| `server.mjs` | Local HTTP routes, static files, request validation |
| `lib/` | Retrieval, optional provider calls, shared evaluation, SQLite persistence |
| `content/knowledge.json` | Eight fictional bilingual product articles and retrieval phrases |
| `content/examples.json` | Clickable demonstration tickets |
| `content/evaluation.json` | Fixed independently expected outcomes |
| `scripts/evaluate.mjs` | CLI report and failure exit status |
| `test/` | Automated behavior checks |

Draft outcomes are `answered`, `needs-information`, `no-answer`, and `blocked`. An `answered` label means the baseline found eligible evidence; it is not a confidence score or a guarantee of a complete answer. The baseline has no learned semantic model and can miss paraphrases or misread intent. Its instruction-attack detection is a limited demonstration, not a complete security boundary.

## Local use and deployment limits

The server binds to the loopback interface. This is a single-user local demonstration with no sign-in, tenant isolation, production authorization, or real CRM integration. Do not expose it through a public tunnel or deploy it unchanged as a multi-user service. A public static portfolio can link to this repository, screenshots, and a recorded walkthrough; it cannot run this Node/SQLite app by copying `public/` alone.

The local database stores ticket content without application-level encryption or an automatic retention policy. A real deployment would need authentication, access controls, a retention and deletion policy, an audited outbound integration, and operational monitoring. A reviewed handoff in this demo records a local outcome only.

## Authorship and scope

This implementation, its documentation, and its fictional fixtures were developed with AI assistance. Harbour's product rules and menu paths are self-authored for the demo. No real customer support data or copied vendor knowledge base is included. This project demonstrates a review workflow, evidence handling, honest abstention, bilingual content, persistence, and inspectable evaluation; it does not claim customer deployments, business savings, production accuracy, or a trained custom model.

## Maintenance

Develop this application in its own repository. Run `npm test` and `npm run evaluate` before committing behavior changes; add browser checks for changed user journeys. Update this README, the verification record, and the changelog when their claims change, then push the verified commits to GitHub. Keep `.env`, local databases, credentials, and real ticket data out of commits. The portfolio’s source download and case study must follow the published application revision.
