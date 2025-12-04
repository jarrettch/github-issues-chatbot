# GitHub Issues RAG Chatbot

A chatbot that uses RAG (Retrieval Augmented Generation) with embeddings to answer questions about GitHub issues from the Vercel AI SDK repository.

## Features

- Fetches issues from the `vercel/ai` GitHub repository
- Generates embeddings using OpenAI's `text-embedding-3-small` model
- Implements vector similarity search for relevant issue retrieval
- Interactive chatbot using Vercel AI SDK with streaming responses
- Maintains conversation context across multiple turns

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   GitHub    │────▶│   Embeddings │────▶│   Vector    │
│   Issues    │     │   Generation │     │   Store     │
└─────────────┘     └──────────────┘     └─────────────┘
                                                 │
                                                 ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│    User     │────▶│   RAG Query  │────▶│  Similarity │
│   Query     │     │              │     │   Search    │
└─────────────┘     └──────────────┘     └─────────────┘
                                                 │
                                                 ▼
                    ┌──────────────┐     ┌─────────────┐
                    │   Response   │◀────│   LLM with  │
                    │  (Streamed)  │     │   Context   │
                    └──────────────┘     └─────────────┘
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file:

```bash
cp .env.example .env
```

Add your API keys:

```env
OPENAI_API_KEY=sk-...
GITHUB_TOKEN=ghp_...  # Optional, but recommended for higher rate limits
```

### 3. Fetch Issues

Download issues from the vercel/ai repository:

```bash
npm run fetch-issues
```

This creates `issues-data.json` with issue data.

### 4. Generate Embeddings

Create vector embeddings for all issues:

```bash
node generate-embeddings.js
```

This creates `embeddings.json` with embedded vectors.

## Usage

### Interactive Chat

Start the interactive chatbot:

```bash
npm run chat
```

Example interaction:

```
You: How do I implement streaming with tool calls?

🔍 Searching for relevant issues...
✓ Found 5 relevant issues

🤖 Assistant:
To implement streaming with tool calls in the Vercel AI SDK, you can use the
`streamText` function with the `tools` parameter. Here are the key points based
on recent issues:

1. Use the `onFinish` callback to handle completed tool calls (#2847)
2. Handle partial tool calls during streaming with `toolCallStreaming` (#2756)
3. Make sure to properly type your tool definitions (#2893)

[Issue #2847] provides a complete example of streaming with tool execution...

📚 Referenced Issues:
  - #2847: Tool calls not executing in stream mode (94.2% match)
    https://github.com/vercel/ai/issues/2847
  - #2756: Streaming partial tool calls (91.8% match)
    https://github.com/vercel/ai/issues/2756

You: exit
```

### Programmatic Usage

```javascript
import { searchSimilarIssues, formatIssuesContext } from './rag.js';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Search for relevant issues
const relevantIssues = await searchSimilarIssues('streaming with tools', 5);

// Format context for LLM
const context = formatIssuesContext(relevantIssues);

// Use with Vercel AI SDK
const result = streamText({
  model: openai('gpt-4-turbo'),
  system: `You are a helpful assistant. Context: ${context}`,
  messages: [{ role: 'user', content: 'How do I use streaming?' }]
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Run Examples

Run pre-defined example queries:

```bash
node example.js
```

## Project Structure

```
github-issues-chatbot/
├── fetch-issues.js         # Fetches issues from GitHub
├── generate-embeddings.js  # Generates embeddings for issues
├── rag.js                  # RAG retrieval logic
├── chatbot.js              # Interactive chatbot
├── example.js              # Example queries
├── package.json
├── .env.example
├── issues-data.json        # Generated: Raw issue data
└── embeddings.json         # Generated: Issue embeddings
```

## How It Works

### 1. Data Fetching

The `fetch-issues.js` script uses Octokit to fetch issues from the vercel/ai repository, including:
- Title, body, labels, state
- Comments and metadata
- URLs and timestamps

### 2. Embedding Generation

The `generate-embeddings.js` script:
- Combines issue title, body, and comments into searchable text
- Uses OpenAI's `text-embedding-3-small` model
- Processes in batches for efficiency
- Stores embeddings with metadata

### 3. RAG Retrieval

The `rag.js` module implements:
- Cosine similarity search
- Query embedding generation
- Top-K retrieval of most relevant issues
- Context formatting for LLM consumption

### 4. Chatbot

The `chatbot.js` implements:
- Interactive CLI interface
- Streaming responses using Vercel AI SDK
- Conversation history management
- Real-time display of relevant issues

## API Reference

### `searchSimilarIssues(query, topK)`

Search for similar issues using vector similarity.

**Parameters:**
- `query` (string): The search query
- `topK` (number): Number of results to return (default: 5)

**Returns:** Array of relevant issues with similarity scores

### `formatIssuesContext(results)`

Format search results for LLM context.

**Parameters:**
- `results` (array): Results from `searchSimilarIssues`

**Returns:** Formatted string for LLM system prompt

## Customization

### Change the Repository

Edit `fetch-issues.js`:

```javascript
const { data: issues } = await octokit.rest.issues.listForRepo({
  owner: 'your-org',
  repo: 'your-repo',
  // ...
});
```

### Adjust Number of Retrieved Issues

Modify the `topK` parameter in `rag.js`:

```javascript
const relevantIssues = await searchSimilarIssues(userMessage, 10); // Get 10 issues
```

### Change the LLM Model

Update the model in `chatbot.js`:

```javascript
const result = streamText({
  model: openai('gpt-4o'), // or 'gpt-3.5-turbo', etc.
  // ...
});
```

### Use a Different Embedding Model

Modify `generate-embeddings.js` and `rag.js`:

```javascript
const embeddingModel = openai.embedding('text-embedding-3-large');
```

## Performance Considerations

- **Issue Limit**: Default limit is 200 issues. Remove the limit in `fetch-issues.js` for production
- **Batch Processing**: Embeddings are generated in batches of 100
- **Caching**: Embeddings are loaded once and cached in memory
- **Rate Limits**: Use a GitHub token to increase API rate limits

## Troubleshooting

### Rate Limiting

If you hit GitHub rate limits, add a `GITHUB_TOKEN` to your `.env` file.

### Memory Issues

For large repositories (>1000 issues), consider:
- Using a vector database (Pinecone, Weaviate, etc.)
- Implementing pagination in embeddings generation
- Increasing Node.js memory: `node --max-old-space-size=4096`

### Missing Dependencies

Make sure all dependencies are installed:

```bash
npm install
```

## License

MIT
