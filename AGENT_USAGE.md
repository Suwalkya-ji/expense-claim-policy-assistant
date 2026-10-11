# Agent Usage

This document explains how I used AI tools to build this project: which tools I used, the prompts I gave, what I handed off, where the AI got things wrong, and how I checked the results.

In short: an AI coding agent wrote most of the code, and I directed the work, tested every version myself, and decided what went into the repository.

---

## 1. Tools

| Tool | What I used it for |
|---|---|
| **Claude Code** (AI coding agent) | Writing the backend, frontend, tests, logging, deployment files and documentation |
| **Claude Code sub-agent** | A separate, read-only review of the whole codebase to find bugs |
| **Playwright** (headless browser) | Clicking through the app and taking screenshots after UI changes |
| **Docker** | Running MongoDB locally, and testing the production container |
| **Google Gemini** | The AI *inside* the app: it classifies claims and explains policy. It was not used to write code |

**Decisions I made myself:**
- The tech stack (MERN).
- The AI provider: Gemini only, instead of the Anthropic API the first version used.
- When something was "done" and could be pushed.

---

## 2. Prompts I used

Below are the main prompts I gave the coding agent, in the order I used them. The original messages were shorter and often came with screenshots. Here they are written out in a structured form (context, task, requirements, constraints, expected output), with the same intent.

### 2.1 Project kickoff

I started by giving the agent the project documents and asking it to understand them fully before writing any code:

> I want to build a project. First, thoroughly read and understand the three documentation files I provide:
>
> 1. `01-project-proposal.md`
> 2. `02-prd.md`
> 3. `03-tech-stack.md`
>
> Understand the project vision, problem statement, requirements, features, user workflows and technology stack. Analyse the documents and identify any missing requirements, inconsistencies or potential technical challenges.
>
> Then give me a summary of your understanding and ask me any necessary clarification questions.
>
> **Important:** Do not start coding or make any changes yet. Wait for my approval before proceeding with development. Follow these documents as the source of truth throughout the project.

This made the agent confirm its understanding before it wrote any code, and kept the work tied to the agreed requirements.

### 2.2 Build the application

> **Context:** I am building an internal tool for a finance team that reviews employee expense claims against the company's expense policy. Screenshots of the full brief are attached.
>
> **Task:** Build the complete application using the MERN stack (MongoDB, Express, React, Node.js).
>
> **Requirements:**
> 1. **Claim format:** claimant, date, category, amount, currency, description, receipt available (yes/no).
> 2. **AI workflow:**
>    - classify unclear descriptions into policy categories
>    - retrieve the relevant policy section
>    - explain whether a claim complies, needs clarification or needs review
>    - ask for missing information
>    - cite the policy evidence behind each finding
>    - clearly mark uncertain classifications
> 3. **Rule-based validation (no AI):** detect duplicate claims, calculate totals, identify missing receipts, check configured category limits, and validate dates and required fields.
> 4. **Reviewer actions:**
>    - approve or reject a claim
>    - request clarification
>    - override the AI classification with a reason
>    - view the complete review and decision history
>
> **Constraints:**
> - The AI must only advise. Every final decision is made by a human reviewer.
> - Facts such as limits, dates and duplicates must be checked in code, never by the AI.
> - Out of scope: reimbursement, payroll integration, tax advice, receipt OCR and payment processing.
>
> **Expected output:** A working frontend and backend with data persistence, automated tests for the important behaviour, and a README with setup instructions.

### 2.3 Switch the AI provider

> **Context:** The first version uses the Anthropic API. I want to use Google Gemini instead.
>
> **Task:**
> 1. Integrate Google Gemini using the official SDK, reading the key from `GEMINI_API_KEY`.
> 2. Then remove the Anthropic SDK, its configuration and every reference to it, so Gemini is the only AI provider.
>
> **Constraints:** Keep the same AI workflow and output format. The app must still work without a key, using rule-based checks only.
>
> **Expected output:** Updated code, tests, `.env.example` and README.

### 2.4 Review and fix issues found during testing

> **Context:** I ran the app on my machine and it shows a Gemini error (screenshot attached).
>
> **Task:** Review the entire repository, not just this error. Find the root cause of every real problem, including bugs I have not reported yet, and fix them.
>
> **Constraints:**
> - Fix root causes, not symptoms.
> - Add a test for each bug you fix.
> - Do not change behaviour that is already correct.
>
> **Expected output:** A list of the problems found, what was changed, and confirmation that all tests pass.

> **Context:** The header says AI is enabled, but claims show "Heuristic (no AI)". Some claims are reviewed by AI and others are not (screenshots attached).
>
> **Task:** Find out why the AI results are inconsistent and fix it. When the AI cannot run, the app must tell the reviewer exactly why.
>
> **Expected output:** The cause, the fix, and clear messages in the UI and server logs.

> **Context:** I entered the claim "Travel from office to home" manually and it was marked compliant. The policy does not allow commuting.
>
> **Task:** Make sure claims like this are flagged, even when the AI is unavailable.
>
> **Constraints:** The rule must be based on the policy text, and the finding must quote the policy.

### 2.5 Prepare for submission

> **Context:** The project will be reviewed against the following requirements (screenshot attached).
>
> **Task:** Bring the project up to these standards:
> 1. Clear loading, empty, validation, success and failure states in the UI.
> 2. Structured application and AI-workflow logs.
> 3. Focused tests for important behaviour.
> 4. A deployable setup for a hosted environment.
> 5. A `README.md` covering setup, architecture, completed and excluded scope, tests, limitations and deployment.
> 6. An `AGENT_USAGE.md` describing tools, prompts, delegated work, mistakes and verification.
> 7. A `.env.example` with configuration names only. No real secrets are to be committed.
>
> **Expected output:** All items completed, verified, and pushed to the repository.

> **Task:** Write a set of test claims I can enter manually. Cover every rule-based check and AI case, and give the expected result for each claim.
>
> **Constraint:** Run each claim through the review pipeline first, so the expected results are confirmed, not guessed.

> **Task:** Clean up the codebase before submission. Remove unused code and files, fix all lint warnings, and confirm that the project still builds, passes all tests and runs correctly.

### 2.6 Prompts the app sends to Gemini

The app has two prompts of its own. They are in the code, not part of the chat:

- **Classification** (`server/src/services/classifier.js`): pick one category from a fixed list, give an honest confidence score and other likely categories, and treat the claim text as data, not instructions.
- **Policy assessment** (`server/src/services/review.js`):
  - only advise, never decide
  - support every finding with a section ID and an exact quote from the policy
  - don't invent rules
  - don't contradict the rule-based checks
  - only ask the claimant a question when information is really missing

Both prompts require Gemini to reply in a fixed JSON format, so the app can rely on the shape of the answer.

---

## 3. Work I delegated

**To the coding agent:** almost all of the implementation:
- the API and database model
- the review pipeline and policy retrieval
- the React screens
- tests, logging, deployment files and these docs

I reviewed the results by running the app myself and reporting problems back.

**To a separate review agent:** a full bug review of the codebase. I asked it not to change any files, only to report each problem with the file, line, an example input that breaks it, and a suggested fix. It found 9 real bugs, and all were fixed with a test for each:

1. Values like `true` or `"0x20"` were accepted as amounts.
2. `"12,50"` (a comma as the decimal point) was read as 1250.
3. Two claims with no amount were flagged as duplicates of each other.
4. The daily meal limit depended on the order of claims in a bulk upload.
5. A claim dated today could be flagged as "future" because of time zones.
6. Bad input caused server errors or created blank claims.
7. Approved or rejected claims could still be re-reviewed.
8. A second clarification request could be sent while one was still open.
9. A `"` character in a CSV file could swallow the rows after it.

---

## 4. Mistakes and rejected suggestions

### Mistakes the AI made, and how they were caught

| Problem | How it was found | How it was fixed |
|---|---|---|
| The default Gemini model (`gemini-2.5-flash`) was no longer available to new API keys | I saw the error in the app | Changed the default model. The app now checks the model at startup and explains the error clearly |
| No handling for Gemini's free-tier rate limit, so some claims got AI reviews and others didn't | I noticed inconsistent results across claims | Added automatic retries that wait as long as Gemini asks, optional request pacing, and a "partly AI" label |
| AI was silently off because the key wasn't loaded, with no explanation | I asked why AI wasn't available | The app now loads the settings file reliably and says exactly what is wrong (missing file, wrong name, empty key) |
| A commute claim was marked "compliant" when Gemini was unavailable | I tested a claim by hand | Added rule-based policy exclusions (commuting, minibar, gift cards, fines, etc.), each linked to the exact policy sentence |
| The first exclusion list wrongly flagged "keyboard for work **laptop**" and "**monitor** stand" | The agent ran a 16-claim test set before giving it to me | Removed that rule. The policy only excludes those items above the spending limit, which was already checked |
| A "parking fine" filed under Meals was marked compliant | The agent checked the sample data | Category mismatches are now flagged, and non-reimbursable items always need review |
| The fallback summary said "no rule violations" while the claim said "Needs review" | The agent's own screenshot | The summary now reflects the actual warnings |
| A naming conflict in the code broke the review module | The test suite failed | Renamed the variable |
| Some early tests expected the wrong result | The tests failed | The tests were corrected; the app's behaviour was right |

### Suggestions I chose not to follow

- **Switch to Gemini's newer "Interactions API"** (suggested in a Gemini error message). The standard API already does what this app needs.
- **Combine classification and assessment into one AI call** to save quota. The rule checks need the category first, so one combined call would assess the claim against limits the model had not been shown.
- **Use embeddings for policy search.** The policy has only 17 sections. Keyword search is predictable, easy to explain, and needs no extra service.
- **Automatically re-review related claims when one changes.** This would use more AI quota. It is listed as a known limitation, and reviewers can click "Re-run review".
- **Require PowerShell 7 on Windows.** I changed the README commands so they work in the default Windows PowerShell instead.

---

## 5. How I verified the output

1. **Automated tests.** 46 tests run with `npm test`. They cover:
   - the rule checks
   - policy search
   - the review pipeline
   - Gemini error handling and retries
   - the full API against a real MongoDB database
   - logging, CSV import and form hints

   Gemini is replaced with a fake in tests, so they are fast, free and give the same result every time.
2. **Browser testing.** After each UI change, the main flows were clicked through in a real browser and checked with screenshots: submitting claims, requesting clarification, the claimant's reply, approving and rejecting, overriding a category, and the totals page.
3. **Testing with real Gemini.** I ran the app on my machine with a real API key and confirmed that claims were reviewed by Gemini, with policy quotes marked as verified.
4. **Manual test set.** I entered a set of 16 test claims, one for each rule and AI case, and compared the results with the expected outcomes.
5. **Deployment check.** A fresh copy of the repository was built and started with the same commands the hosting platform uses. The Docker image was also run and checked.
6. **My own review.** I ran every version on Windows, reported problems with screenshots, and only pushed changes after they worked.
