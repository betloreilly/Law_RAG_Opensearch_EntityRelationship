#!/usr/bin/env python3
"""
Ingest law cases from data/law-cases.json into OpenSearch.
Creates indices: law_chunks (with embeddings), law_entities, law_relationships.
Loads .env.local so OPENSEARCH_* and OPENAI_API_KEY are available.

Usage (from law-rag-app/):
  source .venv/bin/activate   # or: .venv\Scripts\activate on Windows
  python scripts/ingest.py
"""
import json
import os
import sys
from pathlib import Path

# Load env before importing openai/opensearch
from dotenv import load_dotenv
load_dotenv(".env.local")
load_dotenv()

try:
    from opensearchpy import OpenSearch
    from opensearchpy.exceptions import ConflictError, RequestError
    from openai import OpenAI
except ImportError as e:
    print("Install dependencies: pip install -r requirements-ingest.txt", file=sys.stderr)
    raise SystemExit(1) from e

# Constants
DIMENSION = 1536
EMBEDDING_MODEL = "text-embedding-3-small"
LAW_INDICES = {
    "chunks": "law_chunks",
    "entities": "law_entities",
    "relationships": "law_relationships",
}

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PATH = SCRIPT_DIR.parent / "data" / "law-cases.json"


def get_opensearch_client():
    url = (
        os.environ.get("OPENSEARCH_URL")
        or os.environ.get("OPENSEARCH_NODE")
        or "https://localhost:9200"
    ).rstrip("/")
    use_http = os.environ.get("OPENSEARCH_USE_HTTP", "").lower() == "true"
    if use_http and url.startswith("https://"):
        url = "http://" + url[8:]
    username = os.environ.get("OPENSEARCH_USERNAME") or os.environ.get("OPENSEARCH_USER")
    password = os.environ.get("OPENSEARCH_PASSWORD")
    insecure = os.environ.get("OPENSEARCH_INSECURE", "").lower() == "true"

    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (80 if parsed.scheme == "http" else 9200)
    use_ssl = parsed.scheme == "https"

    return OpenSearch(
        hosts=[{"host": host, "port": port}],
        http_auth=(username, password) if (username and password) else None,
        use_ssl=use_ssl,
        verify_certs=not insecure,
        ssl_show_warn=False,
    )


def get_embedding(client: OpenAI, text: str) -> list[float]:
    if not client:
        return [0.0] * DIMENSION
    resp = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text[:8000],
    )
    return resp.data[0].embedding


def create_indices(client: OpenSearch) -> None:
    chunks_body = {
        "settings": {"number_of_shards": 1, "index.knn": True},
        "mappings": {
            "properties": {
                "element_id": {"type": "keyword"},
                "text": {"type": "text"},
                "filename": {"type": "keyword"},
                "page_number": {"type": "integer"},
                "entity_names": {"type": "keyword"},
                "text_embedding": {
                    "type": "knn_vector",
                    "dimension": DIMENSION,
                    "method": {
                        "name": "hnsw",
                        "engine": "lucene",
                        "space_type": "cosinesimil",
                        "parameters": {"ef_construction": 128, "m": 24},
                    },
                },
            }
        },
    }
    entities_body = {
        "settings": {"number_of_shards": 1},
        "mappings": {
            "properties": {
                "entity_id": {"type": "keyword"},
                "entity_name": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "source_element_ids": {"type": "keyword"},
                "source_text_snippet": {"type": "text"},
                "filename": {"type": "keyword"},
                "page_number": {"type": "integer"},
            }
        },
    }
    relationships_body = {
        "settings": {"number_of_shards": 1},
        "mappings": {
            "properties": {
                "from_entity": {"type": "keyword"},
                "to_entity": {"type": "keyword"},
                "relationship_type": {"type": "keyword"},
                "source_element_id": {"type": "keyword"},
                "source_text_snippet": {"type": "text"},
                "filename": {"type": "keyword"},
                "page_number": {"type": "integer"},
            }
        },
    }

    for name, body in [
        (LAW_INDICES["chunks"], chunks_body),
        (LAW_INDICES["entities"], entities_body),
        (LAW_INDICES["relationships"], relationships_body),
    ]:
        try:
            client.indices.create(index=name, body=body)
            print(f"Created index: {name}")
        except (ConflictError, RequestError) as e:
            if getattr(e, "error", "") == "resource_already_exists_exception" or "already exists" in str(e).lower():
                print(f"Index {name} already exists, skipping create")
            else:
                raise


def build_entity_key(name: str, entity_type: str) -> str:
    return f"{name}|{entity_type}"


def main() -> None:
    if not DATA_PATH.exists():
        print(f"Data file not found: {DATA_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    cases = data["cases"]

    os_client = get_opensearch_client()
    openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY")) if os.environ.get("OPENAI_API_KEY") else None

    create_indices(os_client)

    entity_map: dict[str, dict] = {}
    relationship_docs: list[dict] = []
    chunk_docs: list[dict] = []
    entity_counter = 0

    for c in cases:
        first_chunk = c["chunks"][0] if c["chunks"] else {}
        snippet = (first_chunk.get("text") or "")[:500]
        fn = c["filename"]
        page = first_chunk.get("page_number", 1)
        elem_id_0 = first_chunk.get("element_id", "")

        for e in c["entities"]:
            key = build_entity_key(e["entity"], e["type"])
            if key not in entity_map:
                entity_counter += 1
                entity_map[key] = {
                    "entity_id": f"ent_{entity_counter:03d}",
                    "entity_name": e["entity"],
                    "entity_type": e["type"],
                    "source_element_ids": [],
                    "source_text_snippet": snippet,
                    "filename": fn,
                    "page_number": page,
                }

        def name_exists(name: str) -> bool:
            return any(ent["entity_name"] == name for ent in entity_map.values())

        for r in c["relationships"]:
            for name in (r["from"], r["to"]):
                if not name_exists(name):
                    entity_counter += 1
                    entity_map[build_entity_key(name, "ENTITY")] = {
                        "entity_id": f"ent_{entity_counter:03d}",
                        "entity_name": name,
                        "entity_type": "ENTITY",
                        "source_element_ids": [],
                        "source_text_snippet": snippet,
                        "filename": fn,
                        "page_number": page,
                    }
            relationship_docs.append({
                "from_entity": r["from"],
                "to_entity": r["to"],
                "relationship_type": r["relationship"],
                "source_element_id": elem_id_0,
                "source_text_snippet": snippet,
                "filename": fn,
                "page_number": page,
            })

        for ch in c["chunks"]:
            entity_names = [e["entity"] for e in c["entities"] if e["entity"] in ch["text"]]
            rel_entities = set()
            for r in c["relationships"]:
                if r["from"] in ch["text"] or r["to"] in ch["text"]:
                    rel_entities.add(r["from"])
                    rel_entities.add(r["to"])
            all_names = list(dict.fromkeys(entity_names + list(rel_entities)))

            emb = get_embedding(openai_client, ch["text"])
            chunk_docs.append({
                "element_id": ch["element_id"],
                "text": ch["text"],
                "filename": fn,
                "page_number": ch.get("page_number", 1),
                "entity_names": all_names,
                "text_embedding": emb,
            })
            for name in all_names:
                for ent in entity_map.values():
                    if ent["entity_name"] == name:
                        if ch["element_id"] not in ent["source_element_ids"]:
                            ent["source_element_ids"].append(ch["element_id"])
                        break

    # Bulk index (opensearch-py helpers expect one dict per doc: _index, _id, _source)
    from opensearchpy import helpers

    bulk_actions = []
    for doc in chunk_docs:
        bulk_actions.append({
            "_index": LAW_INDICES["chunks"],
            "_id": doc["element_id"],
            "_source": {
                "element_id": doc["element_id"],
                "text": doc["text"],
                "filename": doc["filename"],
                "page_number": doc["page_number"],
                "entity_names": doc["entity_names"],
                "text_embedding": doc["text_embedding"],
            },
        })
    for ent in entity_map.values():
        bulk_actions.append({
            "_index": LAW_INDICES["entities"],
            "_id": ent["entity_id"],
            "_source": {
                "entity_id": ent["entity_id"],
                "entity_name": ent["entity_name"],
                "entity_type": ent["entity_type"],
                "source_element_ids": ent["source_element_ids"],
                "source_text_snippet": ent["source_text_snippet"],
                "filename": ent["filename"],
                "page_number": ent["page_number"],
            },
        })
    for i, r in enumerate(relationship_docs, start=1):
        bulk_actions.append({
            "_index": LAW_INDICES["relationships"],
            "_id": f"rel_{i:03d}",
            "_source": {
                "from_entity": r["from_entity"],
                "to_entity": r["to_entity"],
                "relationship_type": r["relationship_type"],
                "source_element_id": r["source_element_id"],
                "source_text_snippet": r["source_text_snippet"],
                "filename": r["filename"],
                "page_number": r["page_number"],
            },
        })

    success, errors = helpers.bulk(
        os_client, bulk_actions, refresh=True, raise_on_error=False, request_timeout=60
    )
    if errors:
        for err in errors:
            print("Bulk error:", err, file=sys.stderr)
    else:
        print(f"Indexed {len(chunk_docs)} chunks, {len(entity_map)} entities, {len(relationship_docs)} relationships.")


if __name__ == "__main__":
    main()
