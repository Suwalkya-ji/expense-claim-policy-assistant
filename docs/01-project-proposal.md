# Project Proposal: Expense Claim Policy Review Assistant

## 1. Summary

Finance teams spend a lot of time checking employee expense claims against the company's expense policy. Most of this work is repetitive: checking receipts, limits and dates, spotting duplicates, and working out which policy rule applies to a vague description such as "team stuff" or "travel".

This project builds an internal web application that does the repetitive checking automatically and uses AI to explain how the policy applies to each claim. A human reviewer always makes the final decision.

## 2. Problem

| Problem today | Effect |
|---|---|
| Reviewers check every claim by hand against a long policy | Slow reviews and inconsistent decisions |
| Claim descriptions are often vague | Reviewers must guess the category or go back to the employee |
| Duplicate claims and missing receipts are easy to miss | Money is paid out incorrectly |
| Decisions are not always documented | Audits are difficult and disputes are hard to settle |

## 3. Proposed solution

A web application where employees' claims are submitted and then reviewed in three layers:

1. **Rule-based checks (code).** Required fields, valid dates, supported currency, receipt rules, category spending limits, duplicates and totals. These are exact and never left to the AI.
2. **AI assistance (Google Gemini).** The AI:
   - classifies unclear descriptions into a policy category
   - finds the relevant policy section
   - explains whether the claim complies, needs clarification or needs review
   - quotes the exact policy text it relies on
   - asks for missing information

   Uncertain results are clearly marked.
3. **Human decision.** A reviewer approves, rejects, requests clarification, or overrides the AI's category with a reason. Every step is saved in the claim's history.

The AI only advises. It cannot approve or reject a claim, and the rule-based checks can only make its recommendation stricter, never more lenient.

## 4. Goals

- Cut the time a reviewer spends on a typical claim.
- Make decisions consistent by applying the same rules to every claim.
- Show the policy evidence behind every finding, so reviewers can trust or challenge it.
- Keep a complete, auditable record of every review and decision.
- Keep working when the AI service is unavailable, by falling back to rule-based checks.

## 5. Scope

**In scope:**
- **Claim entry:** a form, CSV/JSON bulk import, and an API.
- **Checks and AI review:** the rule-based checks and the AI review described above.
- **Reviewer actions and history:** reviewer actions plus the full review and decision history.
- **Supporting pages:** totals by claimant, category and status, and a page showing the policy and its limits.
- **Operations:** a hosted deployment with an optional shared login.

**Out of scope:**
- **Excluded by the brief:** reimbursement, payroll integration, tax advice, receipt scanning (OCR) and payment processing.
- **Not planned:** user accounts with roles, and email notifications to employees.

## 6. Users

| User | Needs |
|---|---|
| **Finance reviewer** (main user) | A clear queue of claims, the reason behind each recommendation, and quick actions |
| **Employee / claimant** | To be asked a clear question when information is missing (simulated in this version) |
| **Finance manager / auditor** | A full history of who decided what, when, and why |

## 7. Approach and timeline

The brief estimates 4–7 hours of focused effort.

| Phase | Work |
|---|---|
| 1. Foundation | Data model, API, rule-based checks, policy file with section IDs |
| 2. AI workflow | Classification, policy search, assessment with quotes, quote verification, fallback |
| 3. Reviewer UI | Review queue, claim detail, actions, history, submit/import, totals |
| 4. Quality | Tests, structured logs, loading/empty/error states, bug review |
| 5. Delivery | README, agent usage notes, deployment setup |

## 8. Risks and how they are handled

| Risk | Mitigation |
|---|---|
| AI gives a wrong or made-up answer | Every finding must quote the policy; quotes are checked word for word; low-confidence results are marked "Uncertain"; a human decides |
| AI service is down or over its quota | Automatic retries; the app then falls back to rule-based checks and shows the reason |
| Claim text tries to manipulate the AI | Prompts treat claim text as data, not instructions; the AI's output must match a fixed format |
| Policy changes over time | The policy and limits are stored as editable files; tests check that the config matches the policy text |

## 9. Success criteria

- Every requirement in the brief works end to end in the hosted app.
- Rule-based checks catch every case in the test claim set.
- Each AI finding links to a real policy section with a verified quote.
- The automated test suite passes.
- A reviewer can see the full history of any claim.
