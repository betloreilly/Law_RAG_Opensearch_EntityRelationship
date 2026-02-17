import { NextRequest, NextResponse } from "next/server";
import { runSearch } from "@/lib/search";
import type { SearchStrategy } from "@/lib/opensearch";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, strategy = "semantic" } = body as {
      query?: string;
      strategy?: SearchStrategy;
    };
    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'query'" },
        { status: 400 }
      );
    }
    const validStrategies: SearchStrategy[] = ["semantic", "hybrid", "semantic_graph"];
    const s = validStrategies.includes(strategy) ? strategy : "semantic";

    const { chunks, explain } = await runSearch(s, query);

    const contextParts: string[] = [];
    for (const h of chunks) {
      const src = h._source;
      contextParts.push(`[${src.filename} (p.${src.page_number ?? "?"})]\n${src.text}`);
    }
    if (explain.entitiesUsed?.length) {
      contextParts.push(
        "\n--- Entities ---\n" +
          explain.entitiesUsed.map(
            (e) => `- ${e.entity_name} (${e.entity_type})`
          ).join("\n")
      );
    }
    let relationshipsForContext = explain.relationshipsUsed ?? [];
    // When the question asks about a specific person/entity by name (e.g. "Which cases was Jennifer Walsh involved in?"),
    // only pass relationships where that entity is from or to, so we don't mix in another entity's cases (e.g. the law firm's).
    if (explain.strategy === "semantic_graph" && explain.questionEntityNames?.length && relationshipsForContext.length > 0) {
      const q = query.trim();
      let focusEntity: string | undefined;
      const match = q.match(/which (?:other )?cases (?:was|did) (.+?) (?:involved in|preside over|represent)/i)
        || q.match(/which (?:other )?cases (?:was|did) (.+?) \s+in\b/i);
      const focusPhrase = match?.[1]?.trim();
      // Exact match: "Jennifer Walsh" in question → use only her relationships
      if (focusPhrase && explain.questionEntityNames.includes(focusPhrase)) {
        focusEntity = focusPhrase;
      }
      // Fallback: longest entity name that appears verbatim in the question (e.g. "Jennifer Walsh")
      if (!focusEntity && /which (?:other )?cases (?:was|did) .+ (?:involved|preside)/i.test(q)) {
        const inQuestion = explain.questionEntityNames.filter((name) => q.includes(name));
        focusEntity = inQuestion.sort((a, b) => b.length - a.length)[0];
      }
      if (focusEntity) {
        relationshipsForContext = relationshipsForContext.filter(
          (r) => r.from_entity === focusEntity || r.to_entity === focusEntity
        );
      }
    }
    if (relationshipsForContext.length) {
      contextParts.push(
        "\n--- Relationships ---\n" +
          relationshipsForContext.map(
            (r) => `- ${r.from_entity} --[${r.relationship_type}]--> ${r.to_entity}`
          ).join("\n")
      );
    }
    const context = contextParts.join("\n\n");

    let answer = "";
    if (openai && context.trim()) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a legal research assistant. Answer the user's question using only the provided context from case law and legal documents. If the context does not contain enough information, say so. Be concise and cite the source (filename, page) when relevant. When the question asks which cases a specific person was involved in, list ONLY cases where that person appears in the Relationships as from_entity or to_entity. Do not attribute a case to that person because their employer or firm represented a party.",
          },
          {
            role: "user",
            content: `Context:\n${context.slice(0, 12000)}\n\nQuestion: ${query}\n\nAnswer:`,
          },
        ],
        max_tokens: 800,
      });
      answer = completion.choices[0]?.message?.content ?? "";
    } else {
      answer =
        "No OpenAI API key configured. Retrieval completed; enable OPENAI_API_KEY for RAG answers.";
    }

    return NextResponse.json({
      answer,
      explainability: explain,
      chunkCount: chunks.length,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed" },
      { status: 500 }
    );
  }
}
