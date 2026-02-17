import {
  opensearchClient,
  LAW_INDICES,
  type SearchStrategy,
  type ChunkHit,
  type EntityHit,
  type RelationshipHit,
  type ExplainabilityData,
  type RetrievalStep,
} from "./opensearch";
import { getEmbedding } from "./embedding";

/** Keep low (e.g. 3–4) so semantic-only has limited context and entity/graph clearly adds value on "which cases was X in?" */
const K_CHUNKS = 3;
const K_ENTITIES = 15;
const K_RELATIONSHIPS = 20;
/** Only use entity names from the top N chunks for graph expansion, so relationships stay relevant to the question. */
const TOP_CHUNKS_FOR_GRAPH = 3;

/** For display: replace long vector array with a placeholder in query JSON */
function queryJsonForDisplay(body: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const q = out.query as Record<string, unknown>;
  if (q?.knn) {
    const knn = q.knn as Record<string, unknown>;
    const te = knn.text_embedding as Record<string, unknown>;
    if (Array.isArray(te?.vector)) {
      te.vector = `[embedding, ${(te.vector as unknown[]).length} dims]`;
    }
  }
  return out;
}

/** Semantic only: k-NN on law_chunks by query embedding */
export async function semanticSearch(
  query: string
): Promise<{ chunks: ChunkHit[]; explain: ExplainabilityData }> {
  const embedding = await getEmbedding(query);
  const body = {
    size: K_CHUNKS,
    query: {
      knn: {
        text_embedding: {
          vector: embedding,
          k: K_CHUNKS,
        },
      },
    },
    _source: ["element_id", "text", "filename", "page_number", "entity_names"],
  };
  const res = await opensearchClient.search({
    index: LAW_INDICES.chunks,
    body,
  });

  const hits = (res.body.hits?.hits ?? []) as ChunkHit[];
  const steps: RetrievalStep[] = [
    {
      step: "Vector (k-NN) search on chunks",
      index: LAW_INDICES.chunks,
      queryType: "knn",
      queryDescription: "Similarity search using query embedding",
      hitCount: hits.length,
      ids: hits.map((h) => h._id),
    },
  ];

  return {
    chunks: hits,
    explain: {
      strategy: "semantic",
      steps,
      chunksUsed: hits.map((h) => ({ ...h._source, score: h._score })),
      openSearchQueries: [
        { step: steps[0].step, index: LAW_INDICES.chunks, queryJson: queryJsonForDisplay(body) },
      ],
    },
  };
}

/** Hybrid: combine keyword (match on text) and vector (k-NN); merge and dedupe by _id */
export async function hybridSearch(
  query: string
): Promise<{ chunks: ChunkHit[]; explain: ExplainabilityData }> {
  const embedding = await getEmbedding(query);

  const keywordBody = {
    size: K_CHUNKS,
    query: {
      match: {
        text: { query, operator: "or", fuzziness: "AUTO" },
      },
    },
    _source: ["element_id", "text", "filename", "page_number", "entity_names"],
  };
  const vectorBody = {
    size: K_CHUNKS,
    query: {
      knn: {
        text_embedding: { vector: embedding, k: K_CHUNKS },
      },
    },
    _source: ["element_id", "text", "filename", "page_number", "entity_names"],
  };
  const [keywordRes, vectorRes] = await Promise.all([
    opensearchClient.search({ index: LAW_INDICES.chunks, body: keywordBody }),
    opensearchClient.search({ index: LAW_INDICES.chunks, body: vectorBody }),
  ]);

  const keywordHits = (keywordRes.body.hits?.hits ?? []) as ChunkHit[];
  const vectorHits = (vectorRes.body.hits?.hits ?? []) as ChunkHit[];

  const seen = new Set<string>();
  const merged: ChunkHit[] = [];
  const scores = new Map<string, number>();
  for (const h of keywordHits) {
    seen.add(h._id);
    merged.push(h);
    scores.set(h._id, (h._score ?? 0) * 0.5);
  }
  for (const h of vectorHits) {
    if (!seen.has(h._id)) {
      seen.add(h._id);
      merged.push(h);
      scores.set(h._id, (h._score ?? 0) * 0.5);
    } else {
      scores.set(h._id, (scores.get(h._id) ?? 0) + (h._score ?? 0) * 0.5);
    }
  }
  merged.sort((a, b) => (scores.get(b._id) ?? 0) - (scores.get(a._id) ?? 0));
  const topChunks = merged.slice(0, K_CHUNKS);

  const steps: RetrievalStep[] = [
    {
      step: "Keyword search (match on text)",
      index: LAW_INDICES.chunks,
      queryType: "match",
      queryDescription: `"${query}" with fuzziness`,
      hitCount: keywordHits.length,
      ids: keywordHits.map((h) => h._id),
    },
    {
      step: "Vector (k-NN) search on chunks",
      index: LAW_INDICES.chunks,
      queryType: "knn",
      queryDescription: "Similarity search using query embedding",
      hitCount: vectorHits.length,
      ids: vectorHits.map((h) => h._id),
    },
    {
      step: "Merge and rank (reciprocal rank fusion)",
      index: "-",
      queryType: "application",
      hitCount: topChunks.length,
      ids: topChunks.map((h) => h._id),
    },
  ];

  const chunksWithScores = topChunks.map((h) => ({
    ...h._source,
    score: scores.get(h._id),
  }));

  return {
    chunks: topChunks,
    explain: {
      strategy: "hybrid",
      steps,
      chunksUsed: chunksWithScores,
      openSearchQueries: [
        { step: steps[0].step, index: LAW_INDICES.chunks, queryJson: keywordBody },
        { step: steps[1].step, index: LAW_INDICES.chunks, queryJson: queryJsonForDisplay(vectorBody) },
      ],
    },
  };
}

/** Extract significant tokens from question text for entity matching (e.g. "California" from "Which cases were governed by California law?") */
function questionTokens(query: string, minLength = 2, maxTokens = 15): string[] {
  const stop = new Set(["which", "what", "who", "where", "when", "how", "were", "was", "the", "and", "for", "that", "this", "from", "with", "about", "into", "cases", "case"]);
  const tokens = query
    .split(/\W+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= minLength && !stop.has(t.toLowerCase()));
  return [...new Set(tokens)].slice(0, maxTokens);
}

/** Semantic + graph: (1) find entities in the question, (2) get top chunks, (3) merge entity sets, (4) fetch relationships for focused entities */
export async function semanticGraphSearch(
  query: string
): Promise<{ chunks: ChunkHit[]; explain: ExplainabilityData }> {
  const embedding = await getEmbedding(query);
  const tokens = questionTokens(query);

  // Step 1: Find entities whose names appear in the question (e.g. "California" → entity "California", "California Civil Code Section 3333.2")
  const questionEntityNames = new Set<string>();
  let questionEntitiesStep: RetrievalStep | null = null;
  const openSearchQueries: { step: string; index: string; queryJson: Record<string, unknown> }[] = [];

  if (tokens.length > 0) {
    // Escape wildcard special chars (* ? \) in token so we only do prefix/suffix match
    const escape = (s: string) => s.replace(/[\\*?]/g, "\\$&");
    const shouldClauses = tokens.map((t) => ({
      wildcard: { entity_name: { value: `*${escape(t)}*`, case_insensitive: true } },
    }));
    const questionEntityBody = {
      size: K_ENTITIES,
      query: { bool: { should: shouldClauses, minimum_should_match: 1 } },
      _source: ["entity_name"],
    };
    const questionEntityRes = await opensearchClient.search({
      index: LAW_INDICES.entities,
      body: questionEntityBody,
    });
    const qHits = (questionEntityRes.body.hits?.hits ?? []) as { _source: { entity_name: string } }[];
    qHits.forEach((h) => questionEntityNames.add(h._source.entity_name));
    questionEntitiesStep = {
      step: "Graph: entities in the question",
      index: LAW_INDICES.entities,
      queryType: "wildcard (question tokens)",
      queryDescription: `Match question words to entity names so we can fetch relationships for the right entity. Tokens: [${tokens.slice(0, 8).join(", ")}${tokens.length > 8 ? "…" : ""}] → ${questionEntityNames.size} entities`,
      hitCount: questionEntityNames.size,
      ids: qHits.map((h) => h._source.entity_name),
    };
    openSearchQueries.push({
      step: questionEntitiesStep.step,
      index: LAW_INDICES.entities,
      queryJson: questionEntityBody,
    });
  }

  // Step 2: k-NN on chunks
  const chunkBody = {
    size: K_CHUNKS,
    query: {
      knn: {
        text_embedding: { vector: embedding, k: K_CHUNKS },
      },
    },
    _source: ["element_id", "text", "filename", "page_number", "entity_names"],
  };
  const chunkRes = await opensearchClient.search({
    index: LAW_INDICES.chunks,
    body: chunkBody,
  });
  const chunkHits = (chunkRes.body.hits?.hits ?? []) as ChunkHit[];
  const topChunksForGraph = chunkHits.slice(0, TOP_CHUNKS_FOR_GRAPH);
  const chunkEntityNames = new Set<string>();
  for (const h of topChunksForGraph) {
    (h._source.entity_names ?? []).forEach((n) => chunkEntityNames.add(n));
  }

  // Merge: question entities first (focus), then entities from top chunks (context)
  const entityNames = new Set<string>([...questionEntityNames, ...chunkEntityNames]);

  const steps: RetrievalStep[] = [
    {
      step: "Vector (k-NN) search on chunks",
      index: LAW_INDICES.chunks,
      queryType: "knn",
      queryDescription: "Similarity search using query embedding",
      hitCount: chunkHits.length,
      ids: chunkHits.map((h) => h._id),
    },
  ];
  if (questionEntitiesStep) steps.push(questionEntitiesStep);

  let entityHits: EntityHit[] = [];
  let relationshipHits: RelationshipHit[] = [];

  const entityBody = {
    size: K_ENTITIES,
    query: { terms: { entity_name: Array.from(entityNames) } },
    _source: ["entity_id", "entity_name", "entity_type", "source_text_snippet", "filename"],
  };
  const relBody = {
    size: K_RELATIONSHIPS,
    query: {
      bool: {
        should: [
          { terms: { from_entity: Array.from(entityNames) } },
          { terms: { to_entity: Array.from(entityNames) } },
        ],
        minimum_should_match: 1,
      },
    },
    _source: ["from_entity", "to_entity", "relationship_type", "source_text_snippet", "filename"],
  };

  openSearchQueries.push({ step: steps[0].step, index: LAW_INDICES.chunks, queryJson: queryJsonForDisplay(chunkBody) });

  if (entityNames.size > 0) {
    const entityRes = await opensearchClient.search({
      index: LAW_INDICES.entities,
      body: entityBody,
    });
    entityHits = (entityRes.body.hits?.hits ?? []) as EntityHit[];
    steps.push({
      step: "Graph: entities (question + top chunks)",
      index: LAW_INDICES.entities,
      queryType: "terms",
      queryDescription: `${questionEntityNames.size} from question + ${chunkEntityNames.size} from top ${TOP_CHUNKS_FOR_GRAPH} chunks`,
      hitCount: entityHits.length,
      ids: entityHits.map((h) => h._id),
    });
    openSearchQueries.push({ step: steps[steps.length - 1].step, index: LAW_INDICES.entities, queryJson: entityBody });

    const relRes = await opensearchClient.search({
      index: LAW_INDICES.relationships,
      body: relBody,
    });
    relationshipHits = (relRes.body.hits?.hits ?? []) as RelationshipHit[];
    steps.push({
      step: "Graph: relationships for those entities",
      index: LAW_INDICES.relationships,
      queryType: "bool (from_entity/to_entity)",
      queryDescription: `Relationships for ${entityNames.size} focused entities`,
      hitCount: relationshipHits.length,
      ids: relationshipHits.map((h) => h._id),
    });
    openSearchQueries.push({ step: steps[steps.length - 1].step, index: LAW_INDICES.relationships, queryJson: relBody });

    // 2-hop: add entities that appear in these relationships (e.g. "Baker & Associates" from case → represented_by), then fetch their relationships (e.g. other cases the firm is in)
    const hop2EntityNames = new Set<string>();
    for (const h of relationshipHits) {
      const src = h._source;
      if (src.from_entity) hop2EntityNames.add(src.from_entity);
      if (src.to_entity) hop2EntityNames.add(src.to_entity);
    }
    const newForHop2 = [...hop2EntityNames].filter((n) => !entityNames.has(n));
    if (newForHop2.length > 0) {
      const hop2RelBody = {
        size: K_RELATIONSHIPS,
        query: {
          bool: {
            should: [
              { terms: { from_entity: newForHop2 } },
              { terms: { to_entity: newForHop2 } },
            ],
            minimum_should_match: 1,
          },
        },
        _source: ["from_entity", "to_entity", "relationship_type", "source_text_snippet", "filename"],
      };
      const relRes2 = await opensearchClient.search({
        index: LAW_INDICES.relationships,
        body: hop2RelBody,
      });
      const hop2Hits = (relRes2.body.hits?.hits ?? []) as RelationshipHit[];
      const seenRelKeys = new Set(relationshipHits.map((h) => `${h._source.from_entity}|${h._source.relationship_type}|${h._source.to_entity}`));
      for (const h of hop2Hits) {
        const key = `${h._source.from_entity}|${h._source.relationship_type}|${h._source.to_entity}`;
        if (!seenRelKeys.has(key)) {
          seenRelKeys.add(key);
          relationshipHits.push(h);
        }
      }
      steps.push({
        step: "Graph: 2-hop relationships (entities from first hop)",
        index: LAW_INDICES.relationships,
        queryType: "bool (from_entity/to_entity)",
        queryDescription: `Relationships for ${newForHop2.length} entities found in first hop (e.g. law firm → other cases)`,
        hitCount: hop2Hits.length,
        ids: hop2Hits.map((h) => h._id),
      });
      openSearchQueries.push({ step: steps[steps.length - 1].step, index: LAW_INDICES.relationships, queryJson: hop2RelBody });
    }
  }

  return {
    chunks: chunkHits,
    explain: {
      strategy: "semantic_graph",
      steps,
      chunksUsed: chunkHits.map((h) => ({ ...h._source, score: h._score })),
      entitiesUsed: entityHits.map((h) => ({ ...h._source, score: (h as EntityHit & { _score?: number })._score })),
      relationshipsUsed: relationshipHits.map((h) => ({ ...h._source, score: (h as RelationshipHit & { _score?: number })._score })),
      questionEntityNames: questionEntityNames.size > 0 ? Array.from(questionEntityNames) : undefined,
      openSearchQueries,
    },
  };
}

export async function runSearch(
  strategy: SearchStrategy,
  query: string
): Promise<{ chunks: ChunkHit[]; explain: ExplainabilityData }> {
  switch (strategy) {
    case "semantic":
      return semanticSearch(query);
    case "hybrid":
      return hybridSearch(query);
    case "semantic_graph":
      return semanticGraphSearch(query);
    default:
      return semanticSearch(query);
  }
}
