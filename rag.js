import fs from 'fs/promises';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

let embeddings = null;

export async function loadEmbeddings() {
  if (!embeddings) {
    console.log('Loading embeddings...');
    const data = await fs.readFile('embeddings.json', 'utf-8');
    embeddings = JSON.parse(data);
    console.log(`Loaded ${embeddings.length} embeddings`);
  }
  return embeddings;
}

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchSimilarIssues(query, topK = 5) {
  const embeddingsList = await loadEmbeddings();

  // Generate embedding for the query
  const embeddingModel = openai.embedding('text-embedding-3-small');
  const { embedding: queryEmbedding } = await embed({
    model: embeddingModel,
    value: query
  });

  // Calculate similarity scores
  const results = embeddingsList.map(doc => ({
    ...doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding)
  }));

  // Sort by similarity (descending) and return top K
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, topK).map(result => ({
    id: result.id,
    text: result.text,
    metadata: result.metadata,
    similarity: result.similarity
  }));
}

export function formatIssuesContext(results) {
  return results.map((result, index) => {
    return `
[Issue #${result.metadata.number}] ${result.metadata.title}
State: ${result.metadata.state}
Labels: ${result.metadata.labels.join(', ') || 'None'}
URL: ${result.metadata.url}
Relevance: ${(result.similarity * 100).toFixed(1)}%

Content:
${result.text}
---
`;
  }).join('\n');
}
