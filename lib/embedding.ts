import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSION = 1536;

/** Get embedding for a single text. Returns zeros if no API key (for demo without OpenAI). */
export async function getEmbedding(text: string): Promise<number[]> {
  if (!openai) {
    return Array(DIMENSION).fill(0);
  }
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

export { DIMENSION, EMBEDDING_MODEL };
