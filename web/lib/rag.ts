import fs from 'fs/promises';
import path from 'path';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

let embeddings: any[] | null = null;

export async function loadEmbeddings() {
  if (!embeddings) {
    console.log('Loading embeddings...');
    // Get the path relative to the web directory
    const embeddingsPath = path.join(process.cwd(), '..', 'embeddings.json');
    console.log('Embeddings path:', embeddingsPath);
    const data = await fs.readFile(embeddingsPath, 'utf-8');
    embeddings = JSON.parse(data);
    console.log(`Loaded ${embeddings.length} embeddings`);
  }
  return embeddings;
}

function cosineSimilarity(a: number[], b: number[]): number {
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

export async function searchSimilarIssues(query: string, topK = 5) {
  const embeddingsList = await loadEmbeddings();

  const embeddingModel = openai.embedding('text-embedding-3-small');
  const { embedding: queryEmbedding } = await embed({
    model: embeddingModel,
    value: query
  });

  const results = embeddingsList.map(doc => ({
    ...doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding)
  }));

  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, topK).map(result => ({
    id: result.id,
    text: result.text,
    metadata: result.metadata,
    similarity: result.similarity
  }));
}

export function extractIssueNumbers(text: string): number[] {
  const patterns = [
    /#(\d+)/g,
    /issue\s+#?(\d+)/gi,
    /issues?\s+#?(\d+)/gi,
    /\b(\d{4,})\b/g,
  ];

  const issueNumbers = new Set<number>();

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      issueNumbers.add(parseInt(match[1], 10));
    }
  }

  return Array.from(issueNumbers);
}

export async function getIssuesByNumber(issueNumbers: number[]) {
  const embeddingsList = await loadEmbeddings();
  const issues = [];

  for (const number of issueNumbers) {
    const issue = embeddingsList.find(doc => doc.metadata.number === number);
    if (issue) {
      issues.push({
        id: issue.id,
        text: issue.text,
        metadata: issue.metadata,
        similarity: 1.0,
        explicit: true
      });
    }
  }

  return issues;
}

export async function searchSimilarIssuesWithExplicit(query: string, topK = 5) {
  const explicitIssueNumbers = extractIssueNumbers(query);
  const explicitIssues = await getIssuesByNumber(explicitIssueNumbers);
  const semanticResults = await searchSimilarIssues(query, topK);

  const explicitNumbers = new Set(explicitIssues.map(i => i.metadata.number));
  const filteredSemanticResults = semanticResults.filter(
    r => !explicitNumbers.has(r.metadata.number)
  );

  const combined = [
    ...explicitIssues,
    ...filteredSemanticResults.slice(0, Math.max(0, topK - explicitIssues.length))
  ];

  return combined;
}

export function formatIssuesContext(results: any[]) {
  return results.map((result) => {
    const relevanceLabel = result.explicit
      ? 'Explicitly mentioned'
      : `${(result.similarity * 100).toFixed(1)}% match`;

    const linkedPRs = result.metadata.linked_prs || [];
    const prLinks = linkedPRs.length > 0
      ? linkedPRs.map((pr: number) => `https://github.com/vercel/ai/pull/${pr}`).join(', ')
      : 'None';

    return `
[Issue #${result.metadata.number}] ${result.metadata.title}
State: ${result.metadata.state}
Labels: ${result.metadata.labels.join(', ') || 'None'}
URL: ${result.metadata.url}
Linked PRs: ${prLinks}
Relevance: ${relevanceLabel}

Content:
${result.text}
---
`;
  }).join('\n');
}
