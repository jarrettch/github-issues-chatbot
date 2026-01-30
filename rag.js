import { createClient } from '@supabase/supabase-js';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function searchSimilarIssues(query, topK = 5) {
  const embeddingModel = openai.embedding('text-embedding-3-small');
  const { embedding: queryEmbedding } = await embed({
    model: embeddingModel,
    value: query,
  });

  const { data, error } = await supabase.rpc('match_issues', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: topK,
    match_threshold: 0.15,
  });

  if (error) throw new Error(`match_issues RPC error: ${error.message}`);

  return (data || []).map(row => ({
    id: row.id,
    text: row.content,
    metadata: {
      number: row.issue_number,
      title: row.title,
      state: row.state,
      labels: row.labels || [],
      url: row.url,
      created_at: row.created_at,
      updated_at: row.updated_at,
      linked_prs: row.linked_prs || [],
    },
    similarity: row.similarity,
  }));
}

export function extractIssueNumbers(text) {
  const patterns = [
    /#(\d+)/g,
    /issue\s+#?(\d+)/gi,
    /issues?\s+#?(\d+)/gi,
    /\b(\d{4,})\b/g,
  ];

  const issueNumbers = new Set();

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      issueNumbers.add(parseInt(match[1], 10));
    }
  }

  return Array.from(issueNumbers);
}

export async function getIssuesByNumber(issueNumbers) {
  if (issueNumbers.length === 0) return [];

  const { data, error } = await supabase
    .from('issues')
    .select('*')
    .in('issue_number', issueNumbers);

  if (error) throw new Error(`getIssuesByNumber error: ${error.message}`);

  return (data || []).map(row => ({
    id: row.id,
    text: row.content,
    metadata: {
      number: row.issue_number,
      title: row.title,
      state: row.state,
      labels: row.labels || [],
      url: row.url,
      created_at: row.created_at,
      updated_at: row.updated_at,
      linked_prs: row.linked_prs || [],
    },
    similarity: 1.0,
    explicit: true,
  }));
}

export async function searchSimilarIssuesWithExplicit(query, topK = 5) {
  const explicitIssueNumbers = extractIssueNumbers(query);
  const explicitIssues = await getIssuesByNumber(explicitIssueNumbers);
  const semanticResults = await searchSimilarIssues(query, topK);

  const explicitNumbers = new Set(explicitIssues.map(i => i.metadata.number));
  const filteredSemanticResults = semanticResults.filter(
    r => !explicitNumbers.has(r.metadata.number)
  );

  return [
    ...explicitIssues,
    ...filteredSemanticResults.slice(0, Math.max(0, topK - explicitIssues.length)),
  ];
}

export function formatIssuesContext(results) {
  return results.map((result) => {
    const relevanceLabel = result.explicit
      ? 'Explicitly mentioned'
      : `${(result.similarity * 100).toFixed(1)}% match`;

    const linkedPRs = result.metadata.linked_prs || [];
    const prLinks = linkedPRs.length > 0
      ? linkedPRs.map(pr => `https://github.com/vercel/ai/pull/${pr}`).join(', ')
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
