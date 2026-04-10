import type { SocialIntentResult } from "./models.js";

const RELATIONSHIP_PATTERNS = [/что между/i, /какие отношения/i, /кто с кем/i];
const SUPPORT_PATTERNS = [/кто поддерживает/i];
const PARTICIPANT_DESCRIPTION_PATTERNS = [
  /(^|\s)опиши\s+/i,
  /(^|\s)расскажи\s+про\s+/i,
  /(^|\s)что\s+скаж(?:ешь|ете)\s+про\s+/i,
  /(^|\s)что\s+можешь\s+сказать\s+про\s+/i
];
const PARTICIPANT_STATUS_PATTERNS = [/что с\s+/i, /кто\s+/i];

export function detectSocialIntent(text: string): SocialIntentResult {
  if (RELATIONSHIP_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      isSocialQa: true,
      reason: "relationship_question"
    };
  }

  if (SUPPORT_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      isSocialQa: true,
      reason: "support_question"
    };
  }

  if (PARTICIPANT_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      isSocialQa: true,
      reason: "participant_description_request"
    };
  }

  if (PARTICIPANT_STATUS_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      isSocialQa: true,
      reason: "participant_status_question"
    };
  }

  return {
    isSocialQa: false,
    reason: null
  };
}
