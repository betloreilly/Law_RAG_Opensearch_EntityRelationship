"use client";

export interface OpenSearchQueryStep {
  step: string;
  index: string;
  queryJson: Record<string, unknown>;
}

export interface ChunkWithScore {
  element_id: string;
  text: string;
  filename: string;
  page_number?: number;
  entity_names?: string[];
  score?: number;
}

export interface EntityWithScore {
  entity_name: string;
  entity_type: string;
  source_text_snippet?: string;
  filename?: string;
  score?: number;
}

export interface RelationshipWithScore {
  from_entity: string;
  to_entity: string;
  relationship_type: string;
  filename?: string;
  score?: number;
}

interface Props {
  openSearchQueries: OpenSearchQueryStep[] | null;
  chunksUsed: ChunkWithScore[];
  entitiesUsed?: EntityWithScore[];
  relationshipsUsed?: RelationshipWithScore[];
  loading: boolean;
}

export function QueryAndScoresPanel({
  openSearchQueries,
  chunksUsed,
  entitiesUsed = [],
  relationshipsUsed = [],
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <span className="animate-pulse">Loading…</span>
      </div>
    );
  }
  if (!openSearchQueries?.length && !chunksUsed.length) {
    return (
      <div className="h-full flex flex-col justify-center text-slate-500 text-sm px-4">
        <p className="font-medium text-slate-400 mb-2">OpenSearch query & scores</p>
        <p className="text-xs">Run a search to see the exact query JSON and relevance scores here.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-slate-700 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-200">Query & scores</h2>
        <p className="text-xs text-slate-500 mt-0.5">JSON query and hit scores</p>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-4">
        {/* OpenSearch query JSON */}
        {openSearchQueries && openSearchQueries.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
              OpenSearch query (JSON)
            </h3>
            <div className="space-y-3">
              {openSearchQueries.map((q, i) => (
                <div key={i} className="rounded-md bg-slate-800/80 border border-slate-700 overflow-hidden">
                  <div className="px-2 py-1 bg-slate-700/50 text-xs text-sky-300 font-mono">
                    {q.index} — {q.step}
                  </div>
                  <pre className="p-2 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono break-all">
                    {JSON.stringify(q.queryJson, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scores: chunks */}
        {chunksUsed.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
              Chunk scores ({chunksUsed.length})
            </h3>
            <div className="rounded-md border border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-left">
                    <th className="px-2 py-1.5 font-medium">ID</th>
                    <th className="px-2 py-1.5 font-medium">Filename</th>
                    <th className="px-2 py-1.5 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {chunksUsed.map((c, i) => (
                    <tr key={i} className="border-t border-slate-700/80">
                      <td className="px-2 py-1.5 font-mono text-sky-300">{c.element_id}</td>
                      <td className="px-2 py-1.5 truncate max-w-[120px]" title={c.filename}>
                        {c.filename}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {c.score != null ? c.score.toFixed(4) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Scores: entities (semantic_graph) */}
        {entitiesUsed && entitiesUsed.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
              Entity scores ({entitiesUsed.length})
            </h3>
            <div className="rounded-md border border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-left">
                    <th className="px-2 py-1.5 font-medium">Entity</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {entitiesUsed.slice(0, 15).map((e, i) => (
                    <tr key={i} className="border-t border-slate-700/80">
                      <td className="px-2 py-1.5 truncate max-w-[140px]" title={e.entity_name}>
                        {e.entity_name}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{e.entity_type}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {e.score != null ? e.score.toFixed(4) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entitiesUsed.length > 15 && (
                <div className="px-2 py-1 text-slate-500 text-xs">+{entitiesUsed.length - 15} more</div>
              )}
            </div>
          </section>
        )}

        {/* Scores: relationships (semantic_graph) */}
        {relationshipsUsed && relationshipsUsed.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
              Relationship scores ({relationshipsUsed.length})
            </h3>
            <div className="rounded-md border border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-left">
                    <th className="px-2 py-1.5 font-medium">From → To</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {relationshipsUsed.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-slate-700/80">
                      <td className="px-2 py-1.5 font-mono truncate max-w-[180px]" title={`${r.from_entity} → ${r.to_entity}`}>
                        {r.from_entity} → {r.to_entity}
                      </td>
                      <td className="px-2 py-1.5 text-sky-400">{r.relationship_type}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.score != null ? r.score.toFixed(4) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {relationshipsUsed.length > 10 && (
                <div className="px-2 py-1 text-slate-500 text-xs">+{relationshipsUsed.length - 10} more</div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
