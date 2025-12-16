'use client';

import { useChat } from 'ai/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Send, Github, Loader2 } from 'lucide-react';

interface RelevantIssue {
  number: number;
  title: string;
  url: string;
  similarity: number;
  explicit?: boolean;
  linked_prs?: number[];
}

export default function Home() {
  const [relevantIssues, setRelevantIssues] = useState<RelevantIssue[]>([]);
  const [lastQuery, setLastQuery] = useState('');

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    streamProtocol: 'text',
  });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = input.trim();

    if (!query) return;

    // Store the query before form submission clears it
    setLastQuery(query);

    // Submit the form
    handleSubmit(e);

    // Fetch relevant issues in parallel
    try {
      const response = await fetch('/api/relevant-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      setRelevantIssues(data.issues);
    } catch (error) {
      console.error('Failed to fetch relevant issues:', error);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 py-8 h-screen flex flex-col">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-white/5 rounded-lg border border-white/10">
              <Github className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Vercel AI SDK</h1>
              <p className="text-sm text-zinc-400">Issues Assistant</p>
            </div>
          </div>
          <p className="text-zinc-500 text-sm">
            Ask questions about issues in the vercel/ai repository
          </p>
        </div>

        {/* Main Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
          {/* Chat Area */}
          <Card className="lg:col-span-2 flex flex-col bg-white/5 border-white/10 overflow-hidden">
            <CardHeader className="border-b border-white/10 flex-shrink-0">
              <CardTitle className="text-white">Chat</CardTitle>
              <CardDescription className="text-zinc-400">
                Ask about issues, PRs, features, or bugs
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 min-h-0">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto pr-4 mb-4 min-h-0">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-muted-foreground">
                    <div>
                      <p className="text-lg mb-2">No messages yet</p>
                      <p className="text-sm">Try asking: &quot;What are the most recent issues?&quot;</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${
                          message.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            message.role === 'user'
                              ? 'bg-blue-600 text-white'
                              : 'bg-zinc-900 text-white border border-white/10'
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-zinc-900 border border-white/10 rounded-lg px-4 py-2">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Input */}
              <form onSubmit={onSubmit} className="flex gap-2 flex-shrink-0">
                <Input
                  value={input}
                  onChange={handleInputChange}
                  placeholder="Ask about an issue..."
                  disabled={isLoading}
                  className="flex-1 text-white"
                />
                <Button type="submit" disabled={isLoading || !input.trim()} className="bg-blue-600 hover:bg-blue-700">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Referenced Issues Sidebar */}
          <Card className="flex flex-col bg-white/5 border-white/10 overflow-hidden">
            <CardHeader className="border-b border-white/10 flex-shrink-0">
              <CardTitle className="text-white">Referenced Issues</CardTitle>
              <CardDescription className="text-zinc-400">
                Issues found for your question
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-4 min-h-0">
              <div className="h-full overflow-y-auto pr-4">
                {relevantIssues.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground pt-8">
                    Ask a question to see relevant issues
                  </div>
                ) : (
                  <div className="space-y-4">
                    {relevantIssues.map((issue) => (
                      <div key={issue.number} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-400 hover:text-blue-300 hover:underline flex-1"
                          >
                            #{issue.number}: {issue.title}
                          </a>
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {issue.explicit ? (
                            <Badge variant="default" className="text-xs bg-blue-600 hover:bg-blue-700">
                              Explicitly mentioned
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30">
                              {(issue.similarity * 100).toFixed(1)}% match
                            </Badge>
                          )}
                        </div>

                        {issue.linked_prs && issue.linked_prs.length > 0 && (
                          <>
                            <Separator />
                            <div className="text-xs text-muted-foreground">
                              <p className="font-medium mb-1">Linked PRs:</p>
                              <div className="space-y-1">
                                {issue.linked_prs.map((pr) => (
                                  <a
                                    key={pr}
                                    href={`https://github.com/vercel/ai/pull/${pr}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-blue-400 hover:text-blue-300 hover:underline"
                                  >
                                    #{pr}
                                  </a>
                                ))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
