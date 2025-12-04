import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function fetchIssues() {
  console.log('Fetching issues from vercel/ai repository...');

  const allIssues = [];
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
        // Skip pull requests
        if (issue.pull_request) continue;

        // Fetch comments for each issue
        const { data: comments } = await octokit.rest.issues.listComments({
          owner: 'vercel',
          repo: 'ai',
          issue_number: issue.number
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
          url: issue.html_url
        });
      }

      // Limit to 200 issues for this demo (remove this for production)
      if (allIssues.length >= 200) break;

      page++;
    }

    console.log(`\nTotal issues fetched: ${allIssues.length}`);

    await fs.writeFile('issues-data.json', JSON.stringify(allIssues, null, 2));
    console.log('Issues saved to issues-data.json');

    return allIssues;
  } catch (error) {
    console.error('Error fetching issues:', error.message);
    throw error;
  }
}

fetchIssues();
