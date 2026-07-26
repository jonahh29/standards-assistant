const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5";
const DIMENSION = 1024;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      output_dimension: DIMENSION,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage embeddings request failed: ${response.status} ${body}`);
  }

  const json = await response.json();
  return json.data.map((item: { embedding: number[] }) => item.embedding);
}

export const EMBEDDING_DIMENSION = DIMENSION;
