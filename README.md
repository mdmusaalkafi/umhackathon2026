# Z.AI SME Expansion Advisor

AI-powered decision intelligence web app for SME expansion planning in Malaysia.

This project is built for Domain 2: AI for Economic Empowerment & Decision Intelligence.

## What It Demonstrates

- Interpretation of structured and unstructured inputs
- Context-aware reasoning with trade-off analysis
- Quantifiable impact in RM (revenue, cost, profit)
- Clear explainability for recommendations

The system uses a hybrid approach:

1. Deterministic scoring engine (financial math)
2. Mock Z.AI multi-stage reasoning (intent extraction, fit scoring, final explanation)

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
5. Mock Z.AI Call 1: extract business intent from unstructured description
6. Mock Z.AI Call 2: evaluate fit score for candidates
7. Mock Z.AI Call 3: produce final ranking and explanation

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

## Run Locally

### 1) Start Backend

```bash
cd backend
npm install
npm start
```

Backend runs on `http://localhost:4000`.

### 2) Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on Vite default port (usually `http://localhost:5173`).

If needed, configure API base URL:

```bash
# frontend/.env
VITE_API_BASE_URL=http://localhost:4000
```

## Frontend Output Panels

- Input Form (5 required fields)
- Top Recommendation Card
- Top 5 Ranked Locations
- AI Explanation Panel
- Transparent Data Table

## Validation Notes

- Frontend build passes (`npm run build`)
- Backend smoke-tested with `POST /analyze`
- Response includes ranking, explanation, and quantifiable RM metrics