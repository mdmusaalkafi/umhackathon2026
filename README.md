# Gemini SME Expansion Advisor

AI-powered decision intelligence web app for SME expansion planning in Malaysia.

This project is built for Domain 2: AI for Economic Empowerment & Decision Intelligence.

## What It Demonstrates

- Interpretation of structured and unstructured inputs
- Context-aware reasoning with trade-off analysis
- Quantifiable impact in RM (revenue, cost, profit)
- Clear explainability for recommendations

The system uses a hybrid approach:

1. Deterministic scoring engine (financial math)
2. Real Google Gemini reasoning (intent extraction, fit scoring, explanation)

## Tech Stack

- Frontend: React (StrictMode, functional components) + Tailwind CSS + Vite
- Backend: Node.js + Express
- Database: None (local JSON dataset)

## Workspace Structure

```
backend/
	server.js
	package.json
	malaysia_sme_dataset_2026.json
frontend/
	package.json
	index.html
	tailwind.config.js
	postcss.config.js
	vite.config.js
	src/
		main.jsx
		App.jsx
		index.css
```

## Strict Input Schema (Frontend -> Backend)

```json
{
	"business_type": "string",
	"budget": "string",
	"target_market": "string",
	"positioning": "string",
	"description": "string"
}
```

## Dataset Schema (Local File)

`backend/malaysia_sme_dataset_2026.json`

```json
[
	{
		"name": "string",
		"state": "string",
		"type": "string",
		"rent_level": "string",
		"competition_level": "string",
		"demand_level": "string",
		"accessibility": "string",
		"business_fit_tags": ["string"],
		"notes": "string"
	}
]
```

## Scoring Engine Logic

### Level Mapping

- `very_low = 0.1`
- `low = 0.2`
- `medium = 0.5`
- `high = 0.8`
- `very_high = 1.0`
- `saturated = 1.0` (competition)

### Financial Formulas

- `Estimated Revenue = mapped_demand_level * 60000`
- `Estimated Cost = (mapped_rent_level * 20000) + 5000`
- `Estimated Profit = Estimated Revenue - Estimated Cost`

The backend also applies budget filtering before fit evaluation.

## API

### POST `/analyze`

Runs the full pipeline:

1. Validate input schema
2. Load dataset
3. Compute revenue/cost/profit per location
4. Filter by budget feasibility
5. Gemini Call 1: extract business intent from unstructured description
6. Gemini Call 2: evaluate contextual fit score for candidate locations
7. Combine fit scores with RM profit metrics to produce explainable ranking

## Environment Variables (Backend)

Create a backend environment file before starting the server:

```bash
# backend/.env
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-3-flash-preview
PORT=4000
```

Optional tuning:

```bash
GEMINI_TIMEOUT_MS=30000
GEMINI_MAX_RETRIES=4
SERVE_FRONTEND=1
```

`SERVE_FRONTEND` is optional. In cloud production (`NODE_ENV=production`), the backend serves `frontend/dist` automatically.

Security:

- Never commit API keys to version control.
- Use backend environment variables (or backend/.env in local development).

### Example Response Shape

```json
{
	"top_recommendation": {
		"name": "Subang Jaya SS15",
		"state": "Selangor",
		"profit": 33000,
		"fit_score": 0.699,
		"final_score": 0.865
	},
	"ranking": [],
	"ai_explanation": "Subang Jaya SS15 ranks highest because ...",
	"data_table": [],
	"business_intent": {},
	"budget_filter": {
		"min": 5000,
		"max": 20000,
		"used_fallback": false
	}
}
```

## Run Locally (Dev Mode)

### 1) Install Dependencies

```bash
cd backend
npm install
cd ../frontend
npm install
```

### 2) Configure Backend Environment

Create `backend/.env` from `backend/.env.example` and set at least:

```bash
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-3-flash-preview
PORT=4000
```

### 3) Run Backend + Frontend

Terminal 1:

```bash
cd backend
npm start
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Frontend: `http://localhost:5173` (default Vite)
Backend: `http://localhost:4000`

The frontend defaults to `http://localhost:4000` in development.

## Run Locally (Single Production Server)

This mirrors hackathon/cloud deployment behavior.

```bash
cd frontend
npm run build

cd ../backend
npm start
```

Then open `http://localhost:4000`.

Notes:

- In production mode (`NODE_ENV=production`), backend serves `frontend/dist` automatically.
- For local preview without setting `NODE_ENV=production`, set `SERVE_FRONTEND=1` in `backend/.env`.

## Cloud Deployment (Single Service)

Deploy as one Node.js web service from repository root.

### Required Environment Variables

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (recommended: `gemini-3-flash-preview`)
- `PORT` (usually injected by platform)

### Build Command

```bash
npm install --prefix backend
npm install --prefix frontend
npm run build --prefix frontend
```

### Start Command

```bash
npm start --prefix backend
```

This works on Render, Railway, and similar platforms.

## Railway Deployment (Recommended)

This repo includes `railway.toml` so Railway uses the correct build/start commands automatically.

### 1) Create Railway Project

- Push this repo to GitHub.
- In Railway, create a new project from this GitHub repository.
- Select the root folder (do not set service root to backend/ or frontend/).

### 2) Set Environment Variables in Railway

- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL=gemini-3-flash-preview`

Do not set `PORT` manually in Railway; Railway injects it automatically.

### 3) Deploy

- Trigger deploy from Railway UI.
- Railway will run build and start from `railway.toml`:

```toml
[build]
buildCommand = "npm install --prefix backend && npm install --prefix frontend && npm run build --prefix frontend"

[deploy]
startCommand = "npm start --prefix backend"
healthcheckPath = "/healthz"
```

### 4) Verify Live App

- Open your generated Railway domain.
- Verify health endpoint: `/healthz` returns `{ "status": "ok" }`.
- Submit a sample analysis request from the UI.

### Important Gemini Quota Note

If `/analyze` returns status `429` with quota/billing details, your Gemini project key has no available quota. Enable billing or use a key/project with quota.

## Frontend Output Panels

- Input Form (5 required fields)
- Top Recommendation Card
- Top 5 Ranked Locations
- AI Explanation Panel
- Transparent Data Table

## Validation Notes

- Frontend build passes (`npm run build`)
- Backend serves built frontend in single-server mode
- Backend smoke-tested with `POST /analyze` (returns expected error if API key/quota is unavailable)
- Response includes ranking, explanation, and quantifiable RM metrics