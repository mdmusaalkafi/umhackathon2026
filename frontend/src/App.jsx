import { useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

const BUSINESS_TYPES = [
  "Cafe",
  "Restaurant",
  "Bakery",
  "Retail Boutique",
  "Co-working Space",
  "Wellness Studio",
  "Mini Mart"
];

const BUDGET_OPTIONS = [
  "RM5,000 - RM10,000",
  "RM10,001 - RM20,000",
  "RM20,001 - RM35,000",
  "RM35,001 - RM60,000",
  "RM60,001 - RM100,000"
];

const TARGET_MARKETS = [
  "University Students",
  "Office Workers",
  "Families",
  "Tourists",
  "Commuters",
  "Expats"
];

const POSITIONING_OPTIONS = ["Budget/Affordable", "Mid-range", "Premium"];

const INITIAL_FORM = {
  business_type: "Cafe",
  budget: "RM5,000 - RM10,000",
  target_market: "University Students",
  positioning: "Budget/Affordable",
  description:
    "I want to open a budget-friendly cafe near universities for students who study at night and depend on walk-in traffic."
};

const money = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  maximumFractionDigits: 0
});

function formatMoney(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return money.format(value);
}

function Field({ label, name, value, onChange, as = "select", options = [], rows = 5 }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {as === "textarea" ? (
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
          name={name}
          value={value}
          onChange={onChange}
          rows={rows}
          required
        />
      ) : (
        <select
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
          name={name}
          value={value}
          onChange={onChange}
          required
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

function App() {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");

  const hasResults = Boolean(results?.ranking?.length);
  const tableRows = useMemo(() => results?.data_table ?? [], [results]);

  const onChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onAnalyze = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formData)
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to analyze locations at this time.");
      }

      setResults(payload);
    } catch (requestError) {
      setResults(null);
      setError(requestError.message || "Unexpected error while running analysis.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-slate-900">
      <div className="pointer-events-none absolute -left-16 top-24 h-56 w-56 rounded-full bg-cyan-300/30 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 animate-float rounded-full bg-amber-300/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/3 h-64 w-64 rounded-full bg-sky-300/20 blur-3xl" />

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <header className="mb-8 space-y-4 animate-reveal">
          <p className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
            Domain 2: Decision Intelligence
          </p>
          <h1 className="font-display text-3xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
            Z.AI SME Expansion Advisor
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-700 sm:text-base">
            A hybrid recommendation engine that combines deterministic RM revenue-cost-profit scoring with
            context-aware AI fit ranking, producing explainable expansion decisions for Malaysian SMEs.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)]">
          <form onSubmit={onAnalyze} className="glass-panel space-y-5 p-5 sm:p-6">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">Input Form</h2>
              <p className="mt-1 text-sm text-slate-600">
                Complete the 5 required fields. The backend will process this payload using the strict
                schema contract.
              </p>
            </div>

            <Field
              label="Business Type"
              name="business_type"
              value={formData.business_type}
              onChange={onChange}
              options={BUSINESS_TYPES}
            />

            <Field
              label="Budget"
              name="budget"
              value={formData.budget}
              onChange={onChange}
              options={BUDGET_OPTIONS}
            />

            <Field
              label="Target Market"
              name="target_market"
              value={formData.target_market}
              onChange={onChange}
              options={TARGET_MARKETS}
            />

            <Field
              label="Positioning"
              name="positioning"
              value={formData.positioning}
              onChange={onChange}
              options={POSITIONING_OPTIONS}
            />

            <Field
              label="Description"
              name="description"
              value={formData.description}
              onChange={onChange}
              as="textarea"
              rows={7}
            />

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Include context such as: who your customers are, when traffic peaks, walk-in vs destination,
              and special requirements like near universities, malls, or offices.
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Analyzing...
                </>
              ) : (
                "Analyze Locations"
              )}
            </button>
          </form>

          <div className="space-y-6">
            {!hasResults ? (
              <section className="glass-panel flex min-h-[380px] flex-col justify-between p-6">
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">Results Dashboard</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Submit the form to see the Top Recommendation, ranked locations, explainability panel,
                    and transparent decision table.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900">
                    Quantifiable RM impact
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    Context-aware AI fit
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Explainable ranking
                  </div>
                </div>
              </section>
            ) : (
              <>
                <section className="glass-panel animate-reveal space-y-4 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
                        Top Recommendation
                      </p>
                      <h2 className="mt-1 font-display text-2xl font-extrabold text-slate-900">
                        {results.top_recommendation.name}
                      </h2>
                      <p className="text-sm text-slate-600">{results.top_recommendation.state}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                        Estimated Profit
                      </p>
                      <p className="mt-1 text-xl font-bold text-emerald-800">
                        {formatMoney(results.top_recommendation.profit)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="metric-chip">Fit Score: {results.top_recommendation.fit_score}</span>
                    <span className="metric-chip">Final Score: {results.top_recommendation.final_score}</span>
                    <span className="metric-chip">Budget Max: {formatMoney(results.budget_filter.max)}</span>
                  </div>
                </section>

                <section className="glass-panel animate-reveal p-6" style={{ animationDelay: "120ms" }}>
                  <h3 className="font-display text-lg font-bold text-slate-900">Top 5 Ranked Locations</h3>
                  <div className="mt-4 space-y-3">
                    {results.ranking.map((item) => (
                      <article
                        key={item.name}
                        className="rounded-xl border border-slate-200 bg-white/80 p-4 transition hover:border-cyan-300"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Rank #{item.rank}
                            </p>
                            <h4 className="text-base font-bold text-slate-900">{item.name}</h4>
                            <p className="text-xs text-slate-600">{item.state}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-slate-700">{formatMoney(item.estimated_profit)}</p>
                            <p className="text-xs text-slate-500">Fit {item.fit_score} | Final {item.final_score}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-slate-600">{item.ai_fit_explanation}</p>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="glass-panel animate-reveal p-6" style={{ animationDelay: "180ms" }}>
                  <h3 className="font-display text-lg font-bold text-slate-900">AI Explanation Panel</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-700">{results.ai_explanation}</p>
                </section>

                <section className="glass-panel animate-reveal p-6" style={{ animationDelay: "240ms" }}>
                  <h3 className="font-display text-lg font-bold text-slate-900">Transparent Data Table</h3>
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2 text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="px-2 py-1 font-semibold">Location</th>
                          <th className="px-2 py-1 font-semibold">Rent</th>
                          <th className="px-2 py-1 font-semibold">Demand</th>
                          <th className="px-2 py-1 font-semibold">Competition</th>
                          <th className="px-2 py-1 font-semibold">Revenue</th>
                          <th className="px-2 py-1 font-semibold">Cost</th>
                          <th className="px-2 py-1 font-semibold">Profit</th>
                          <th className="px-2 py-1 font-semibold">Fit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row) => (
                          <tr key={row.name} className="rounded-xl bg-white/80 text-slate-700">
                            <td className="rounded-l-lg px-2 py-2 font-semibold text-slate-900">{row.name}</td>
                            <td className="px-2 py-2 uppercase">{row.rent_level}</td>
                            <td className="px-2 py-2 uppercase">{row.demand_level}</td>
                            <td className="px-2 py-2 uppercase">{row.competition_level}</td>
                            <td className="px-2 py-2">{formatMoney(row.estimated_revenue)}</td>
                            <td className="px-2 py-2">{formatMoney(row.estimated_cost)}</td>
                            <td className="px-2 py-2 font-semibold text-emerald-700">
                              {formatMoney(row.estimated_profit)}
                            </td>
                            <td className="rounded-r-lg px-2 py-2">{row.fit_score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
