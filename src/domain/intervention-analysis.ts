import type { ChatType, InterventionDecision } from "./models.js";
import type { DirectTrigger } from "./response-policy.js";

export function shouldConsiderIntervention(input: {
  chatType: ChatType;
  directTrigger: DirectTrigger;
  randomGatePassed: boolean;
}): boolean {
  return (
    (input.chatType === "group" || input.chatType === "supergroup") &&
    input.directTrigger === "none" &&
    input.randomGatePassed
  );
}

export function isFreshInterventionDecision(input: {
  analyzedThroughMessageId: number;
  latestMessageId: number;
}): boolean {
  return input.analyzedThroughMessageId === input.latestMessageId;
}

export type { InterventionDecision };
