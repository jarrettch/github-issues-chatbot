import { searchSimilarIssuesWithExplicit } from '@/lib/rag';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { query } = await req.json();

  const relevantIssues = await searchSimilarIssuesWithExplicit(query, 5);

  const issuesMetadata = relevantIssues.map(issue => ({
    number: issue.metadata.number,
    title: issue.metadata.title,
    url: issue.metadata.url,
    similarity: issue.similarity,
    explicit: issue.explicit,
    linked_prs: issue.metadata.linked_prs
  }));

  return NextResponse.json({ issues: issuesMetadata });
}
