import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import OpenAI from 'openai';
import {
  buildNewsAnalysisPrompt,
  renderNewsPostsBySource,
  renderNewsSourcesPolicy
} from '../src/app/actions/news/render.js';
import { fetchTelegramChannelPosts } from '../src/app/actions/news/scraper.js';
import { selectNewsPostsForDigest } from '../src/app/actions/news/source-policy.js';
import type { NewsPost } from '../src/app/actions/news/types.js';
import { newsActionConfig } from '../src/config/runtime/index.js';
import { parseEvalEnv } from './evaluate-intents/env.js';

export function buildNewsEvalPrompt(input: {
  now: string;
  posts: NewsPost[];
}): {
  prompt: string;
  selectedCount: number;
  sourceCounts: Record<string, number>;
} {
  const sources = [...newsActionConfig.sources];
  const selection = selectNewsPostsForDigest({
    sources,
    posts: input.posts,
    now: input.now
  });
  const prompt = buildNewsAnalysisPrompt({
    currentDateTime: input.now,
    analysisPeriod: selection.analysisPeriod,
    sourcesPolicy: renderNewsSourcesPolicy(sources),
    postsBySource: renderNewsPostsBySource({
      sources,
      bySource: selection.bySource
    })
  });
  const sourceCounts = Object.fromEntries(
    sources.map((source) => [
      source.slug,
      selection.bySource.get(source.slug)?.length ?? 0
    ])
  );

  return {
    prompt,
    selectedCount: selection.selectedPosts.length,
    sourceCounts
  };
}

export async function main(): Promise<number> {
  const env = parseEvalEnv(process.env);
  const now = new Date().toISOString();
  const sources = [...newsActionConfig.sources];
  const posts = [];
  const failedSources: Array<{ source: string; error: string }> = [];

  for (const source of sources) {
    try {
      posts.push(
        ...(await fetchTelegramChannelPosts({
          fetch: globalThis.fetch,
          source,
          now,
          timeoutMs: newsActionConfig.fetchTimeoutMs,
          maxResponseChars: newsActionConfig.maxResponseChars,
          userAgent: newsActionConfig.userAgent
        }))
      );
    } catch (error) {
      failedSources.push({
        source: source.handle,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const newsEvalPrompt = buildNewsEvalPrompt({ now, posts });

  const client = new OpenAI({
    apiKey: env.llmApiKey,
    baseURL: env.llmBaseUrl
  });
  const completion = await client.chat.completions.create({
    model: env.llmReplyModel,
    temperature: env.llmReplyTemperature,
    messages: [
      {
        role: 'system',
        content: 'You are a neutral analytical assistant. Answer in Russian.'
      },
      {
        role: 'user',
        content: newsEvalPrompt.prompt
      }
    ]
  });
  const response = completion.choices[0]?.message.content?.trim() ?? '';
  const timestamp = now.replace(/[:.]/g, '-');
  const outputDir = path.join('.eval-runs', timestamp);
  const sourceCounts = newsEvalPrompt.sourceCounts;

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'news-analysis.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: env.llmReplyModel,
        failedSources,
        sourceCounts,
        prompt: newsEvalPrompt.prompt,
        response
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    path.join(outputDir, 'news-analysis.md'),
    [
      '# News Analysis Eval',
      '',
      `Model: ${env.llmReplyModel}`,
      `Prompt chars: ${newsEvalPrompt.prompt.length}`,
      `Response chars: ${response.length}`,
      '',
      'Source counts:',
      ...Object.entries(sourceCounts).map(
        ([source, count]) => `- ${source}: ${count}`
      ),
      '',
      failedSources.length > 0
        ? [
            'Failed sources:',
            ...failedSources.map((item) => `- ${item.source}: ${item.error}`),
            ''
          ].join('\n')
        : '',
      '## Response',
      '',
      response,
      '',
      '## Prompt',
      '',
      '```text',
      newsEvalPrompt.prompt,
      '```'
    ].join('\n'),
    'utf8'
  );

  console.log(
    `Fetched ${posts.length} post(s); selected ${newsEvalPrompt.selectedCount}.`
  );
  console.log(`Source counts: ${JSON.stringify(sourceCounts)}`);
  console.log(`Saved news eval results to ${outputDir}`);

  if (response.length === 0) {
    process.exitCode = 1;
    console.error('News eval returned an empty LLM response.');
  }

  return typeof process.exitCode === 'number' ? process.exitCode : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
