import { Octokit } from '@octokit/rest';
import { openai } from '@ai-sdk/openai';
import { embedMany } from 'ai';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

function getSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// --- Helper functions ---

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

  const repoPattern = /vercel\/ai#(\d+)/g;
  while ((match = repoPattern.exec(text)) !== null) {
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

function truncateText(text: string, maxTokens = 7000): string {
  const maxChars = Math.floor(maxTokens * 1.5);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[... truncated for length ...]';
}

function sanitize(s: string): string {
  return s.replace(/\0/g, '').replace(/\\u0000/g, '').replace(/\x00/g, '');
}

function buildContent(issue: any, comments: any[]): string {
  const commentsText = comments
    .map((c: any) => `Comment by ${c.user}: ${c.body}`)
    .join('\n\n');

  return truncateText(sanitize(`
Title: ${issue.title}
Number: #${issue.number}
State: ${issue.state}
Labels: ${(issue.labels || []).map((l: any) => typeof l === 'string' ? l : l.name).join(', ')}
Author: ${issue.user?.login || 'unknown'}

Description:
${issue.body || ''}

${commentsText ? `Comments:\n${commentsText}` : ''}
  `).trim());
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.status === 403 && err?.response?.headers?.['x-ratelimit-remaining'] === '0') {
        const resetAt = parseInt(err.response.headers['x-ratelimit-reset'], 10) * 1000;
        const waitMs = Math.max(resetAt - Date.now(), 0) + 5000;
        const waitMin = Math.ceil(waitMs / 60000);
        console.log(`Rate limited. Waiting ${waitMin} minutes until reset...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
}

export interface SyncOptions {
  log?: (message: string) => void;
}

export interface SyncResult {
  synced: number;
  total?: number | null;
}

export async function syncIssues(options: SyncOptions = {}): Promise<SyncResult> {
  const log = options.log || console.log;
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const supabase = getSupabase();

  // Read last sync time
  const { data: syncMeta } = await supabase
    .from('sync_metadata')
    .select('last_synced_at, total_issues')
    .eq('id', 1)
    .single();

  const lastSyncedAt = syncMeta?.last_synced_at || null;
  log(`Last synced at: ${lastSyncedAt || 'never (full sync)'}`);

  const allIssues: any[] = [];
  const prToIssueMap = new Map<number, number[]>();
  let page = 1;
  const perPage = 100;

  // Fetch issues with pagination
  while (true) {
    const params: any = {
      owner: 'vercel',
      repo: 'ai',
      state: 'all',
      per_page: perPage,
      page,
      sort: 'updated',
      direction: 'desc',
    };
    if (lastSyncedAt) params.since = lastSyncedAt;

    const { data: issues } = await withRateLimitRetry(() => octokit.rest.issues.listForRepo(params));
    if (issues.length === 0) break;

    log(`Fetched page ${page} (${issues.length} items)`);

    for (const issue of issues) {
      // If it's a PR, extract referenced issues then skip
      if (issue.pull_request) {
        const refs = extractIssueNumbersFromBody(issue.body || '');
        if (refs.length > 0) prToIssueMap.set(issue.number, refs);
        continue;
      }

      // Only fetch comments if the issue actually has some
      let comments: any[] = [];
      if (issue.comments > 0) {
        const { data } = await withRateLimitRetry(() => octokit.rest.issues.listComments({
          owner: 'vercel',
          repo: 'ai',
          issue_number: issue.number,
        }));
        comments = data;
      }

      let linkedPRs = new Set<number>();
      extractPRLinks(issue.body ?? null).forEach(pr => linkedPRs.add(pr));
      comments.forEach(c => extractPRLinks(c.body ?? null).forEach(pr => linkedPRs.add(pr)));

      const formattedComments = comments.map(c => ({
        body: c.body,
        user: c.user?.login || 'unknown',
        created_at: c.created_at,
      }));

      const content = buildContent(issue, formattedComments);

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
        content,
      });
    }

    page++;
  }

  // Link PRs back to issues
  for (const [prNumber, referencedIssues] of prToIssueMap.entries()) {
    for (const issueNumber of referencedIssues) {
      const issue = allIssues.find(i => i.issue_number === issueNumber);
      if (issue && !issue.linked_prs.includes(prNumber)) {
        issue.linked_prs.push(prNumber);
        issue.linked_prs.sort((a: number, b: number) => a - b);
      }
    }
  }

  log(`Total issues to sync: ${allIssues.length}`);

  if (allIssues.length === 0) {
    log('No new issues to sync.');
    return { synced: 0 };
  }

  // Generate embeddings in batches of 100
  const embeddingModel = openai.embedding('text-embedding-3-small');
  const batchSize = 100;

  for (let i = 0; i < allIssues.length; i += batchSize) {
    const batch = allIssues.slice(i, i + batchSize);
    log(`Generating embeddings batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allIssues.length / batchSize)}...`);

    try {
      const { embeddings } = await embedMany({
        model: embeddingModel,
        values: batch.map(issue => issue.content),
      });

      const rows = batch.map((issue, idx) => ({
        ...issue,
        embedding: JSON.stringify(embeddings[idx]),
        synced_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('issues')
        .upsert(rows, { onConflict: 'issue_number' });

      if (error) {
        log(`Upsert error on batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      }
    } catch (err: any) {
      log(`Embedding error on batch ${Math.floor(i / batchSize) + 1}: ${err.message}`);
      log('Falling back to individual processing...');

      // Process each issue individually so one bad one doesn't kill the batch
      for (const issue of batch) {
        try {
          const { embeddings } = await embedMany({
            model: embeddingModel,
            values: [issue.content],
          });
          const { error } = await supabase
            .from('issues')
            .upsert([{ ...issue, embedding: JSON.stringify(embeddings[0]), synced_at: new Date().toISOString() }], { onConflict: 'issue_number' });
          if (error) log(`  Upsert error for #${issue.issue_number}: ${error.message}`);
        } catch (e: any) {
          log(`  Skipping issue #${issue.issue_number}: ${e.message.slice(0, 80)}`);
        }
      }
    }
  }

  // Update sync metadata
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

  log(`Sync complete. ${allIssues.length} issues synced. Total in DB: ${count}`);
  return { synced: allIssues.length, total: count };
}
