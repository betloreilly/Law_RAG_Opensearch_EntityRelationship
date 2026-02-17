"use client";

export type TabId = "semantic" | "hybrid" | "semantic_graph";

const TABS: { id: TabId; label: string; description: string }[] = [
  { id: "semantic", label: "Semantic only", description: "Vector (k-NN) search on chunk embeddings" },
  { id: "hybrid", label: "Hybrid", description: "Keyword + vector search, merged and ranked" },
  { id: "semantic_graph", label: "Semantic + Graph", description: "Vector search + entity & relationship graph" },
];

interface Props {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function SearchTabs({ active, onChange }: Props) {
  return (
    <div className="flex gap-1 p-1 rounded-lg bg-slate-800/80 border border-slate-700">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            active === tab.id
              ? "bg-sky-600 text-white shadow"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
          }`}
          title={tab.description}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export { TABS };
