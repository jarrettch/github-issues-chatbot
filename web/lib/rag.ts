import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { supabase } from './supabase';
import type { Database } from './database.types';

type MatchIssueResult = Database['public']['Functions']['match_issues']['Returns'][number];
type IssueRow = Database['public']['Tables']['issues']['Row'];

interface IssueResult {
  id: number;
  text: string;
  metadata: {
    number: number;
    title: string;
    state: string;
    labels: string[];
    url: string | null;
    created_at: string | null;
    updated_at: string | null;
    linked_prs: number[];
  };
  similarity: number;
  explicit?: boolean;
  analytical?: boolean;
}

export async function searchSimilarIssues(query: string, topK = 5): Promise<IssueResult[]> {
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

  return (data || []).map((row: MatchIssueResult) => ({
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

export async function getIssuesByNumber(issueNumbers: number[]): Promise<IssueResult[]> {
  if (issueNumbers.length === 0) return [];

  const { data, error } = await supabase
    .from('issues')
    .select('*')
    .in('issue_number', issueNumbers);

  if (error) throw new Error(`getIssuesByNumber error: ${error.message}`);

  return (data || []).map((row: IssueRow) => ({
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

export async function searchSimilarIssuesWithExplicit(query: string, topK = 5): Promise<IssueResult[]> {
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

export async function searchAllIssues(query: string): Promise<IssueResult[]> {
  const queryLower = query.toLowerCase();
  const stopWords = ['what', 'how', 'many', 'the', 'is', 'are', 'of', 'in', 'to', 'a', 'an'];
  const queryWords = queryLower
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));

  let dbQuery = supabase
    .from('issues')
    .select('id, issue_number, title, state, labels, url, created_at, updated_at, linked_prs, content');

  if (queryWords.length > 0) {
    const orFilters = queryWords.map(w => `content.ilike.%${w}%`).join(',');
    dbQuery = dbQuery.or(orFilters);
  }

  const { data, error } = await dbQuery;

  if (error) throw new Error(`searchAllIssues error: ${error.message}`);

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
    similarity: 0,
    analytical: true,
  }));
}

export async function getTotalIssueCount(): Promise<number> {
  const { count, error } = await supabase
    .from('issues')
    .select('*', { count: 'exact', head: true });

  if (error) throw new Error(`getTotalIssueCount error: ${error.message}`);
  return count || 0;
}

export function formatIssuesContextLightweight(results: IssueResult[]): string {
  return results
    .map(result => `#${result.metadata.number}: ${result.metadata.title}`)
    .join('\n');
}

export function formatIssuesContext(results: IssueResult[]): string {
  return results.map(result => {
    const relevanceLabel = result.explicit
      ? 'Explicitly mentioned'
      : result.analytical
      ? 'Retrieved for analysis'
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
