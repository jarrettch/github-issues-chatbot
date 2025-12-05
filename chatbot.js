import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { searchSimilarIssuesWithExplicit, formatIssuesContext } from './rag.js';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function buildConversationAwareQuery(userMessage, conversationHistory) {
  // Get recent conversation context (last 2 turns)
  const recentHistory = conversationHistory.slice(-4); // Last 2 user + 2 assistant messages

  if (recentHistory.length === 0) {
    return userMessage;
  }

  // Build context from recent messages
  const contextParts = [];

  for (const msg of recentHistory) {
    if (msg.role === 'user') {
      contextParts.push(msg.content);
    } else if (msg.role === 'assistant') {
      // Extract key topics from assistant's response (first 100 chars as summary)
      const summary = msg.content.substring(0, 100).replace(/\n/g, ' ');
      contextParts.push(summary);
    }
  }

  // Combine context with current query
  const conversationContext = contextParts.join(' ');
  return `${conversationContext}\n\nCurrent question: ${userMessage}`;
}

async function chat(userMessage, conversationHistory = []) {
  console.log('\n🔍 Searching for relevant issues...');

  // Build conversation-aware search query
  const searchQuery = buildConversationAwareQuery(userMessage, conversationHistory);

  // Retrieve relevant issues using RAG with explicit issue lookup
  const relevantIssues = await searchSimilarIssuesWithExplicit(searchQuery, 5);
  const context = formatIssuesContext(relevantIssues);

  console.log(`\n✓ Found ${relevantIssues.length} relevant issues\n`);

  // Build the system prompt with RAG context
  const systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

You have access to the following relevant issues from the vercel/ai repository:

${context}

Use this information to provide accurate, helpful answers. When referencing specific issues, include the issue number and link. If the context doesn't contain enough information to answer the question, say so honestly.`;

  // Add the new message to conversation history
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  // Stream the response
  const result = streamText({
    model: openai('gpt-4-turbo'),
    system: systemPrompt,
    messages: messages
  });

  console.log('🤖 Assistant: ');

  let fullResponse = '';

  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
    fullResponse += textPart;
  }

  console.log('\n');

  return {
    response: fullResponse,
    relevantIssues: relevantIssues.map(issue => ({
      number: issue.metadata.number,
      title: issue.metadata.title,
      url: issue.metadata.url,
      similarity: issue.similarity,
      explicit: issue.explicit
    }))
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   GitHub Issues RAG Chatbot - Vercel AI SDK          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const conversationHistory = [];

  while (true) {
    const userInput = await question('You: ');

    if (!userInput.trim()) continue;

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('\nGoodbye! 👋\n');
      rl.close();
      process.exit(0);
    }

    try {
      const { response, relevantIssues } = await chat(userInput, conversationHistory);

      // Add to conversation history
      conversationHistory.push(
        { role: 'user', content: userInput },
        { role: 'assistant', content: response }
      );

      // Show relevant issues referenced
      console.log('📚 Referenced Issues:');
      relevantIssues.forEach(issue => {
        const relevanceLabel = issue.explicit
          ? 'Explicitly mentioned'
          : `${(issue.similarity * 100).toFixed(1)}% match`;
        console.log(`  - #${issue.number}: ${issue.title} (${relevanceLabel})`);
        console.log(`    ${issue.url}`);
      });
      console.log('');

    } catch (error) {
      console.error('\n❌ Error:', error.message);
      console.log('');
    }
  }
}

main();
