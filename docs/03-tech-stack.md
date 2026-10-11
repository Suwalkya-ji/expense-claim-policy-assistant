# Tech Stack

This document lists the technologies used in the project and explains why each one was chosen.

## 1. Overview

The project uses the **MERN** stack:

```
┌──────────────────────────┐      HTTP/JSON       ┌──────────────────────────────┐
│  React 19 + Vite (client) │ ───────────────────► │  Express 5 on Node 22 (API)  │
│  Review queue, forms,     │ ◄─────────────────── │  Rule checks, review pipeline │
│  claim detail, totals     │                      │  logging, optional login      │
└──────────────────────────┘                      └───────┬──────────────┬───────┘
                                                          │              │
                                                 Mongoose │              │ @google/genai
                                                          ▼              ▼
                                                 ┌──────────────┐  ┌──────────────┐
                                                 │   MongoDB    │  │ Google Gemini│
                                                 │ (claims +    │  │ (classify +  │
                                                 │  history)    │  │  assess)     │
                                                 └──────────────┘  └──────────────┘
```

In production, Express also serves the built React app, so the whole application runs as **one web service** plus a database.

## 2. Technologies

### Frontend

| Technology | Version | Why |
|---|---|---|
| **React** | 19 | Component-based UI; well known; good fit for a single-page review tool |
| **Vite** | 8 | Fast development server and production build; proxies `/api` to the backend during development |
| **Plain CSS** | — | The UI is small, so a CSS framework would add weight without much benefit |
| **oxlint** | 1.x | Fast linter that catches unused code and React mistakes |

### Backend

| Technology | Version | Why |
|---|---|---|
| **Node.js** | 22+ | Same language as the frontend; built-in test runner; modern JavaScript (ES modules) |
| **Express** | 5 | Simple, well-known HTTP framework; Express 5 handles errors from async route handlers automatically |
| **Mongoose** | 9 | Schemas and validation on top of MongoDB |
| **dotenv** | 18 | Loads settings from `server/.env` during local development |
| **cors** | 2 | Allows the frontend and API to run on different ports during development |

### Database

| Technology | Why |
|---|---|
| **MongoDB** (local via Docker; MongoDB Atlas when hosted) | A claim naturally fits in one document: its fields, latest review, all past reviews, clarifications and history. MongoDB stores this without joins and handles the flexible shape of AI review results |

### AI

| Technology | Why |
|---|---|
| **Google Gemini** via the official `@google/genai` SDK | Strong language understanding; supports **structured JSON output**, so each reply must match a fixed schema; free tier available for development |
| Default model: `gemini-3.8-flash` (configurable with `GEMINI_MODEL`) | Fast and low cost; good enough for classification and short policy explanations |

How the AI is used safely:
- **Structured output:** two prompts (classify, then assess), each with a JSON schema for the reply.
- **Untrusted input:** claim text is treated as data, never as instructions.
- **Verified quotes:** every policy quote is checked against the real policy text.
- **Retries:** rate limits and temporary errors are retried, waiting as long as Gemini asks.
- **Fallback:** if the AI still fails, rule-based analysis is used and the reason is shown.

### Policy search

| Approach | Why |
|---|---|
| **TF-IDF keyword search** over the policy's sections (written in-house, no library) | The policy is short (17 sections). Keyword search is predictable, easy to explain, and needs no extra service. Embeddings would add cost and complexity with little benefit at this size |

### Testing

| Technology | Why |
|---|---|
| **Node built-in test runner** (`node --test`) | No extra test framework needed |
| **Supertest** | Calls the Express API in tests without starting a real server |
| **Real MongoDB in API tests** | Tests the actual database behaviour; these tests skip themselves if MongoDB isn't running |
| **Fake Gemini** (a stand-in function or fake HTTP responses) | Tests are fast, free and give the same result every time |

### Logging

| Approach | Why |
|---|---|
| **Small in-house JSON-lines logger** | One JSON object per line is easy to search in hosting dashboards. It logs HTTP requests (with request IDs), every AI call (time, attempts, tokens, result), reviews and decisions. `LOG_FORMAT=pretty` gives readable output locally |

### Deployment

| Technology | Why |
|---|---|
| **Render** (`render.yaml` blueprint) | Free web service tier; deploys from GitHub; health check support; secrets entered in its dashboard |
| **MongoDB Atlas** | Free hosted MongoDB cluster |
| **Docker** (`Dockerfile`) | Alternative way to run the app anywhere as a single container |
| **docker-compose** | Starts MongoDB locally with one command |

## 3. Project structure

```
├── client/                 React frontend
│   └── src/
│       ├── components/     ClaimList, ClaimDetail, SubmitClaims, Totals, PolicyView
│       ├── api.js          API calls
│       ├── csv.js          CSV import parser
│       └── fieldHints.js   Form hints
├── server/                 Express backend
│   ├── policy/             expense-policy.md (with section IDs) + policy-config.json (limits, rates, exclusions)
│   ├── data/               Sample claims
│   ├── scripts/seed.js     Loads sample claims
│   ├── src/
│   │   ├── routes/         REST API
│   │   ├── models/         Mongoose claim model
│   │   ├── services/       validation, policy search, classifier, review pipeline, Gemini client
│   │   ├── logger.js       Structured logging
│   │   └── env.js          Settings loading
│   └── test/               Automated tests
├── docs/                   Proposal, PRD, tech stack
├── Dockerfile, render.yaml, docker-compose.yml
├── README.md, AGENT_USAGE.md
```

## 4. Configuration

All settings are environment variables. `server/.env.example` lists them with no real values.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Database connection |
| `GEMINI_API_KEY` | Enables AI review |
| `GEMINI_MODEL` | Gemini model (default `gemini-3.8-flash`) |
| `GEMINI_RPM` | Requests per minute allowed by the Gemini plan (free tier: 5) |
| `APP_USERNAME` / `APP_PASSWORD` | Optional shared login for the hosted app |
| `LOG_LEVEL` / `LOG_FORMAT` | Logging detail and format |
| `PORT` | HTTP port |

## 5. Alternatives considered

| Option | Decision |
|---|---|
| SQL database (PostgreSQL / SQLite) | Not chosen. The nested review and history data fits a document database better, and MERN was the chosen stack |
| Anthropic Claude API | Used in the first version, then replaced with Gemini at the project owner's request |
| Embedding-based policy search | Not needed for a short policy; keyword search is more predictable |
| One combined AI call instead of two | Rejected. The rule checks need the category before the assessment, so classification must come first |
| UI component library (MUI, Tailwind) | Not needed for a small internal tool; plain CSS keeps the bundle small |
