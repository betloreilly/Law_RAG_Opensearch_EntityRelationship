import { Client } from "@opensearch-project/opensearch";

// Support both .env.example names and managed-instance names (OPENSEARCH_URL, OPENSEARCH_USERNAME)
const node =
  process.env.OPENSEARCH_URL ||
  process.env.OPENSEARCH_NODE ||
  "https://localhost:9200";
const username =
  process.env.OPENSEARCH_USERNAME || process.env.OPENSEARCH_USER;
const password = process.env.OPENSEARCH_PASSWORD;

const auth =
  username && password
    ? { username, password }
    : undefined;

// Strip trailing slash; if OPENSEARCH_USE_HTTP=true, force http:// (fixes "wrong version number"
// when the API on :9200 is plain HTTP while the dashboard is HTTPS).
const useHttpApi = process.env.OPENSEARCH_USE_HTTP === "true";
let nodeUrl = node.replace(/\/$/, "");
if (useHttpApi && nodeUrl.startsWith("https://")) {
  nodeUrl = "http://" + nodeUrl.slice(8);
}
const useHttps = nodeUrl.startsWith("https://");
const insecure = process.env.OPENSEARCH_INSECURE === "true";

const ssl =
  useHttps
    ? {
        ...(insecure ? { rejectUnauthorized: false } : {}),
        minVersion: "TLSv1.2" as const,
        maxVersion: "TLSv1.3" as const,
      }
    : undefined;

export const opensearchClient = new Client({
  node: nodeUrl,
  auth,
  ...(ssl ? { ssl } : {}),
});

export const LAW_INDICES = {
  chunks: "law_chunks",
  entities: "law_entities",
  relationships: "law_relationships",
} as const;

export type SearchStrategy = "semantic" | "hybrid" | "semantic_graph";

export interface ChunkHit {
  _id: string;
  _source: {
    element_id: string;
    text: string;
    filename: string;
    page_number?: number;
    entity_names?: string[];
    text_embedding?: number[];
  };
  _score?: number;
}

export interface EntityHit {
  _id: string;
  _source: {
    entity_id: string;
    entity_name: string;
    entity_type: string;
    source_text_snippet?: string;
    filename?: string;
  };
}

export interface RelationshipHit {
  _id: string;
  _source: {
    from_entity: string;
    to_entity: string;
    relationship_type: string;
    source_text_snippet?: string;
    filename?: string;
  };
}

export interface RetrievalStep {
  step: string;
  index: string;
  queryType: string;
  queryDescription?: string;
  hitCount: number;
  highlights?: string[];
  ids?: string[];
}

export interface OpenSearchQueryStep {
  step: string;
  index: string;
  queryJson: Record<string, unknown>;
}

export interface ExplainabilityData {
  strategy: SearchStrategy;
  steps: RetrievalStep[];
  chunksUsed: (ChunkHit["_source"] & { score?: number })[];
  entitiesUsed?: (EntityHit["_source"] & { score?: number })[];
  relationshipsUsed?: (RelationshipHit["_source"] & { score?: number })[];
  /** Entity names matched from the question (Semantic + Graph). Used to filter relationships so answers stay about the asked-about entity. */
  questionEntityNames?: string[];
  openSearchQueries?: OpenSearchQueryStep[];
}
