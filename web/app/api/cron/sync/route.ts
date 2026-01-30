import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { openai } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function extractPRLinks(text: string | null): number[] {
  if (!text) return [];
  const prNumbers = new Set<number>();
  let match;

  const urlPattern = /https?:\/\/github\.com\/vercel\/ai\/pull\/(\d+)/g;
  while ((match = urlPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }

  const prMentionPattern = /(?:PR|pull request|pull)\s*#?(\d+)/gi;
  while ((match = prMentionPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }

  return Array.from(prNumbers);
}

function extractIssueNumbersFromBody(text: string): number[] {
  const issueNumbers = new Set<number>();
  const keywordPattern = /(?:fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?)\s+#(\d+)/gi;
  let match;
  while ((match = keywordPattern.exec(text)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }
  return Array.from(issueNumbers);
}

function truncateText(text: string, maxTokens = 6000): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated for length ...]';
}

function buildContent(issue: any, comments: any[]): string {
  const commentsText = comments
    .map((c: any) => `Comment by ${c.user}: ${c.body}`)
    .join('\n\n');

  return truncateText(`
Title: ${issue.title}
Number: #${issue.number}
State: ${issue.state}
Labels: ${(issue.labels || []).map((l: any) => typeof l === 'string' ? l : l.name).join(', ')}
Author: ${issue.user?.login || 'unknown'}

Description:
${issue.body || ''}

${commentsText ? `Comments:\n${commentsText}` : ''}
  `.trim());
}

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Read last sync time
  const { data: syncMeta } = await supabase
    .from('sync_metadata')
    .select('last_synced_at')
    .eq('id', 1)
    .single();

  const lastSyncedAt = syncMeta?.last_synced_at || null;
  const allIssues: any[] = [];
  const prToIssueMap = new Map<number, number[]>();
  let page = 1;

  while (true) {
    const params: any = {
      owner: 'vercel',
      repo: 'ai',
      state: 'all',
      per_page: 100,
      page,
      sort: 'updated',
      direction: 'desc',
    };
    if (lastSyncedAt) params.since = lastSyncedAt;

    const { data: issues } = await octokit.rest.issues.listForRepo(params);
    if (issues.length === 0) break;

    for (const issue of issues) {
      if (issue.pull_request) {
        const refs = extractIssueNumbersFromBody(issue.body || '');
        if (refs.length > 0) prToIssueMap.set(issue.number, refs);
        continue;
      }

      const { data: comments } = await octokit.rest.issues.listComments({
        owner: 'vercel',
        repo: 'ai',
        issue_number: issue.number,
      });

      let linkedPRs = new Set<number>();
      extractPRLinks(issue.body ?? null).forEach(pr => linkedPRs.add(pr));
      comments.forEach(c => extractPRLinks(c.body ?? null).forEach(pr => linkedPRs.add(pr)));

      const formattedComments = comments.map(c => ({
        body: c.body,
        user: c.user?.login || 'unknown',
        created_at: c.created_at,
      }));

      allIssues.push({
        issue_number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state,
        labels: issue.labels.map((l: any) => typeof l === 'string' ? l : l.name),
        author: issue.user?.login || 'unknown',
        url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        comments_count: issue.comments,
        comments: formattedComments,
        linked_prs: Array.from(linkedPRs).sort((a, b) => a - b),
        content: buildContent(issue, formattedComments),
      });
    }

    page++;
  }

  // Link PRs back to issues
  for (const [prNumber, referencedIssues] of prToIssueMap.entries()) {
    for (const issueNumber of referencedIssues) {
      const issue = allIssues.find((i: any) => i.issue_number === issueNumber);
      if (issue && !issue.linked_prs.includes(prNumber)) {
        issue.linked_prs.push(prNumber);
      }
    }
  }

  if (allIssues.length === 0) {
    return NextResponse.json({ synced: 0, message: 'No new issues' });
  }

  // Generate embeddings and upsert
  const embeddingModel = openai.embedding('text-embedding-3-small');
  const batchSize = 100;

  for (let i = 0; i < allIssues.length; i += batchSize) {
    const batch = allIssues.slice(i, i + batchSize);

    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: batch.map(issue => issue.content),
    });

    const rows = batch.map((issue, idx) => ({
      ...issue,
      embedding: JSON.stringify(embeddings[idx]),
      synced_at: new Date().toISOString(),
    }));

    await supabase.from('issues').upsert(rows, { onConflict: 'issue_number' });
  }

  const { count } = await supabase
    .from('issues')
    .select('*', { count: 'exact', head: true });

  await supabase
    .from('sync_metadata')
    .update({
      last_synced_at: new Date().toISOString(),
      total_issues: count,
    })
    .eq('id', 1);

  return NextResponse.json({ synced: allIssues.length, total: count });
}
