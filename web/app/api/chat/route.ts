import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { searchSimilarIssuesWithExplicit, formatIssuesContext } from '@/lib/rag';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function buildConversationAwareQuery(userMessage: string, messages: any[]) {
  const recentHistory = messages.slice(-4);

  if (recentHistory.length === 0) {
    return userMessage;
  }

  const contextParts = [];

  for (const msg of recentHistory) {
    if (msg.role === 'user') {
      contextParts.push(msg.content);
    } else if (msg.role === 'assistant') {
      const summary = msg.content.substring(0, 100).replace(/\n/g, ' ');
      contextParts.push(summary);
    }
  }

  const conversationContext = contextParts.join(' ');
  return `${conversationContext}\n\nCurrent question: ${userMessage}`;
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const userMessage = messages[messages.length - 1].content;
  const conversationHistory = messages.slice(0, -1);

  const searchQuery = buildConversationAwareQuery(userMessage, conversationHistory);

  const relevantIssues = await searchSimilarIssuesWithExplicit(searchQuery, 5);
  const context = formatIssuesContext(relevantIssues);

  const systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

You have access to the following relevant issues from the vercel/ai repository:

${context}

Use this information to provide accurate, helpful answers. When referencing specific issues, include the issue number and link. If the context doesn't contain enough information to answer the question, say so honestly.`;

  // Create the metadata for relevant issues
  // const issuesMetadata = relevantIssues.map(issue => ({
  //   number: issue.metadata.number,
  //   title: issue.metadata.title,
  //   url: issue.metadata.url,
  //   similarity: issue.similarity,
  //   explicit: issue.explicit,
  //   linked_prs: issue.metadata.linked_prs
  // }));

  const result = streamText({
    model: openai('gpt-4-turbo'),
    system: systemPrompt,
    messages: messages,
  });

  return result.toTextStreamResponse();
}
