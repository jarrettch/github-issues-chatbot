# GitHub Issues RAG Chatbot

A chatbot that uses RAG (Retrieval Augmented Generation) with embeddings to answer questions about GitHub issues from the Vercel AI SDK repository.

## Features

- Fetches issues from the `vercel/ai` GitHub repository
- Generates embeddings using OpenAI's `text-embedding-3-small` model
- Implements vector similarity search for relevant issue retrieval
- **Explicit issue lookup**: Automatically detects and retrieves issues mentioned by number (e.g., "#1234", "issue 5678")
- **Conversation-aware retrieval**: Maintains conversation context to improve search relevance across multiple turns
- Interactive chatbot using Vercel AI SDK with streaming responses
- Smart text truncation to handle long issue threads within embedding model limits

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
import { searchSimilarIssuesWithExplicit, formatIssuesContext } from './rag.js';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Search for relevant issues (includes explicit issue number lookup)
const relevantIssues = await searchSimilarIssuesWithExplicit('streaming with tools in #2847', 5);

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

## Advanced Features

### Explicit Issue Lookup

The chatbot automatically detects when you mention specific issue numbers and retrieves them directly, ensuring they're always included in the context:

```
You: Tell me about issue #10485

🔍 Searching for relevant issues...
✓ Found 5 relevant issues

📚 Referenced Issues:
  - #10485: Anthropic: implement context_management (Explicitly mentioned)
  - #10334: Support for context editing on anthropic (57.1% match)
  ...
```

**Supported formats:**
- `#1234`
- `issue 1234`
- `issue #1234`

### Conversation-Aware Retrieval

The chatbot maintains conversation context across turns. When you ask follow-up questions, it includes recent conversation history in the search query to retrieve more relevant issues:

```
You: How do I use streaming?
Assistant: [Discusses streaming in general...]

You: What about with tool calls?
# The search automatically includes "streaming" context from previous turn
# This prevents the "I don't have that information" problem
```

**How it works:**
- Keeps last 2 conversation turns (4 messages) as context
- Combines conversation context with current query
- Performs hybrid search (explicit + semantic)
- Maintains topic continuity across the conversation

### Smart Text Truncation

Long issue threads are automatically truncated to fit within the embedding model's 8,192 token limit:

- Preserves title, metadata, and issue description
- Includes early comments (most valuable content)
- Truncates at ~6,000 tokens with clear marker
- Prevents embedding API errors while maintaining searchability

### Linked Pull Request Extraction

The chatbot automatically detects and tracks PR references, even when they're mentioned in truncated content:

**Detection Methods:**
1. **Comment Regex** - Finds PR mentions in issue body and comments:
   - `#1234` - Hash notation
   - `PR 5678`, `pull request 9012` - Natural language
   - `https://github.com/vercel/ai/pull/1234` - Full URLs
   - `vercel/ai#1234` - Repo notation

2. **Timeline Events** - Captures system-generated cross-references:
   - PRs linked via "Fixes #123", "Closes #456" in PR descriptions
   - Shows as "user linked a pull request" on GitHub web interface
   - Extracted from GitHub's timeline API

**Result:** PR links are preserved in metadata and shown to the LLM, even if the comment mentioning them was truncated. Zero additional embedding cost.

```
[Issue #10485] Anthropic: implement context_management
...
Linked PRs: https://github.com/vercel/ai/pull/10540
...
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
- **Linked Pull Requests** - Automatically extracts PR references from:
  - Issue body and comments (regex patterns for "#1234", "PR 5678", etc.)
  - Timeline events (cross-referenced PRs linked via "Fixes #123" in PR descriptions)
  - All formats: GitHub URLs, mentions, and repo#number notation

### 2. Embedding Generation

The `generate-embeddings.js` script:
- Combines issue title, body, and comments into searchable text
- Uses OpenAI's `text-embedding-3-small` model
- Processes in batches for efficiency
- Stores embeddings with metadata

### 3. RAG Retrieval

The `rag.js` module implements:
- **Cosine similarity search** - Compares query embeddings with stored issue embeddings
- **Explicit issue number detection** - Extracts issue numbers from queries (e.g., "#1234", "issue 5678")
- **Hybrid retrieval** - Combines explicitly mentioned issues with semantically similar results
- **Top-K retrieval** - Returns most relevant issues up to specified limit
- **Context formatting** - Prepares issue data for LLM consumption with metadata

### 4. Chatbot

The `chatbot.js` implements:
- **Interactive CLI interface** - Real-time chat with readline
- **Conversation-aware search** - Uses recent conversation history to improve retrieval relevance
- **Streaming responses** - Real-time token-by-token output using Vercel AI SDK
- **Conversation history management** - Maintains multi-turn context
- **Explicit issue tracking** - Shows when issues are explicitly mentioned vs semantically matched

## API Reference

### `searchSimilarIssues(query, topK)`

Search for similar issues using vector similarity only.

**Parameters:**
- `query` (string): The search query
- `topK` (number): Number of results to return (default: 5)

**Returns:** Array of relevant issues with similarity scores

### `searchSimilarIssuesWithExplicit(query, topK)`

**Recommended**: Search for issues using hybrid retrieval (explicit + semantic).

Automatically detects issue numbers mentioned in the query (e.g., "#1234", "issue 5678") and includes them in results alongside semantically similar issues.

**Parameters:**
- `query` (string): The search query (may contain issue numbers)
- `topK` (number): Number of results to return (default: 5)

**Returns:** Array of relevant issues with similarity scores and `explicit` flag

**Example:**
```javascript
const results = await searchSimilarIssuesWithExplicit('What does #10485 say about context management?', 5);
// Returns: issue #10485 (explicit: true) + 4 semantically related issues
```

### `extractIssueNumbers(text)`

Extract issue numbers from text.

**Parameters:**
- `text` (string): Text that may contain issue references

**Returns:** Array of issue numbers (integers)

**Patterns matched:**
- `#1234` - Hash notation
- `issue 1234` - Natural language
- `issue #1234` - Combined notation

### `getIssuesByNumber(issueNumbers)`

Retrieve specific issues by their numbers.

**Parameters:**
- `issueNumbers` (array): Array of issue numbers to retrieve

**Returns:** Array of matching issues with `explicit: true` flag

### `formatIssuesContext(results)`

Format search results for LLM context.

**Parameters:**
- `results` (array): Results from search functions

**Returns:** Formatted string for LLM system prompt with issue metadata and content

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

