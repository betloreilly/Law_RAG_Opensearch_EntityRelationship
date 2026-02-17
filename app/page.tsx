"use client";

import { useState } from "react";
import { ExplainabilityPanel } from "./components/ExplainabilityPanel";
import { QueryAndScoresPanel } from "./components/QueryAndScoresPanel";
import { SearchTabs, type TabId } from "./components/SearchTabs";
import type { ExplainabilityData } from "./components/ExplainabilityPanel";

export default function Home() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("semantic");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [explainability, setExplainability] = useState<ExplainabilityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer("");
    setExplainability(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), strategy: tab }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setAnswer(data.answer ?? "");
      setExplainability(data.explainability ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: Explainability */}
      <aside className="w-80 flex-shrink-0 border-r border-slate-700 bg-slate-900/95 flex flex-col">
        <div className="flex-shrink-0 px-4 py-3 border-b border-slate-700">
          <h1 className="text-lg font-semibold text-slate-100">Law RAG</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            OpenSearch · Semantic · Hybrid · Graph
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <ExplainabilityPanel data={explainability} loading={loading} />
        </div>
      </aside>

      {/* Center: Search + Results */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-900 border-r border-slate-700">
        <div className="flex-shrink-0 p-4 border-b border-slate-700">
          <form onSubmit={handleSubmit} className="space-y-3">
            <SearchTabs active={tab} onChange={setTab} />
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. What damages were awarded in Martinez? Who reported to the EPA?"
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-5 py-2.5 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          {error && (
            <div className="rounded-lg bg-red-900/30 border border-red-700 text-red-200 px-4 py-3 mb-4">
              {error}
            </div>
          )}
          {answer && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Answer
              </h2>
              {explainability && (
                <p className="text-xs text-slate-500 mb-2">
                  Context sent to the model: {explainability.chunksUsed.length} chunk{explainability.chunksUsed.length !== 1 ? "s" : ""}
                  {explainability.relationshipsUsed && explainability.relationshipsUsed.length > 0
                    ? ` + ${explainability.entitiesUsed?.length ?? 0} entities + ${explainability.relationshipsUsed.length} relationships (graph)`
                    : " only (no graph — answers come only from chunk text)"}
                </p>
              )}
              <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-4 text-slate-200 whitespace-pre-wrap">
                {answer}
              </div>
            </section>
          )}
          {explainability && explainability.chunksUsed.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Source chunks ({explainability.chunksUsed.length})
              </h2>
              <ul className="space-y-3">
                {explainability.chunksUsed.map((chunk, i) => (
                  <li
                    key={chunk.element_id}
                    className="rounded-lg bg-slate-800/60 border border-slate-700 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                      <span className="font-mono text-sky-400">{chunk.element_id}</span>
                      <span>{chunk.filename}</span>
                      <span>p.{chunk.page_number ?? "?"}</span>
                    </div>
                    <p className="text-slate-300">{chunk.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!answer && !loading && !error && (
            <div className="text-slate-500 text-sm py-6 max-w-2xl mx-auto">
              <p className="text-slate-400 mb-3">Choose a retrieval mode and ask a question. Use <strong className="text-sky-400">Semantic + Graph</strong> for questions about <em>who is related to whom</em> or <em>what relationship</em> holds.</p>
              <p className="text-xs text-slate-500 mb-3">Try these to see the benefit of the graph (click to use):</p>
              <ul className="space-y-1.5 text-left">
                {[
                  "Which cases was Baker & Associates involved in?",
                  "Which cases was Jennifer Walsh involved in?",
                  "Which other cases was the law firm that represented Martinez in?",
                  "Which cases involved Pacific Medical Group?",
                  "Which cases did Judge Patricia Wong preside over?",
                  "Who was the plaintiff and defendant in Martinez?",
                ].map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => setQuery(q)}
                      className="text-sky-300 hover:text-sky-200 hover:underline text-left w-full py-0.5"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-slate-600 text-xs">Run <code className="bg-slate-800 px-1 rounded">source .venv/bin/activate && python scripts/ingest.py</code> first if the indices are empty.</p>
            </div>
          )}
        </div>
      </main>

      {/* Right: OpenSearch query JSON + scores */}
      <aside className="w-[420px] flex-shrink-0 bg-slate-900/95 flex flex-col">
        <div className="flex-1 min-h-0">
          <QueryAndScoresPanel
            openSearchQueries={explainability?.openSearchQueries ?? null}
            chunksUsed={explainability?.chunksUsed ?? []}
            entitiesUsed={explainability?.entitiesUsed}
            relationshipsUsed={explainability?.relationshipsUsed}
            loading={loading}
          />
        </div>
      </aside>
    </div>
  );
}
