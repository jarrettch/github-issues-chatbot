import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

function extractPRLinks(text) {
  if (!text) return [];

  const prNumbers = new Set();

  // Pattern 1: GitHub PR URLs - https://github.com/vercel/ai/pull/1234
  const urlPattern = /https?:\/\/github\.com\/vercel\/ai\/pull\/(\d+)/g;
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }

  // Pattern 2: PR mentions with keywords - "PR #1234", "pull request #1234", etc.
  const prMentionPattern = /(?:PR|pull request|pull)\s*#?(\d+)/gi;
  while ((match = prMentionPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }

  // Pattern 3: repo#number format - vercel/ai#1234
  const repoPattern = /vercel\/ai#(\d+)/g;
  while ((match = repoPattern.exec(text)) !== null) {
    prNumbers.add(parseInt(match[1], 10));
  }

  return Array.from(prNumbers);
}

function extractIssueNumbers(text) {
  if (!text) return [];

  const issueNumbers = new Set();

  // Pattern 1: GitHub keywords that link PRs to issues
  // Fixes/Closes/Resolves #1234
  const keywordPattern = /(?:fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?)\s+#(\d+)/gi;
  let match;
  while ((match = keywordPattern.exec(text)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }

  // Pattern 2: Plain #number mentions (might be issue or PR)
  const hashPattern = /#(\d+)/g;
  while ((match = hashPattern.exec(text)) !== null) {
    issueNumbers.add(parseInt(match[1], 10));
  }

  return Array.from(issueNumbers);
}

async function fetchIssues() {
  console.log('Fetching issues from vercel/ai repository...');

  const allIssues = [];
  const prToIssueMap = new Map(); // Track which PRs reference which issues
  let page = 1;
  const perPage = 100;

  try {
    while (true) {
      const { data: issues } = await octokit.rest.issues.listForRepo({
        owner: 'vercel',
        repo: 'ai',
        state: 'all',
        per_page: perPage,
        page: page,
        sort: 'updated',
        direction: 'desc'
      });

      if (issues.length === 0) break;

      console.log(`Fetched page ${page} (${issues.length} issues)`);

      for (const issue of issues) {
        // If it's a PR, extract which issues it references, then skip
        if (issue.pull_request) {
          const referencedIssues = extractIssueNumbers(issue.body || '');
          if (referencedIssues.length > 0) {
            prToIssueMap.set(issue.number, referencedIssues);
          }
          continue;
        }

        // Fetch comments for each issue
        const { data: comments } = await octokit.rest.issues.listComments({
          owner: 'vercel',
          repo: 'ai',
          issue_number: issue.number
        });

        // Fetch timeline events to capture cross-referenced PRs
        const { data: timeline } = await octokit.rest.issues.listEventsForTimeline({
          owner: 'vercel',
          repo: 'ai',
          issue_number: issue.number
        });

        // Extract PR links from issue body and all comments
        const linkedPRs = new Set();

        // Check issue body
        extractPRLinks(issue.body).forEach(pr => linkedPRs.add(pr));

        // Check all comments
        comments.forEach(comment => {
          extractPRLinks(comment.body).forEach(pr => linkedPRs.add(pr));
        });

        // Check timeline events for cross-referenced PRs
        timeline.forEach(event => {
          if (event.event === 'cross-referenced' && event.source?.issue?.pull_request) {
            linkedPRs.add(event.source.issue.number);
          }
        });

        allIssues.push({
          number: issue.number,
          title: issue.title,
          body: issue.body || '',
          state: issue.state,
          labels: issue.labels.map(l => typeof l === 'string' ? l : l.name),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          user: issue.user.login,
          comments_count: issue.comments,
          comments: comments.map(c => ({
            body: c.body,
            user: c.user.login,
            created_at: c.created_at
          })),
          url: issue.html_url,
          linked_prs: Array.from(linkedPRs).sort((a, b) => a - b)
        });
      }

      // Limit to 200 issues for this demo (remove this for production)
      if (allIssues.length >= 200) break;

      page++;
    }

    console.log(`\nTotal issues fetched: ${allIssues.length}`);
    console.log(`Total PRs scanned: ${prToIssueMap.size}`);

    // Link PRs back to issues they reference
    for (const [prNumber, referencedIssues] of prToIssueMap.entries()) {
      for (const issueNumber of referencedIssues) {
        const issue = allIssues.find(i => i.number === issueNumber);
        if (issue && !issue.linked_prs.includes(prNumber)) {
          issue.linked_prs.push(prNumber);
        }
      }
    }

    // Sort linked_prs arrays
    allIssues.forEach(issue => {
      issue.linked_prs.sort((a, b) => a - b);
    });

    // Calculate PR link statistics
    const issuesWithPRs = allIssues.filter(i => i.linked_prs.length > 0).length;
    const totalPRLinks = allIssues.reduce((sum, i) => sum + i.linked_prs.length, 0);

    console.log(`Issues with linked PRs: ${issuesWithPRs}`);
    console.log(`Total PR links found: ${totalPRLinks}`);

    await fs.writeFile('issues-data.json', JSON.stringify(allIssues, null, 2));
    console.log('Issues saved to issues-data.json');

    return allIssues;
  } catch (error) {
    console.error('Error fetching issues:', error.message);
    throw error;
  }
}

fetchIssues();
