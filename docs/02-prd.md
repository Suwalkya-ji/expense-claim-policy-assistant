# Product Requirements Document (PRD)

**Product:** Expense Claim Policy Review Assistant
**Status:** Implemented
**Related:** [Project proposal](01-project-proposal.md) · [Tech stack](03-tech-stack.md) · [README](../README.md)

---

## 1. Purpose

Help finance reviewers check employee expense claims against the company expense policy faster and more consistently. Rule-based checks handle the facts, AI explains how the policy applies, and a human makes every decision.

## 2. Users and user stories

**Finance reviewer:**
- As a reviewer, I want to see all claims waiting for review, so that I know what to work on.
- As a reviewer, I want each claim to show a clear recommendation with reasons, so that I can decide quickly.
- As a reviewer, I want to see the exact policy text behind each finding, so that I can trust or challenge it.
- As a reviewer, I want unclear or uncertain AI results to be clearly marked, so that I don't rely on them blindly.
- As a reviewer, I want to approve, reject or ask the employee a question, so that every claim reaches a decision.
- As a reviewer, I want to correct the AI's category and record why, so that the claim is checked against the right rules.
- As a reviewer, I want to see the full history of a claim, so that I can explain any decision later.
- As a reviewer, I want to see totals by person, category and status, so that I can spot unusual spending.

**Employee (simulated):**
- As an employee, I want to be told exactly what information is missing, so that I can fix my claim once.

## 3. Claim format

| Field | Type | Notes |
|---|---|---|
| `claimant` | text | Employee name |
| `date` | `YYYY-MM-DD` | Date of the expense |
| `category` | text | As entered by the employee; mapped to a policy category |
| `amount` | number | Positive; a dot for decimals |
| `currency` | code | USD, EUR, GBP, INR, CAD or AUD |
| `description` | text | What it was and the business purpose |
| `receiptAvailable` | yes / no | Whether a receipt exists |

Incomplete claims are accepted, so the review can flag them and ask for the missing information.

## 4. Functional requirements

### 4.1 Claim submission

| ID | Requirement |
|---|---|
| F-1 | Submit a single claim through a form |
| F-2 | Import many claims by pasting CSV (comma or semicolon) or JSON |
| F-3 | Load a built-in set of sample claims |
| F-4 | Show non-blocking hints on the form, e.g. future date or unsupported currency |
| F-5 | Review every claim automatically as soon as it is submitted |

### 4.2 Rule-based checks

These checks are done in code and are always authoritative on facts.

| ID | Check | Result |
|---|---|---|
| D-1 | All required fields are present | Error: asks the employee for the field |
| D-2 | Date is valid, not in the future, and within 90 days | Error or warning |
| D-3 | Amount is a positive number; currency is supported | Error: asks for a fix |
| D-4 | Receipt is present for expenses of USD 25 or more | Error: asks for the receipt |
| D-5 | Amount is within the category's per-claim limit (converted to USD) | Error |
| D-6 | Daily meal total for a person is within USD 75 | Warning |
| D-7 | Exact duplicate (same person, date, amount, currency) or near duplicate (within 3 days) | Error or warning |
| D-8 | Description mentions something the policy excludes, e.g. commuting, minibar or gift cards | Warning, quoting the exact policy sentence |
| D-9 | Totals by claimant, category and status, in USD | Shown on the Totals page |

### 4.3 AI workflow

| ID | Requirement |
|---|---|
| A-1 | Classify the description into a policy category, with a confidence score and alternatives |
| A-2 | Mark the classification **Uncertain** when confidence is below 75% |
| A-3 | Flag when the AI's category differs from the employee's category |
| A-4 | Find the relevant policy sections: by category, by failed check, and by matching words in the description |
| A-5 | Recommend **Appears compliant**, **Needs clarification** or **Needs review**, with a short explanation |
| A-6 | Support every finding with a policy section ID and an exact quote |
| A-7 | Check each quote against the policy text and label it verified or unverified |
| A-8 | Suggest specific questions for the employee when information is missing |
| A-9 | Never weaken a rule-based result: checks can only make the recommendation stricter |
| A-10 | If the AI fails (error, quota, timeout), retry, then fall back to rule-based analysis and show the reason |

### 4.4 Reviewer actions

| ID | Action | Rule |
|---|---|---|
| R-1 | Approve | A note is required if any check failed |
| R-2 | Reject | A reason is required |
| R-3 | Request clarification | A message or at least one question is required; only one open request at a time |
| R-4 | Record the employee's response | Can update fields; the claim is reviewed again |
| R-5 | Override the category | A category and a reason (5+ characters) are required; checks re-run |
| R-6 | Re-run the review | For one claim, or for all open claims without a full AI review |
| R-7 | View history | Timeline of submissions, reviews, decisions, overrides and clarifications, plus every past review |

Approved and rejected claims are final.

### 4.5 Claim statuses

```
Pending review ──approve──► Approved (final)
      │        ──reject───► Rejected (final)
      │
      └─request clarification─► Awaiting claimant ──response──► Pending review (re-reviewed)
```

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| **Usability** | Clear loading, empty, validation, success and failure states on every screen |
| **Reliability** | The app keeps working without the AI; AI errors never block a reviewer |
| **Transparency** | Every AI finding shows its evidence; heuristic (non-AI) results are labelled |
| **Auditability** | Every action is stored with who did it, when, and why |
| **Observability** | Structured JSON logs for HTTP requests, AI calls (time, attempts, tokens, outcome), reviews and decisions |
| **Security** | No secrets in the repository; optional shared login for the hosted app; claim text is treated as untrusted by the AI prompts |
| **Configurability** | Policy text, limits, FX rates and exclusions are editable files, not code |
| **Quality** | Automated tests for the checks, the AI pipeline (with Gemini replaced by a fake), and the API |

## 6. UI overview

| Screen | Contents |
|---|---|
| **Review queue** | List of claims with status, recommendation, category and issue count; filter by status; re-run open reviews |
| **Claim detail** | Fields, recommendation banner, classification and confidence, rule-check results, AI findings with quotes, policy sections, clarifications, reviewer actions, history |
| **Submit claims** | Single-claim form with hints; bulk CSV/JSON import; load sample claims |
| **Totals** | Totals by claimant, category and status, with or without rejected claims |
| **Policy** | The full policy with section IDs, and the configured limits |

## 7. Out of scope

- **Excluded by the brief:** reimbursement, payroll integration, tax advice, receipt OCR and payment processing.
- **Not built:** user accounts and roles, email notifications, receipt file upload, editing the policy in the UI, and live exchange rates.

## 8. Acceptance criteria

- [x] All claim fields can be entered by form, bulk import and API.
- [x] Each rule-based check (D-1 to D-9) produces the expected result on the test claim set.
- [x] AI findings include a policy section ID and a quote, and quotes are verified.
- [x] Uncertain classifications are visibly marked.
- [x] Reviewer actions R-1 to R-7 work, and their rules are enforced by the API.
- [x] The full history of a claim is visible.
- [x] With no AI key, or with the AI failing, every claim still gets a rule-based review with the reason shown.
- [x] The automated test suite passes.
