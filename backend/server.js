const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

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

app.use(cors());
app.use(express.json());

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

async function mockZaiExtractIntent(profile) {
  const profileText = normalizeText(
    `${profile.business_type} ${profile.target_market} ${profile.positioning} ${profile.description}`
  );

  const tagRules = [
    { tag: "students", terms: ["student", "university", "college", "campus"] },
    { tag: "office_workers", terms: ["office", "corporate", "professional", "weekday"] },
    { tag: "tourists", terms: ["tourist", "travel", "hotel", "visitor"] },
    { tag: "families", terms: ["family", "kids", "children", "parents"] },
    { tag: "night_owls", terms: ["night", "late", "evening", "weekend"] },
    { tag: "walk_in", terms: ["walk-in", "walk in", "foot traffic", "busy"] },
    { tag: "destination", terms: ["destination", "appointment", "pre-order", "preorder"] },
    { tag: "budget_shoppers", terms: ["budget", "affordable", "value", "cheap"] },
    { tag: "premium_shoppers", terms: ["premium", "luxury", "high-end", "exclusive"] }
  ];

  const extractedTags = tagRules
    .filter((rule) => includesAny(profileText, rule.terms))
    .map((rule) => rule.tag);

  const positioningBand = getPositioningBand(profile.positioning);

  const intent = {
    priority_tags: extractedTags.length > 0 ? extractedTags : ["walk_in", "commuters"],
    traffic_need: includesAny(profileText, ["walk-in", "walk in", "foot traffic", "busy"]) ? "high" : "medium",
    competition_preference: includesAny(profileText, ["less competitive", "low competition", "fewer competitors"])
      ? "low"
      : "flexible",
    positioning_band: positioningBand,
    special_requirements: extractSpecialRequirements(profileText)
  };

  return {
    intent
  };
}

function scoreTagFit(intentTags, locationTags) {
  const locationTagSet = new Set((locationTags || []).map((tag) => normalizeText(tag)));
  const matched = intentTags.filter((tag) => locationTagSet.has(normalizeText(tag)));

  if (intentTags.length === 0) {
    return 0.4;
  }

  const matchRatio = matched.length / intentTags.length;
  return clamp(0.2 + matchRatio * 0.8);
}

function scorePositioningFit(positioningBand, rentScore, competitionScore) {
  if (positioningBand === "budget") {
    return clamp(1 - (rentScore * 0.65 + competitionScore * 0.35));
  }

  if (positioningBand === "premium") {
    return clamp(0.45 + rentScore * 0.3 + competitionScore * 0.25);
  }

  return clamp(0.7 - Math.abs(rentScore - 0.5) * 0.35 - Math.abs(competitionScore - 0.5) * 0.25);
}

function scoreTrafficFit(trafficNeed, accessibilityScore, demandScore) {
  if (trafficNeed === "high") {
    return clamp(accessibilityScore * 0.55 + demandScore * 0.45);
  }

  return clamp(0.55 + demandScore * 0.25 + accessibilityScore * 0.2);
}

async function mockZaiFitEvaluation({ profile, intent, candidates }) {
  const evaluations = candidates.map((location) => {
    const tagFit = scoreTagFit(intent.priority_tags, location.business_fit_tags);
    const trafficFit = scoreTrafficFit(intent.traffic_need, location.mapped_accessibility, location.mapped_demand);
    const positioningFit = scorePositioningFit(
      intent.positioning_band,
      location.mapped_rent,
      location.mapped_competition
    );

    const fitScore = clamp(tagFit * 0.4 + trafficFit * 0.35 + positioningFit * 0.25);

    const reason =
      `Tag match ${Math.round(tagFit * 100)}%, traffic suitability ${Math.round(trafficFit * 100)}%, ` +
      `positioning compatibility ${Math.round(positioningFit * 100)}%.`;

    return {
      name: location.name,
      fit_score: Number(fitScore.toFixed(3)),
      explanation: reason,
      profile_used: {
        business_type: profile.business_type,
        target_market: profile.target_market,
        positioning: profile.positioning
      }
    };
  });

  return {
    evaluations
  };
}

function normalizeByRange(value, min, max) {
  if (max === min) {
    return 0.5;
  }

  return clamp((value - min) / (max - min));
}

async function mockZaiFinalizeRanking({ profile, intent, candidates, fitEvaluations }) {
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

  const explanation =
    `${top.name} ranks highest for ${profile.business_type} because it balances ` +
    `profit (RM ${top.estimated_profit.toLocaleString("en-MY")}) with strong contextual fit ` +
    `(fit score ${top.fit_score}). Priority intent tags (${intent.priority_tags.join(", "
    )}) align with local demand and traffic conditions, while key risks include ${top.competition_level} competition and ${top.rent_level} rent.`;

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

    const profile = req.body;
    const budgetRange = parseBudgetRange(profile.budget);
    const dataset = await loadDataset();

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

    const intentResult = await mockZaiExtractIntent(profile);
    const fitResult = await mockZaiFitEvaluation({
      profile,
      intent: intentResult.intent,
      candidates: candidatePool
    });

    const finalResult = await mockZaiFinalizeRanking({
      profile,
      intent: intentResult.intent,
      candidates: candidatePool,
      fitEvaluations: fitResult.evaluations
    });

    return res.json({
      top_recommendation: finalResult.top_recommendation,
      ranking: finalResult.ranking,
      ai_explanation: finalResult.ai_explanation,
      data_table: finalResult.full_ranked_table,
      business_intent: intentResult.intent,
      budget_filter: {
        min: budgetRange.min,
        max: Number.isFinite(budgetRange.max) ? budgetRange.max : null,
        used_fallback: viableLocations.length === 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to analyze locations.",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Z.AI SME Expansion Advisor backend running on port ${PORT}`);
});
