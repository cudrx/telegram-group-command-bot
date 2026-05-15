import type { AssistantIntent, AuthorizedMode } from '../../domain/models.js';
import type { ChatOrchestratorMediaSupport } from '../chat-orchestrator/media/index.js';
import type {
  ChatOrchestratorDeps,
  ReplyRequest
} from '../chat-orchestrator/types.js';

export type ActionContext = {
  deps: ChatOrchestratorDeps;
  mediaSupport: ChatOrchestratorMediaSupport;
  request: ReplyRequest;
  logger: ChatOrchestratorDeps['logger'];
};

export type ChatAction = {
  intent: AssistantIntent;
  commands: string[];
  modes: AuthorizedMode[];
  handle(ctx: ActionContext): Promise<void>;
};

export type ResolveCommandInput = {
  botUsername: string | null;
  mode?: AuthorizedMode;
  text: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
};

export type ResolvedAction = {
  action: ChatAction;
  commandText: string;
};

export type ActionRegistry = {
  resolveCommand(input: ResolveCommandInput): ResolvedAction | null;
};
