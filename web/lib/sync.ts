import { Octokit } from '@octokit/rest';
import { openai } from '@ai-sdk/openai';
import { embedMany, generateObject } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
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
  notified?: number;
}

interface ProcessedIssue {
  issue_number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  author: string;
  url: string;
  created_at: string;
  updated_at: string;
  comments_count: number;
  comments: { body: string | null | undefined; user: string; created_at: string }[];
  linked_prs: number[];
  content: string;
}

const URGENT_LABELS = ['bug', 'critical', 'urgent', 'breaking', 'regression', 'security'];

function hasUrgentLabel(labels: string[]): boolean {
  return labels.some(l => URGENT_LABELS.includes(l.toLowerCase()));
}

async function checkSemanticUrgency(issue: ProcessedIssue, log: (msg: string) => void): Promise<boolean> {
  try {
    const { object } = await generateObject({
      model: openai('gpt-4o-mini'),
      schema: z.object({
        isUrgent: z.boolean(),
        reason: z.string(),
      }),
      prompt: `Analyze this GitHub issue and determine if it describes an urgent problem that needs immediate attention. Urgent issues include: critical bugs, production outages, security vulnerabilities, breaking changes, or data loss scenarios.

Title: ${issue.title}
Body: ${issue.body?.slice(0, 1000) || 'No description'}

Return isUrgent: true only if this clearly describes a critical/urgent problem.`,
    });
    if (object.isUrgent) {
      log(`Semantic urgency reason: ${object.reason}`);
    }
    return object.isUrgent;
  } catch (err: any) {
    log(`Semantic urgency check failed: ${err.message}`);
    return false;
  }
}

async function shouldNotify(
  issue: ProcessedIssue,
  existingIssue: { notified_at: string | null; labels: string[] | null } | null,
  log: (msg: string) => void
): Promise<boolean> {
  // Test mode - notify on all new issues
  if (process.env.NOTIFICATION_TEST_MODE === 'true') {
    if (!existingIssue) {
      log(`Test mode: notifying for new issue #${issue.issue_number}`);
      return true;
    }
    return false;
  }

  // Already notified - check if urgent label was just added
  if (existingIssue?.notified_at) {
    const hadUrgentLabel = existingIssue.labels ? hasUrgentLabel(existingIssue.labels) : false;
    const hasUrgentLabelNow = hasUrgentLabel(issue.labels);
    if (!hadUrgentLabel && hasUrgentLabelNow) {
      log(`Issue #${issue.issue_number} just got an urgent label, will notify`);
      return true;
    }
    return false;
  }

  // New issue or not yet notified - check labels first
  if (hasUrgentLabel(issue.labels)) {
    log(`Issue #${issue.issue_number} has urgent label`);
    return true;
  }

  // No urgent labels - check semantically
  log(`Issue #${issue.issue_number} has no urgent labels, checking semantically...`);
  const isUrgent = await checkSemanticUrgency(issue, log);
  if (isUrgent) {
    log(`Issue #${issue.issue_number} flagged as semantically urgent`);
  }
  return isUrgent;
}

async function sendNotification(issue: ProcessedIssue | null, log: (msg: string) => void, syncSummary?: string): Promise<boolean> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    log('NOTIFICATION_WEBHOOK_URL not set, skipping notification');
    return false;
  }

  // Test mode summary notification (no specific issue)
  if (!issue && syncSummary) {
    const payload = {
      embeds: [{
        title: 'Sync Complete (Test Mode)',
        color: 0x00ff00,
        description: syncSummary,
        timestamp: new Date().toISOString(),
      }],
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        log(`Test notification failed: ${response.status} ${response.statusText}`);
        return false;
      }
      log('Test sync summary notification sent');
      return true;
    } catch (err: any) {
      log(`Test notification error: ${err.message}`);
      return false;
    }
  }

  if (!issue) return false;

  const isUrgentLabel = hasUrgentLabel(issue.labels);
  const payload = {
    content: isUrgentLabel ? '@here New urgent issue!' : null,
    embeds: [{
      title: `#${issue.issue_number}: ${issue.title}`,
      url: issue.url,
      color: isUrgentLabel ? 0xff0000 : 0xffa500, // Red for labeled urgent, orange for semantic
      fields: [
        { name: 'State', value: issue.state, inline: true },
        { name: 'Author', value: issue.author, inline: true },
        { name: 'Labels', value: issue.labels.join(', ') || 'None', inline: true },
      ],
      description: issue.body?.slice(0, 500) || 'No description',
      timestamp: issue.created_at,
    }],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      log(`Notification failed: ${response.status} ${response.statusText}`);
      return false;
    }
    log(`Notification sent for issue #${issue.issue_number}`);
    return true;
  } catch (err: any) {
    log(`Notification error: ${err.message}`);
    return false;
  }
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
    // In test mode, send a summary notification even with no new issues
    if (process.env.NOTIFICATION_TEST_MODE === 'true') {
      await sendNotification(null, log, 'No new or updated issues found.');
    }
    return { synced: 0, notified: 0 };
  }

  // Get existing issues to check notification status
  const issueNumbers = allIssues.map(i => i.issue_number);
  const { data: existingIssues } = await supabase
    .from('issues')
    .select('issue_number, notified_at, labels')
    .in('issue_number', issueNumbers);

  const existingMap = new Map(
    (existingIssues || []).map(i => [i.issue_number, { notified_at: i.notified_at, labels: i.labels }])
  );

  // Check which issues need notifications
  let notifiedCount = 0;
  const issuesToNotify: ProcessedIssue[] = [];

  for (const issue of allIssues) {
    const existing = existingMap.get(issue.issue_number) || null;
    if (await shouldNotify(issue, existing, log)) {
      issuesToNotify.push(issue);
    }
  }

  // Send notifications
  for (const issue of issuesToNotify) {
    const sent = await sendNotification(issue, log);
    if (sent) {
      notifiedCount++;
      // Mark as notified in the issue object (will be saved during upsert)
      (issue as any).notified_at = new Date().toISOString();
    }
  }

  // In test mode with no urgent issues, send summary
  if (process.env.NOTIFICATION_TEST_MODE === 'true' && notifiedCount === 0) {
    await sendNotification(null, log, `Synced ${allIssues.length} issues, none were new.`);
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

  log(`Sync complete. ${allIssues.length} issues synced. Total in DB: ${count}. Notified: ${notifiedCount}`);
  return { synced: allIssues.length, total: count, notified: notifiedCount };
}
