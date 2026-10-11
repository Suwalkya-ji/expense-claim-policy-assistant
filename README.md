# Expense Claim Policy Review Assistant

An internal MERN app (MongoDB, Express, React, Node) that reviews employee expense claims against an organisational expense policy.

- **Code decides facts.** Required fields, dates, currency, receipts, category limits, duplicates and totals are all checked by rule-based code.
- **AI advises.** Google Gemini classifies ambiguous descriptions, explains how the policy applies, cites the policy text it relies on, and asks for missing information.
- **A human decides.** A reviewer approves, rejects, requests clarification or overrides the category, and every step is recorded.

**Hosted demo:** _add your Render URL here_. Login details for reviewers go in the submission remarks (see [Deployment](#deployment)).

## Documentation

- [Project proposal](docs/01-project-proposal.md): problem, solution, goals, scope, risks
- [Product requirements (PRD)](docs/02-prd.md): user stories, functional and non-functional requirements, acceptance criteria
- [Tech stack](docs/03-tech-stack.md): technologies, reasons for each choice, structure, alternatives considered
- [Agent usage](AGENT_USAGE.md): how AI tools were used to build the project

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [How a claim is reviewed](#how-a-claim-is-reviewed)
- [Reviewer actions](#reviewer-actions)
- [UI states](#ui-states)
- [Logs](#logs)
- [Tests](#tests)
- [Deployment](#deployment)
- [Scope: completed and excluded](#scope-completed-and-excluded)
- [Limitations](#limitations)
- [API](#api)
- [Design decisions](#design-decisions)

## Quick start

Requirements: Node 22+ and MongoDB 6+ (or Docker). These commands work in bash and in Windows PowerShell.

```bash
docker compose up -d mongo          # or point MONGODB_URI at your own MongoDB
npm run install:all
cp server/.env.example server/.env  # then set GEMINI_API_KEY in server/.env (optional)
npm run seed                        # loads 12 sample claims covering the edge cases

# development: API on :5000, React on :5173 (Vite proxies /api)
npm run dev:server
npm run dev:client
```

Production-style, with one process serving the API and the built UI on :5000:

```bash
npm run build
npm start
```

When the server starts, it logs whether AI review is on. If it's off, the log says why: no key, a misnamed variable, `.env` saved as `.env.txt`, an unavailable model, and so on.

## Configuration

All settings are environment variables. Locally they go in `server/.env`, which is git-ignored; `server/.env.example` lists every name with no real values. On a host, set them in its dashboard.

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/expense_review` | MongoDB connection string |
| `PORT` | `5000` | HTTP port |
| `GEMINI_API_KEY` | — | Enables AI review ([get a key](https://aistudio.google.com/apikey)). Without it, the app uses the heuristic fallback |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model |
| `GEMINI_RPM` | unset | Requests per minute your plan allows (free tier: 5). Calls are spaced to match |
| `APP_USERNAME` / `APP_PASSWORD` | unset | Optional shared login (HTTP Basic) for a hosted demo. `/api/health` stays open |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |
| `LOG_FORMAT` | JSON | `pretty` gives one readable line per event, for local use |
| `AI_DISABLED` | — | `true` forces the heuristic path |

## Architecture

```
client/  React 19 + Vite. Single page: review queue, claim detail, submit/import, totals, policy
  src/api.js              fetch wrapper (adds X-Reviewer)
  src/components/*.jsx    ClaimList, ClaimDetail, SubmitClaims, Totals, PolicyView
  src/csv.js, fieldHints.js   pure helpers (tested from the server test suite)

server/  Express 5 + Mongoose 9 (ESM)
  src/index.js            startup: env, DB connection, AI model check
  src/app.js              middleware (request logging, optional login), static client, errors
  src/routes/claims.js    REST API, input normalisation, status transitions, audit history
  src/models/Claim.js     claim + latest review + all review runs + clarifications + history
  src/services/
    validation.js         rule-based checks, USD conversion, totals (pure functions)
    policy.js             loads policy, splits it into sections, TF-IDF retrieval
    classifier.js         Gemini classification; keyword fallback
    review.js             the review pipeline (below)
    llm.js                Gemini structured-output calls, retries, pacing, error messages
  src/logger.js           JSON-lines logger
  policy/expense-policy.md    the policy, with stable section IDs (MEAL-1, REC-1, …)
  policy/policy-config.json   limits, FX rates, receipt threshold, category keywords
```

**Persistence.** Everything lives in one MongoDB collection, `claims`. Each document holds:
- the submitted fields
- the status
- the latest `review` and all past `reviews[]`, each with its own record of AI calls
- `clarifications[]`
- `categoryOverride`
- an append-only `history[]` audit trail

## How a claim is reviewed

```
submit ─► classify ─► pick category ─► rule checks ─► retrieve policy ─► assess ─► verify citations ─► combine
          (Gemini)    override >       (code, final   (sections by       (Gemini)  (quote must exist    (checks can only
                      claimant >        on facts)      category, check,             in retrieved text)    make it stricter)
                      classifier                       and text match)
```

1. **Classify.** Gemini maps the description to a policy category, `non_reimbursable` or `unknown`, with a confidence score and alternatives.
   - Below 0.75 confidence, the result is marked **Uncertain**.
   - If it disagrees with the claimant's category (confidence ≥ 0.5), the claim gets a `CATEGORY_MISMATCH` warning.
2. **Rule checks.** `validation.js` checks:
   - required fields
   - strict date format, future dates (one day of timezone tolerance), and the 90-day window
   - positive numeric amount and supported currency
   - receipt required from USD 25
   - per-category limits and the daily meal limit
   - exact and near duplicates
   - non-reimbursable classification
   - **policy exclusions**: phrases the policy rules out (commuting, minibar, seat upgrades, gift cards, fines…). These are listed per category in `policy-config.json`, each with the exact policy sentence, which a test checks against the policy text
3. **Retrieve.** The sections fetched from `expense-policy.md` are:
   - the section for each candidate category
   - the section governing each failed check
   - the top TF-IDF matches on the description
   - the non-reimbursable list, always
4. **Assess.** Gemini sees only those sections and the check results, and returns:
   - `comply`, `needs_clarification` or `needs_review`
   - findings, each citing a section ID with a verbatim quote
   - questions for the claimant
5. **Verify citations.** A quote counts as verified only if its section was retrieved and the quote appears in that text. Unverified evidence is labelled in the UI.
6. **Combine.** Check results can only make the recommendation stricter:
   - A missing receipt or field gives at least "needs clarification".
   - A duplicate, over-limit claim, policy exclusion, non-reimbursable classification or uncertain category gives "needs review".

**Prompt-injection guard.** Both prompts tell the model that claim text is untrusted data. Gemini must return JSON matching a schema.

**When Gemini fails.** Failures include errors, quota, overload, blocks, truncation and bad JSON.
- Rate limits (429) and overloads (503) are retried up to 4 times, waiting as long as Gemini asks.
- If the call still fails, that review falls back to the keyword classifier and rule-based explanations, labelled "Heuristic" with the reason shown.
- If classification already failed, the assessment call is skipped, so quota isn't wasted.

## Reviewer actions

| Action | Rules |
|---|---|
| Approve | A note is required if any check failed (e.g. a lost receipt approved at the reviewer's discretion) |
| Reject | A reason is required |
| Request clarification | Sends a message and/or editable questions, prefilled from the review. Only one open request at a time |
| Claimant response | Simulated in the UI. Can correct fields, and triggers a new review |
| Override category | A category and a reason are required. Checks re-run under the new category |
| Re-run review | One claim, or all open claims missing a full AI review (Shift+click: all open claims) |
| History | Timeline of submissions, review runs, decisions, overrides and clarifications, plus the full output of every review run |

Approved and rejected are final: no further decisions or re-reviews. The AI never changes a claim's status; only reviewer actions do.

## UI states

| State | Where |
|---|---|
| Loading | Claims list, claim detail, and progress labels on every action ("Approving…", "Re-running…") |
| Empty | No claims yet, empty status filter, no totals |
| Validation | Inline field hints on the form (they don't block, because the review flags problems). Reasons shown when an action button is disabled. Server 400/409/422 messages |
| Success | Toast after submit, decision, override, clarification response and re-review |
| Failure | "Cannot reach the server" banner with Retry, per-claim load errors, submit/import errors. AI failures are shown on the review itself |

## Logs

The server writes one JSON object per line to stdout/stderr, readable in Render's log view or `docker logs`. `LOG_FORMAT=pretty` gives readable lines instead. Each event has `ts`, `level` and `event`, plus these fields:

| Event | Fields |
|---|---|
| `http.request` | `requestId`, method, path, status, `durationMs` (also sent as the `x-request-id` header) |
| `ai.call` | `claimId`, `purpose` (`classify`/`assess`), model, `ok`, `attempts`, `durationMs`, `tokens`, `error` |
| `ai.retry` | purpose, attempt, status, `waitMs` |
| `review.completed` | engine, category and source, confidence, uncertain, AI vs final recommendation, check codes, unverified citations |
| `claim.decision` | reviewer, action, AI recommendation, failed checks (the human-vs-AI audit signal) |
| `claim.override`, `claim.clarification_response`, `claims.submitted` | — |
| Startup | `server.config`, `db.connected`, `ai.enabled` / `ai.disabled` (with reason), `ai.model_check_*` |

The AI calls for each review are also saved on the claim and shown in its banner, e.g. `classify ✓ 1.2s · assess ✗ 3 attempts`.

## Tests

```bash
npm test     # 46 tests, Node's built-in runner; API tests need MongoDB and skip without it
```

| File | Covers |
|---|---|
| `validation.test.js` | Required fields, dates (incl. timezone tolerance), odd amount types, receipts, FX limits, duplicates, same-batch daily meal limit, totals |
| `policy.test.js` | Every category points at a real section; retrieval |
| `review.test.js` | Classification with Gemini stubbed, citation verification (a made-up quote is rejected), recommendations only get stricter, category precedence, fallbacks, non-reimbursable override, AI-call records |
| `llm.test.js` | Gemini request shape (JSON schema), error mapping, retry honouring "retry in Ns", fast failure on long waits |
| `api.test.js` | Submit → review → duplicates → decisions → history; clarification round trip; override; bad input returns 400 not 500; final-state rules; bulk re-review; login; health |
| `logger.test.js`, `client-utils.test.js` | JSON log format; CSV parsing; form hints |

Gemini is never called in tests. It's replaced either with a stand-in function or with fake HTTP responses at the `fetch` layer.

## Deployment

The app is one Node web service plus MongoDB. Free options: **Render** for the app and **MongoDB Atlas** for the database.

1. **Database (MongoDB Atlas):**
   - Create a free M0 cluster and a database user.
   - Under Network Access, allow `0.0.0.0/0` (Render free instances have no fixed IP).
   - Copy the connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/expense_review`.
2. **App (Render):**
   - Go to New → Blueprint, pick this repo, and Render reads `render.yaml`.
   - When prompted, enter `MONGODB_URI`, `GEMINI_API_KEY`, `APP_USERNAME` and `APP_PASSWORD`.
   - The build runs `npm run ci:all && npm run build`, then `npm start`; the health check is `/api/health`.
3. **Sample data:** open the app → Submit claims → **Load sample claims**.
4. **Reviewer login:** put `APP_USERNAME` / `APP_PASSWORD` in the submission remarks. Use demo-only values, never a real password.

**Docker alternative:** `docker build -t expense-review .` then `docker run -p 5000:5000 -e MONGODB_URI=… -e GEMINI_API_KEY=… expense-review`.

**Free-tier caveats:**
- **Render sleeps** after about 15 minutes idle, so the first request after that takes about a minute.
- **Gemini's free tier** allows about 5 requests per minute, and each review makes 2 calls. Bulk re-reviews are slow. When the daily quota runs out, reviews fall back to heuristics, and the banner says so ("quota used up … daily request limit"). The rule checks, including policy exclusions, still run.

## Scope: completed and excluded

**Completed:**
- **Claim entry:** form, CSV (incl. Excel `;`) and JSON bulk import, API.
- **AI workflow:** classify ambiguous descriptions, retrieve relevant policy sections, explain comply / clarify / review, ask for missing information, cite policy evidence (verified), mark uncertain classifications.
- **Rule checks:** duplicates, totals, missing receipts, configured category limits, dates and required fields.
- **Reviewer actions:** approve, reject, request clarification, override classification with a reason, complete review and decision history.
- **Operations:** persistence, structured logs, loading/empty/validation/success/failure states, tests, hosted deployment config, optional login.

**Excluded:**
- **Per the brief:** reimbursement, payroll integration, tax advice, receipt OCR and payment processing.
- **Not built (intentionally):**
  - User accounts and roles. There is one shared login; the reviewer name is free text.
  - Real claimant notifications. The claimant's reply is simulated in the reviewer UI.
  - Receipt file upload: only yes/no, as in the claim format.
  - Policy editing in the UI: the policy and limits are files in the repo.
  - Live FX rates: rates are fixed in config.

## Limitations

- **AI quality depends on the model and quota.** Classifications and explanations can be wrong. Low-confidence results are flagged, citations are checked against the policy text, and a human decides every claim.
- **Retrieval is lexical (TF-IDF), not semantic.** This fits a short policy; a large policy would need embeddings.
- **Re-reviews don't cascade.** Duplicate and daily-limit results are computed when a claim is reviewed. Rejecting one claim doesn't automatically clear a duplicate flag on its twin; "Re-run review" refreshes it.
- **Bulk re-review is synchronous.** On the Gemini free tier it can take minutes, with no background job queue.
- **"Today" is UTC.** Future-date checks allow one day of tolerance.
- **No authentication beyond the optional shared login,** and no rate limiting of the API itself.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok, db }`, 503 until MongoDB is connected |
| GET | `/api/meta` | Policy sections, categories, limits, AI status and why it's off |
| GET | `/api/claims?status=` | Queue |
| GET | `/api/claims/:id` | Full claim with reviews and history |
| POST | `/api/claims` | One claim, an array, or `{ claims: [...] }` (≤ 200) |
| POST | `/api/claims/:id/review` | Re-run one review (409 if final) |
| POST | `/api/claims/review-open[?all=true]` | Re-run open reviews |
| POST | `/api/claims/:id/decision` | `{ action: approve\|reject\|request_clarification, note, questions? }` |
| POST | `/api/claims/:id/override` | `{ category, reason }` |
| POST | `/api/claims/:id/clarification-response` | `{ response, updates? }` |
| GET | `/api/summary` | Totals by claimant, category and status (USD) |
| GET | `/api/samples` | Sample claims dated relative to today |

The reviewer name comes from the `X-Reviewer` header (the UI's "Reviewer" box).

## Design decisions

- **AI advises, code decides facts, a human decides outcomes.** The model never sets a status, and its recommendation can only be made stricter by the checks.
- **Policy as data.** The policy is Markdown with stable section IDs plus a JSON config of limits. A test ensures every category points at a real section.
- **Verifiable citations.** The model must quote the policy word for word. Quotes are matched against the retrieved text, so made-up evidence is visible.
- **The claimant's category drives the limit checks** when it is valid. If the classifier disagrees, that's flagged rather than silently re-categorised.
- **Batches are inserted before any review,** so duplicates within one batch see each other. Rejected claims don't count as duplicates.
- **Lexical retrieval over embeddings.** It's deterministic, explainable, and needs no extra service for a short policy.
