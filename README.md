# Law RAG: OpenSearch Semantic, Hybrid & Graph

## Business context

Legal and compliance teams need answers across many documents: which cases involved a firm or defendant, which court decided, what was the outcome, how entities relate. Keyword search returns isolated passages. Semantic search over chunks answers "what does this paragraph say?" but fails when the answer is structural (who is related to whom, or which cases share the same court, lawyer, or governing law).

This demo is a **RAG** application on OpenSearch that combines **semantic search**, **hybrid search** (keyword + vector), and **entity/relationship graph retrieval**, with **explainability** so users can see what was retrieved and compare strategies. Aimed at solution architects and developers evaluating RAG where entities and relationships matter as much as text.

## What this solution delivers

**Next.js (TypeScript)** RAG app with explainable retrieval from OpenSearch. The UI:

- **Tabs:** Semantic only (vector), Hybrid (keyword + vector), Semantic + Graph (vector + entity/relationship graph).
- **Main area:** Search input, RAG answer, and source chunks.
- **Right panel:** How data was retrieved (indices, query types, chunks, entities, relationships).

![Demo of Law RAG app user interface](law_rag.gif)

## Prerequisites

- Node 18+ (Next.js app)
- Python 3.9+ (ingestion script)
- OpenSearch (local or managed) with indices created by the ingest script
- OpenAI API key (embeddings and chat)

## Setup

**Option A: use the setup script (recommended)**

```bash
cd law-rag-app
./setup.sh
```

Checks Node 18+ and Python 3, installs npm and ingest dependencies, creates `.venv`, and creates `.env.local` from `.env.example` if needed. Edit `.env.local` with your OpenSearch and OpenAI credentials.

**Option B: manual**

```bash
cd law-rag-app
cp .env.example .env.local
# Edit .env.local: OPENSEARCH_*, OPENAI_API_KEY

npm install
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-ingest.txt
```

## Ingest law data into OpenSearch

Sample law cases are in `data/law-cases.json`. The Python ingest script creates `law_chunks`, `law_entities`, and `law_relationships`.

```bash
source .venv/bin/activate   # or: .venv\Scripts\activate on Windows
python scripts/ingest.py
```

This creates the three indices (if missing), generates embeddings via OpenAI, and bulk-indexes chunks, entities, and relationships. The script loads `.env.local`. Use `OPENSEARCH_USE_HTTP=true` if you get SSL "wrong version number" with an https URL.

## Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a query, pick a tab (Semantic / Hybrid / Semantic + Graph), and click Search. The right panel shows retrieval steps; the main area shows the RAG answer and source chunks.

## Retrieval strategies

The app exposes three strategies so you can compare results for the same question.

| Tab | Behavior |
|-----|----------|
| **Semantic only** | k-NN search on `law_chunks.text_embedding`. No keyword match, no graph. |
| **Hybrid** | Keyword `match` (fuzziness) on `law_chunks.text` plus k-NN on `law_chunks.text_embedding`, then merge and rank. |
| **Semantic + Graph** | k-NN on chunks, then entity names from top chunks; query `law_entities` and `law_relationships`. Context to the LLM: chunks + entities + relationships. |

The right panel explainability reflects the actual OpenSearch steps and data used. The app returns **3 chunks** per search for semantic and hybrid, so "Which cases was Baker & Associates involved in?" often looks incomplete with Semantic only; **Semantic + Graph** sees all cases via the relationship index.

## Questions that show the benefit of the graph

Use **Semantic + Graph** and compare with **Semantic only**. The graph helps when the question is about who is related to whom or what relationship holds between entities.

| Question type | Example question | Why the graph helps |
|---------------|-----------------|---------------------|
| **Roles in a case** | Who was the plaintiff and who was the defendant in Martinez? | Uses `plaintiff_in` / `defendant_in` relationships directly. |
| **Court and outcome** | What court decided Martinez v. Pacific Medical Group and what did they award? | Uses `decided_by` and `awarded` relationships. |
| **Employment / affiliation** | Who did Dr. James Chen work for and where did he perform the surgery? | Uses `employed_by` and `performed_at`; graph links person → org → location. |
| **Reporting / whistleblower** | What is the relationship between Robert Thompson and the EPA? | Uses `reported_to`; semantic search may miss the exact phrase. |
| **Governing law** | Which cases were governed by California law? | Uses `governed_by` relationship; answers from structure, not one chunk. |
| **Appeals** | Which court affirmed the Martinez judgment? | Uses `affirmed_by`; one hop in the graph. |
| **Settlement / money** | What was the settlement amount in the consumer data breach case? | Uses `settlement_amount` (or `awarded`) to an entity of type MONEY. |
| **Same defendant across cases** | Which cases involved Pacific Medical Group? Which cases named RetailCo as defendant? | Entity appears in multiple cases; graph returns all relationships/cases. |
| **Same court / judge** | Which cases did Judge Patricia Wong preside over? Which court decided Martinez and Williams? | `presided_by` / `decided_by`; multiple cases share the same court/judge. |
| **Same governing law** | Which cases were governed by California Civil Code Section 3333.2? | `governed_by`; Martinez and Williams both use this statute. |
| **Lawyer / law firm (1-hop)** | Which cases was Baker & Associates involved in? Which cases was Jennifer Walsh involved in? | `represented_plaintiff_by` / `represented_defendant_by` / `lead_counsel_plaintiff`; one entity (firm or lawyer) in many cases. |
| **Lawyer / firm (2-hop)** | Which other cases was the law firm that represented Martinez in? | First hop: Martinez case → represented_plaintiff_by → Baker & Associates. Second hop: relationships for Baker & Associates → other cases. Use **Semantic + Graph** (2-hop runs automatically). |

The corpus has six cases with shared entities (e.g. Baker & Associates, Jennifer Walsh, Pacific Medical Group, RetailCo, Superior Court of California). For single-concept or broad summary questions ("What is informed consent?", "Summarize the Martinez case"), Semantic or Hybrid is often enough without the graph.
 
 
