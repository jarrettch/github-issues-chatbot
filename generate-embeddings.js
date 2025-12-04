import fs from 'fs/promises';
import { openai } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

async function generateEmbeddings() {
  console.log('Loading issues data...');

  const issuesData = JSON.parse(await fs.readFile('issues-data.json', 'utf-8'));
  console.log(`Loaded ${issuesData.length} issues`);

  const documents = [];

  for (const issue of issuesData) {
    // Combine issue content into searchable text
    const commentsText = issue.comments
      .map(c => `Comment by ${c.user}: ${c.body}`)
      .join('\n\n');

    const fullText = `
Title: ${issue.title}
Number: #${issue.number}
State: ${issue.state}
Labels: ${issue.labels.join(', ')}
Author: ${issue.user}

Description:
${issue.body}

${commentsText ? `Comments:\n${commentsText}` : ''}
    `.trim();

    documents.push({
      id: `issue-${issue.number}`,
      text: fullText,
      metadata: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        url: issue.url,
        created_at: issue.created_at,
        updated_at: issue.updated_at
      }
    });
  }

  console.log(`\nGenerating embeddings for ${documents.length} documents...`);

  const embeddingModel = openai.embedding('text-embedding-3-small');
  const batchSize = 100;
  const allEmbeddings = [];

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)}...`);

    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: batch.map(doc => doc.text)
    });

    batch.forEach((doc, index) => {
      allEmbeddings.push({
        ...doc,
        embedding: embeddings[index]
      });
    });
  }

  await fs.writeFile('embeddings.json', JSON.stringify(allEmbeddings, null, 2));
  console.log(`\nEmbeddings saved to embeddings.json`);
  console.log(`Total embeddings generated: ${allEmbeddings.length}`);
}

generateEmbeddings().catch(console.error);
