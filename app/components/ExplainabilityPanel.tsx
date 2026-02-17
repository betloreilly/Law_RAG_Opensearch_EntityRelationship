"use client";

export interface RetrievalStep {
  step: string;
  index: string;
  queryType: string;
  queryDescription?: string;
  hitCount: number;
  ids?: string[];
}

export interface ExplainabilityData {
  strategy: string;
  steps: RetrievalStep[];
  chunksUsed: { element_id: string; text: string; filename: string; page_number?: number; entity_names?: string[]; score?: number }[];
  entitiesUsed?: { entity_name: string; entity_type: string; source_text_snippet?: string; filename?: string; score?: number }[];
  relationshipsUsed?: { from_entity: string; to_entity: string; relationship_type: string; filename?: string; score?: number }[];
  questionEntityNames?: string[];
  openSearchQueries?: { step: string; index: string; queryJson: Record<string, unknown> }[];
}

interface Props {
  data: ExplainabilityData | null;
  loading: boolean;
}

export function ExplainabilityPanel({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <span className="animate-pulse">Retrieving…</span>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-full flex flex-col justify-center text-slate-500 text-sm px-4">
        <p className="font-medium text-slate-400 mb-2">How retrieval works</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><strong>Semantic:</strong> k-NN on chunk embeddings only.</li>
          <li><strong>Hybrid:</strong> keyword match + k-NN, then merged and ranked.</li>
          <li><strong>Semantic + Graph:</strong> k-NN chunks → entities from chunk names → relationships for those entities.</li>
        </ul>
        <p className="mt-4 text-xs">Run a query to see OpenSearch steps and retrieved data here.</p>
      </div>
    );
  }

  const strategyLabels: Record<string, string> = {
    semantic: "Semantic only",
    hybrid: "Hybrid (keyword + vector)",
    semantic_graph: "Semantic + Graph relations",
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-slate-700 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-200">Retrieval explainability</h2>
        <p className="text-xs text-sky-400 mt-0.5">{strategyLabels[data.strategy] ?? data.strategy}</p>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-4">
        {/* Steps */}
        <section>
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">OpenSearch steps</h3>
          <ul className="space-y-2">
            {data.steps.map((s, i) => (
              <li key={i} className="rounded-md bg-slate-800/80 border border-slate-700 p-2 text-xs">
                <div className="font-medium text-slate-200">{s.step}</div>
                <div className="mt-1 text-slate-400">
                  Index: <code className="text-sky-300">{s.index}</code> · {s.queryType}
                </div>
                {s.queryDescription && (
                  <div className="mt-1 text-slate-500 truncate" title={s.queryDescription}>
                    {s.queryDescription}
                  </div>
                )}
                <div className="mt-1 text-slate-500">Hits: {s.hitCount}</div>
                {s.ids && s.ids.length > 0 && (
                  <div className="mt-1 text-slate-600 truncate">
                    IDs: {s.ids.slice(0, 3).join(", ")}{s.ids.length > 3 ? "…" : ""}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Chunks used */}
        <section>
          <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Chunks used ({data.chunksUsed.length})</h3>
          <ul className="space-y-2">
            {data.chunksUsed.slice(0, 5).map((c, i) => (
              <li key={i} className="rounded-md bg-slate-800/60 border border-slate-700/80 p-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-sky-300 font-mono">{c.element_id}</span>
                  {c.score != null && <span className="text-slate-500 tabular-nums">score: {c.score.toFixed(4)}</span>}
                </div>
                <div className="text-slate-500 mt-0.5">{c.filename} · p.{c.page_number ?? "?"}</div>
                <p className="mt-1 text-slate-400 line-clamp-3">{c.text}</p>
                {c.entity_names && c.entity_names.length > 0 && (
                  <div className="mt-1 text-slate-600">Entities: {c.entity_names.slice(0, 4).join(", ")}{c.entity_names.length > 4 ? "…" : ""}</div>
                )}
              </li>
            ))}
            {data.chunksUsed.length > 5 && (
              <li className="text-slate-500 text-xs">+{data.chunksUsed.length - 5} more chunks</li>
            )}
          </ul>
        </section>

        {/* Entities (semantic_graph) */}
        {data.entitiesUsed && data.entitiesUsed.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Entities from graph ({data.entitiesUsed.length})</h3>
            <ul className="space-y-1 text-xs">
              {data.entitiesUsed.slice(0, 10).map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-slate-300">{e.entity_name}</span>
                  <span className="text-slate-500">({e.entity_type})</span>
                </li>
              ))}
              {data.entitiesUsed.length > 10 && (
                <li className="text-slate-500">+{data.entitiesUsed.length - 10} more</li>
              )}
            </ul>
          </section>
        )}

        {/* Relationships (semantic_graph) */}
        {data.relationshipsUsed && data.relationshipsUsed.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Relationships ({data.relationshipsUsed.length})</h3>
            <ul className="space-y-1 text-xs font-mono">
              {data.relationshipsUsed.slice(0, 8).map((r, i) => (
                <li key={i} className="text-slate-400">
                  {r.from_entity} <span className="text-sky-400">—{r.relationship_type}—</span> {r.to_entity}
                </li>
              ))}
              {data.relationshipsUsed.length > 8 && (
                <li className="text-slate-500">+{data.relationshipsUsed.length - 8} more</li>
              )}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
