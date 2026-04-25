const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 4000;

// Serve frontend static files in production
const frontendDistPath = path.join(__dirname, "..", "frontend", "dist");
const isRailwayRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
const shouldServeFrontend = (
  process.env.NODE_ENV === "production" ||
  process.env.SERVE_FRONTEND === "1" ||
  isRailwayRuntime
) && existsSync(frontendDistPath);
if (shouldServeFrontend) {
  app.use(express.static(frontendDistPath));
}

const INPUT_KEYS = [
  "business_type",
  "budget",
  "target_market",
  "positioning",
  "description"
];

const levelMapping = {
  very_low: 0.1,
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  very_high: 1.0,
  saturated: 1.0
};

const MAX_RENT = 20000;
const MAX_REVENUE_MULTIPLIER = 60000;
const BASE_FIXED_COST = 5000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 4);
// Gemini SDK reads GEMINI_API_KEY from environment automatically.
const ai = new GoogleGenAI({});

app.use(cors());
app.use(express.json());

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

function getMappedLevel(value, fallback = 0.5) {
  const key = String(value || "").toLowerCase();
  return levelMapping[key] ?? fallback;
}

function parseBudgetRange(rawBudget) {
  const budgetText = String(rawBudget || "");
  const numbers = budgetText.match(/\d[\d,]*/g) || [];
  const cleaned = numbers.map((item) => Number(item.replace(/,/g, ""))).filter(Number.isFinite);

  if (cleaned.length >= 2) {
    const [first, second] = cleaned;
    return {
      min: Math.min(first, second),
      max: Math.max(first, second)
    };
  }

  if (cleaned.length === 1) {
    return {
      min: 0,
      max: cleaned[0]
    };
  }

  return {
    min: 0,
    max: Number.POSITIVE_INFINITY
  };
}

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function clamp(number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, number));
}

function roundCurrency(value) {
  return Math.round(value);
}

function getPositioningBand(positioning) {
  const text = normalizeText(positioning);

  if (includesAny(text, ["budget", "affordable", "low"])) {
    return "budget";
  }

  if (includesAny(text, ["premium", "luxury", "high-end", "high end"])) {
    return "premium";
  }

  return "mid";
}

function extractSpecialRequirements(text) {
  const lower = normalizeText(text);
  const rules = [
    { key: "near_universities", terms: ["university", "college", "campus", "student"] },
    { key: "near_malls", terms: ["mall", "shopping"] },
    { key: "near_offices", terms: ["office", "corporate", "weekday"] },
    { key: "night_activity", terms: ["night", "late", "evening", "weekend"] },
    { key: "walk_in_focus", terms: ["walk-in", "walk in", "foot traffic", "busy"] },
    { key: "destination_focus", terms: ["destination", "pre-order", "appointment"] }
  ];

  return rules.filter((rule) => includesAny(lower, rule.terms)).map((rule) => rule.key);
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(attempt) {
  const backoffMs = 400 * 2 ** attempt;
  const jitterMs = Math.floor(Math.random() * 250);
  return Math.min(backoffMs + jitterMs, 7000);
}

function parseModelJson(rawContent) {
  const text = String(rawContent || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalized = fenced ? fenced[1].trim() : text;

  if (!normalized) {
    throw createHttpError("Gemini returned an empty response.", 502);
  }

  try {
    return JSON.parse(normalized);
  } catch {
    throw createHttpError("Gemini returned invalid JSON. Retry the request.", 502);
  }
}

function isQuotaErrorMessage(message) {
  return /quota exceeded|current quota|billing|limit: 0|free_tier|resource_exhausted/i.test(String(message || ""));
}

function isRetryableStatus(statusCode) {
  return [429, 500, 502, 503, 504].includes(Number(statusCode));
}

async function withTimeout(promise, timeoutMs) {
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(createHttpError(`Gemini API request timed out after ${timeoutMs}ms.`, 504));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiJson({ systemInstruction, userPrompt, temperature = 0.1, maxOutputTokens = 900 }) {
  if (!GEMINI_API_KEY) {
    throw createHttpError("GEMINI_API_KEY is missing. Set it in backend environment variables.", 500);
  }

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: userPrompt,
          config: {
            systemInstruction,
            temperature,
            maxOutputTokens,
            responseMimeType: "application/json"
          }
        }),
        GEMINI_TIMEOUT_MS
      );

      const text = String(response && response.text ? response.text : "").trim();

      if (!text) {
        if (attempt < GEMINI_MAX_RETRIES) {
          await sleep(getRetryDelayMs(attempt));
          continue;
        }

        throw createHttpError("Gemini returned empty content. Try a shorter prompt or retry.", 502);
      }

      return {
        parsed: parseModelJson(text),
        usage: response && response.usageMetadata ? response.usageMetadata : null
      };
    } catch (error) {
      const statusCode = Number(error && (error.status || error.statusCode));
      const message = error && typeof error.message === "string"
        ? error.message
        : "Gemini API request failed.";

      if (attempt < GEMINI_MAX_RETRIES && (isRetryableStatus(statusCode) || isQuotaErrorMessage(message))) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      if (statusCode === 429 || isQuotaErrorMessage(message)) {
        throw createHttpError(message, 429);
      }

      if (statusCode >= 500 && statusCode <= 599) {
        throw createHttpError(message, 502);
      }

      if (error && error.statusCode) {
        throw error;
      }

      throw createHttpError(message, 500);
    }
  }

  throw createHttpError("Gemini API request failed after retries.", 502);
}

function getKnownBusinessTags(dataset) {
  return [...new Set(
    dataset
      .flatMap((location) => (Array.isArray(location.business_fit_tags) ? location.business_fit_tags : []))
      .map((tag) => normalizeText(tag).replace(/\s+/g, "_"))
  )].sort();
}

function normalizeSlug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function sanitizeIntent(rawIntent, profile) {
  const profileText = normalizeText(
    `${profile.business_type} ${profile.target_market} ${profile.positioning} ${profile.description}`
  );

  const inferredTraffic = includesAny(profileText, ["walk-in", "walk in", "foot traffic", "busy", "night"])
    ? "high"
    : "medium";

  const priorityTags = Array.isArray(rawIntent && rawIntent.priority_tags)
    ? rawIntent.priority_tags.map((tag) => normalizeSlug(tag)).filter(Boolean)
    : [];

  const trafficNeedRaw = normalizeText(rawIntent && rawIntent.traffic_need);
  const competitionPreferenceRaw = normalizeText(rawIntent && rawIntent.competition_preference);
  const positioningBandRaw = normalizeText(rawIntent && rawIntent.positioning_band);

  const specialRequirements = Array.isArray(rawIntent && rawIntent.special_requirements)
    ? rawIntent.special_requirements.map((item) => normalizeSlug(item)).filter(Boolean).slice(0, 8)
    : extractSpecialRequirements(profile.description);

  return {
    priority_tags: priorityTags.length > 0 ? [...new Set(priorityTags)] : ["walk_in", "commuters"],
    traffic_need: ["low", "medium", "high"].includes(trafficNeedRaw) ? trafficNeedRaw : inferredTraffic,
    competition_preference: ["low", "flexible", "high"].includes(competitionPreferenceRaw)
      ? competitionPreferenceRaw
      : "flexible",
    positioning_band: ["budget", "mid", "premium"].includes(positioningBandRaw)
      ? positioningBandRaw
      : getPositioningBand(profile.positioning),
    special_requirements: specialRequirements,
    reasoning: typeof (rawIntent && rawIntent.reasoning) === "string" ? rawIntent.reasoning.trim() : ""
  };
}

function sanitizeFitEvaluations(rawEvaluations, candidates, profile) {
  const candidateNameMap = new Map(candidates.map((location) => [normalizeText(location.name), location.name]));
  const parsedByName = new Map();

  if (Array.isArray(rawEvaluations)) {
    for (const item of rawEvaluations) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const normalizedName = normalizeText(item.name);

      if (!candidateNameMap.has(normalizedName)) {
        continue;
      }

      parsedByName.set(normalizedName, item);
    }
  }

  return candidates.map((location) => {
    const item = parsedByName.get(normalizeText(location.name));
    const rawFitScore = Number(item && item.fit_score);
    const fitScore = Number.isFinite(rawFitScore) ? clamp(rawFitScore) : 0.5;
    const explanation = typeof (item && item.explanation) === "string" && item.explanation.trim().length > 0
      ? item.explanation.trim()
      : "Gemini indicates balanced fit across market demand, competition, and positioning.";

    return {
      name: location.name,
      fit_score: Number(fitScore.toFixed(3)),
      explanation,
      profile_used: {
        business_type: profile.business_type,
        target_market: profile.target_market,
        positioning: profile.positioning
      }
    };
  });
}

async function geminiExtractIntent(profile, knownTags) {
  const response = await callGeminiJson({
    systemInstruction:
      "You are Gemini and specialize in Malaysian SME expansion planning. Return valid JSON only. " +
      "Schema: {\"intent\": {\"priority_tags\":[\"snake_case\"],\"traffic_need\":\"low|medium|high\",\"competition_preference\":\"low|flexible|high\",\"positioning_band\":\"budget|mid|premium\",\"special_requirements\":[\"snake_case\"],\"reasoning\":\"short\"}}.",
    userPrompt: [
      `business_type: ${profile.business_type}`,
      `target_market: ${profile.target_market}`,
      `positioning: ${profile.positioning}`,
      `description: ${String(profile.description || "").replace(/\s+/g, " ").trim()}`,
      `allowed_tags: ${knownTags.join(",")}`
    ].join("\n"),
    temperature: 0,
    maxOutputTokens: 1100
  });

  const parsed = response.parsed;
  const intent = sanitizeIntent(parsed.intent || parsed, profile);

  return {
    intent,
    usage: response.usage || null
  };
}

async function geminiFitEvaluation({ profile, intent, candidates }) {
  const locationLines = candidates.map((location) => {
    const tags = Array.isArray(location.business_fit_tags) ? location.business_fit_tags.join("|") : "";

    return [
      location.name,
      `state:${location.state}`,
      `profit:${location.estimated_profit}`,
      `demand:${location.demand_level}`,
      `access:${location.accessibility}`,
      `rent:${location.rent_level}`,
      `competition:${location.competition_level}`,
      `tags:${tags}`,
      `notes:${String(location.notes || "").replace(/\s+/g, " ").trim()}`
    ].join("; ");
  });

  const response = await callGeminiJson({
    systemInstruction:
      "You are Gemini scoring SME expansion locations. Return valid JSON only. " +
      "Schema: {\"evaluations\":[{\"name\":\"exact candidate name\",\"fit_score\":0.0,\"explanation\":\"short\"}],\"overall_explanation\":\"2 concise sentences\"}. " +
      "Rules: include each location exactly once, fit_score between 0 and 1.",
    userPrompt: [
      `profile_business_type: ${profile.business_type}`,
      `profile_target_market: ${profile.target_market}`,
      `profile_positioning: ${profile.positioning}`,
      `intent_priority_tags: ${(intent.priority_tags || []).join(",")}`,
      `intent_traffic_need: ${intent.traffic_need}`,
      `intent_competition_preference: ${intent.competition_preference}`,
      `intent_positioning_band: ${intent.positioning_band}`,
      "locations:",
      ...locationLines
    ].join("\n"),
    temperature: 0.15,
    maxOutputTokens: 1800
  });

  const parsed = response.parsed;
  const evaluations = sanitizeFitEvaluations(parsed.evaluations, candidates, profile);
  const overallExplanation = typeof parsed.overall_explanation === "string"
    ? parsed.overall_explanation.trim()
    : "";

  return {
    evaluations,
    overall_explanation: overallExplanation,
    usage: response.usage || null
  };
}

function normalizeByRange(value, min, max) {
  if (max === min) {
    return 0.5;
  }

  return clamp((value - min) / (max - min));
}

function finalizeRanking({ profile, intent, candidates, fitEvaluations, aiOverallExplanation }) {
  const fitMap = new Map(fitEvaluations.map((item) => [item.name, item]));

  const profits = candidates.map((item) => item.estimated_profit);
  const minProfit = Math.min(...profits);
  const maxProfit = Math.max(...profits);

  const ranked = candidates
    .map((location) => {
      const fitData = fitMap.get(location.name);
      const fitScore = fitData ? fitData.fit_score : 0.5;
      const normalizedProfit = normalizeByRange(location.estimated_profit, minProfit, maxProfit);
      const finalScore = clamp(normalizedProfit * 0.55 + fitScore * 0.45);

      return {
        name: location.name,
        state: location.state,
        type: location.type,
        rent_level: location.rent_level,
        competition_level: location.competition_level,
        demand_level: location.demand_level,
        accessibility: location.accessibility,
        business_fit_tags: location.business_fit_tags,
        notes: location.notes,
        fit_score: Number(fitScore.toFixed(3)),
        final_score: Number(finalScore.toFixed(3)),
        estimated_revenue: location.estimated_revenue,
        estimated_cost: location.estimated_cost,
        estimated_profit: location.estimated_profit,
        ai_fit_explanation: fitData ? fitData.explanation : "No fit explanation available"
      };
    })
    .sort((a, b) => b.final_score - a.final_score || b.estimated_profit - a.estimated_profit)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const top = ranked[0];

  const fallbackExplanation =
    `${top.name} ranks highest for ${profile.business_type} because it balances ` +
    `profit (RM ${top.estimated_profit.toLocaleString("en-MY")}) with strong contextual fit ` +
    `(fit score ${top.fit_score}). Priority intent tags (${intent.priority_tags.join(", "
    )}) align with local demand and traffic conditions, while key risks include ${top.competition_level} competition and ${top.rent_level} rent.`;

  const explanation = typeof aiOverallExplanation === "string" && aiOverallExplanation.trim().length > 0
    ? aiOverallExplanation.trim()
    : fallbackExplanation;

  return {
    top_recommendation: {
      name: top.name,
      state: top.state,
      profit: top.estimated_profit,
      fit_score: top.fit_score,
      final_score: top.final_score
    },
    ranking: ranked.slice(0, 5),
    ai_explanation: explanation,
    full_ranked_table: ranked
  };
}

function validateAnalyzeInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Request body must be a JSON object.";
  }

  for (const key of INPUT_KEYS) {
    if (!(key in payload)) {
      return `Missing required field: ${key}`;
    }

    if (typeof payload[key] !== "string") {
      return `Field '${key}' must be a string.`;
    }
  }

  return null;
}

async function loadDataset() {
  const datasetPath = path.join(__dirname, "malaysia_sme_dataset_2026.json");
  const raw = await fs.readFile(datasetPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Dataset must be an array.");
  }

  return parsed;
}

app.post("/analyze", async (req, res) => {
  try {
    const validationError = validateAnalyzeInput(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing. Add it to backend environment variables before calling /analyze."
      });
    }

    const profile = req.body;
    const budgetRange = parseBudgetRange(profile.budget);
    const dataset = await loadDataset();
    const knownTags = getKnownBusinessTags(dataset);

    const scoredLocations = dataset.map((location) => {
      const mappedDemand = getMappedLevel(location.demand_level);
      const mappedRent = getMappedLevel(location.rent_level);
      const mappedCompetition = getMappedLevel(location.competition_level);
      const mappedAccessibility = getMappedLevel(location.accessibility);

      const estimatedRevenue = roundCurrency(mappedDemand * MAX_REVENUE_MULTIPLIER);
      const estimatedCost = roundCurrency(mappedRent * MAX_RENT + BASE_FIXED_COST);
      const estimatedProfit = roundCurrency(estimatedRevenue - estimatedCost);

      return {
        ...location,
        mapped_demand: mappedDemand,
        mapped_rent: mappedRent,
        mapped_competition: mappedCompetition,
        mapped_accessibility: mappedAccessibility,
        estimated_revenue: estimatedRevenue,
        estimated_cost: estimatedCost,
        estimated_profit: estimatedProfit
      };
    });

    const viableLocations = scoredLocations.filter((location) => location.estimated_cost <= budgetRange.max);

    const fallbackPool = [...scoredLocations]
      .sort((a, b) => a.estimated_cost - b.estimated_cost)
      .slice(0, 8);

    const candidatePool = (viableLocations.length > 0 ? viableLocations : fallbackPool)
      .sort((a, b) => b.estimated_profit - a.estimated_profit)
      .slice(0, 8);

    const intentResult = await geminiExtractIntent(profile, knownTags);
    const fitResult = await geminiFitEvaluation({
      profile,
      intent: intentResult.intent,
      candidates: candidatePool
    });

    const finalResult = finalizeRanking({
      profile,
      intent: intentResult.intent,
      candidates: candidatePool,
      fitEvaluations: fitResult.evaluations,
      aiOverallExplanation: fitResult.overall_explanation
    });

    return res.json({
      top_recommendation: finalResult.top_recommendation,
      ranking: finalResult.ranking,
      ai_explanation: finalResult.ai_explanation,
      data_table: finalResult.full_ranked_table,
      business_intent: intentResult.intent,
      ai_meta: {
        provider: "Google Gemini",
        model: GEMINI_MODEL,
        sdk: "@google/genai"
      },
      token_usage: {
        intent: intentResult.usage,
        fit: fitResult.usage
      },
      budget_filter: {
        min: budgetRange.min,
        max: Number.isFinite(budgetRange.max) ? budgetRange.max : null,
        used_fallback: viableLocations.length === 0
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: "Failed to analyze locations.",
      details: isQuotaErrorMessage(error.message)
        ? "Gemini quota is exhausted or disabled for this API key/project. Enable billing or use a key with quota, then retry."
        : error.message
    });
  }
});

if (shouldServeFrontend) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Gemini SME Expansion Advisor backend running on port ${PORT}`);
});
