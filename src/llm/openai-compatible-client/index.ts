import OpenAI from 'openai';

import { formatDeployUpdate } from './deploy-update.js';
import { planLookup } from './lookup.js';
import { analyzeNews } from './news.js';
import { generateReply } from './reply.js';
import type {
  AnalyzeNewsInput,
  ChatCompletionsCreate,
  GenerateReplyInput,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult,
  LookupPlanResult,
  PlanLookupInput
} from './types.js';

export type {
  AnalyzeNewsInput,
  GenerateReplyInput,
  LlmClientConfig,
  LlmClientOptions,
  LlmReplyResult,
  LookupPlanResult,
  PlanLookupInput
} from './types.js';

export class OpenAiCompatibleLlmClient {
  private readonly client: OpenAI;
  private readonly createCompletion: ChatCompletionsCreate;

  constructor(
    private readonly config: LlmClientConfig,
    client?: OpenAI,
    private readonly options: LlmClientOptions = {}
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        maxRetries: 0
      });
    this.createCompletion = this.client.chat.completions.create.bind(
      this.client.chat.completions
    );
  }

  async planLookup(input: PlanLookupInput): Promise<LookupPlanResult> {
    return planLookup({
      config: this.config,
      createCompletion: this.createCompletion,
      options: this.options,
      input
    });
  }

  async generateReply(input: GenerateReplyInput): Promise<LlmReplyResult> {
    return generateReply({
      config: this.config,
      createCompletion: this.createCompletion,
      options: this.options,
      input
    });
  }

  async analyzeNews(input: AnalyzeNewsInput): Promise<LlmReplyResult> {
    return analyzeNews({
      config: this.config,
      createCompletion: this.createCompletion,
      options: this.options,
      input
    });
  }

  async formatDeployUpdate(input: {
    shortSha: string;
    commits: string[];
  }): Promise<LlmReplyResult> {
    return formatDeployUpdate({
      config: this.config,
      createCompletion: this.createCompletion,
      options: this.options,
      input
    });
  }
}
