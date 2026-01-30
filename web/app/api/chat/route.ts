import { anthropic } from '@ai-sdk/anthropic';
import { generateObject, streamText } from 'ai';
import { z } from 'zod';
import {
  searchSimilarIssuesWithExplicit,
  searchAllIssues,
  getTotalIssueCount,
  formatIssuesContext,
  formatIssuesContextLightweight,
} from '@/lib/rag';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const queryPlanSchema = z.object({
  strategy: z.enum(['search_by_content', 'search_by_number', 'search_all']),
  searchQuery: z.string().describe('The optimized search query or keywords'),
  issueNumbers: z.array(z.number()).optional().describe('Explicit issue numbers mentioned'),
});

async function planQuery(userMessage: string) {
  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: queryPlanSchema,
    prompt: `You are a query planner for a GitHub Issues search system for the vercel/ai repository.

Classify the user's question into one of these strategies:
- "search_by_number": The user is asking about specific issue numbers (e.g. "#1234", "issue 5678")
- "search_all": The user wants aggregate data, counts, statistics, or lists across all issues (e.g. "how many issues mention streaming", "what percentage of issues are about tool calling")
- "search_by_content": The user is asking a general question that needs semantic search (default)

Also extract:
- searchQuery: an optimized version of the user's question for search (remove filler words, focus on key terms)
- issueNumbers: any explicit issue numbers mentioned (empty array if none)

User question: ${userMessage}`,
  });

  return object;
}

export async function POST(req: Request) {
  const { messages } = await req.json();
  const userMessage = messages[messages.length - 1].content;

  // Step 1: Query planning with Haiku
  const plan = await planQuery(userMessage);

  let systemPrompt: string;

  if (plan.strategy === 'search_by_number' && plan.issueNumbers && plan.issueNumbers.length > 0) {
    // Direct issue lookup + semantic search as supplement
    const relevantIssues = await searchSimilarIssuesWithExplicit(
      `#${plan.issueNumbers.join(' #')} ${plan.searchQuery}`,
      5
    );
    const context = formatIssuesContext(relevantIssues);

    systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

You have access to the following relevant issues from the vercel/ai repository:

${context}

Use this information to provide accurate, helpful answers. When referencing specific issues, include the issue number and link. If the context doesn't contain enough information to answer the question, say so honestly.`;

  } else if (plan.strategy === 'search_all') {
    // Analytical query — search across all issues
    const totalIssues = await getTotalIssueCount();
    const matchingIssues = await searchAllIssues(plan.searchQuery);
    const matchingCount = matchingIssues.length;
    const percentage = ((matchingCount / totalIssues) * 100).toFixed(1);

    const sampleSize = Math.min(10, matchingIssues.length);
    const sampleIssues = matchingIssues.slice(0, sampleSize);
    const issuesList = formatIssuesContextLightweight(sampleIssues);

    systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

IMPORTANT - PRE-COMPUTED STATISTICS (DO NOT COUNT MANUALLY):
The search has already been performed across ALL issue titles AND body text.

ANSWER: ${matchingCount} out of ${totalIssues} issues match the search criteria (${percentage}%)

NOTE: This count includes matches found in issue titles, descriptions, and body text - not just titles.

SAMPLE OF MATCHING ISSUES (showing ${sampleSize} of ${matchingCount}):
${issuesList}

Use the statistics provided above to answer the user's question. Do NOT count the sample titles - use the pre-computed count of ${matchingCount} matches.`;

  } else {
    // Default: semantic search
    const relevantIssues = await searchSimilarIssuesWithExplicit(plan.searchQuery, 5);
    const context = formatIssuesContext(relevantIssues);

    systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

You have access to the following relevant issues from the vercel/ai repository:

${context}

Use this information to provide accurate, helpful answers. When referencing specific issues, include the issue number and link. If the context doesn't contain enough information to answer the question, say so honestly.`;
  }

  // Step 2: Generate answer with Sonnet
  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
  });

  return result.toTextStreamResponse();
}
