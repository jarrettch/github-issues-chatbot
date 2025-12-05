import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { searchSimilarIssuesWithExplicit, formatIssuesContext } from './rag.js';
import dotenv from 'dotenv';

dotenv.config();

async function askQuestion(question) {
  console.log(`\n❓ Question: ${question}\n`);

  const relevantIssues = await searchSimilarIssuesWithExplicit(question, 5);
  const context = formatIssuesContext(relevantIssues);

  const systemPrompt = `You are a helpful assistant that answers questions about issues in the Vercel AI SDK GitHub repository.

You have access to the following relevant issues:

${context}

Provide accurate answers based on these issues. Include issue numbers and links when relevant.`;

  const result = streamText({
    model: openai('gpt-4-turbo'),
    system: systemPrompt,
    messages: [{ role: 'user', content: question }]
  });

  console.log('🤖 Answer:\n');

  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  }

  console.log('\n\n📚 Top Relevant Issues:');
  relevantIssues.forEach((issue, i) => {
    const relevanceLabel = issue.explicit
      ? 'Explicitly mentioned'
      : `${(issue.similarity * 100).toFixed(1)}% match`;
    console.log(`${i + 1}. #${issue.metadata.number}: ${issue.metadata.title}`);
    console.log(`   ${issue.metadata.url} (${relevanceLabel})\n`);
  });
}

// Example questions
const examples = [
  "How do I stream responses with the Vercel AI SDK?",
  "What are common issues with tool calling?",
  "How do I handle errors in streaming?",
];

async function runExamples() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║        Example Queries - GitHub Issues RAG           ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  for (const question of examples) {
    await askQuestion(question);
    console.log('\n' + '─'.repeat(60) + '\n');
  }
}

runExamples().catch(console.error);
