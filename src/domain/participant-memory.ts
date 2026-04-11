import type {
  ParticipantMemory,
  ParticipantMemorySourceKind,
  ParticipantMemoryStability,
  ParticipantMemoryUpdate
} from "./models.js";

const VOLATILE_MEMORY_TTL_MS = 21 * 24 * 60 * 60 * 1000;
const CONTEXT_LIMIT = 6;
const RESOLVED_MEMORY_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const SENSITIVE_MEMORY_KEYS = new Set([
  "ethnicity",
  "nationality",
  "religion",
  "politics",
  "political_view",
  "health",
  "medical_condition",
  "sexual_orientation",
  "gender_identity"
]);
export function normalizeParticipantMemoryKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function normalizeParticipantMemoryValue(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 240);
}

export function clampParticipantMemoryConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, confidence));
}

export function shouldRejectParticipantMemoryUpdate(
  update: ParticipantMemoryUpdate
): boolean {
  return shouldRejectMemoryUpdate(update);
}

export function isSensitiveParticipantMemoryKey(key: string): boolean {
  return SENSITIVE_MEMORY_KEYS.has(normalizeParticipantMemoryKey(key));
}

function shouldRejectMemoryUpdate(
  update: Pick<
    ParticipantMemoryUpdate,
    "key" | "valueText" | "sourceKind" | "confidence"
  >
): boolean {
  const normalizedKey = normalizeParticipantMemoryKey(update.key);
  const normalizedValue = normalizeParticipantMemoryValue(update.valueText);

  if (normalizedKey.length === 0 || normalizedValue.length === 0) {
    return true;
  }

  if (
    isSensitiveParticipantMemoryKey(normalizedKey) &&
    update.sourceKind !== "explicit"
  ) {
    return true;
  }

  return clampParticipantMemoryConfidence(update.confidence) < 0.35;
}

export function getParticipantMemoryExpiresAt(
  stability: ParticipantMemoryStability,
  observedAt: string
): string | null {
  if (stability !== "volatile") {
    return null;
  }

  const observed = Date.parse(observedAt);

  if (Number.isNaN(observed)) {
    return null;
  }

  return new Date(observed + VOLATILE_MEMORY_TTL_MS).toISOString();
}

export function getResolvedMemoryRetentionCutoff(now: string): string | null {
  const parsed = Date.parse(now);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed - RESOLVED_MEMORY_RETENTION_MS).toISOString();
}

export function pickStrongerMemorySource(
  current: ParticipantMemorySourceKind,
  incoming: ParticipantMemorySourceKind
): ParticipantMemorySourceKind {
  return getSourceWeight(incoming) > getSourceWeight(current) ? incoming : current;
}

export function pickMoreStableMemoryStability(
  current: ParticipantMemoryStability,
  incoming: ParticipantMemoryStability
): ParticipantMemoryStability {
  return getStabilityWeight(incoming) > getStabilityWeight(current) ? incoming : current;
}

export function isParticipantMemoryVisibleInContext(
  memory: Pick<ParticipantMemory, "status" | "expiresAt">,
  now: string
): boolean {
  if (memory.status !== "active") {
    return false;
  }

  if (memory.expiresAt === null) {
    return true;
  }

  const expiresAt = Date.parse(memory.expiresAt);
  const currentTime = Date.parse(now);

  if (Number.isNaN(expiresAt) || Number.isNaN(currentTime)) {
    return true;
  }

  return expiresAt > currentTime;
}

export function buildParticipantMemoryDigest(
  memories: ParticipantMemory[],
  now: string,
  limit = CONTEXT_LIMIT
): string | null {
  const visible = memories
    .filter((memory) => isParticipantMemoryVisibleInContext(memory, now))
    .sort(compareParticipantMemoriesForContext)
    .slice(0, limit);

  if (visible.length === 0) {
    return null;
  }

  return visible
    .map((memory) => `[${memory.stability}] ${memory.key}: ${memory.valueText}`)
    .join("; ");
}

function compareParticipantMemoriesForContext(
  left: ParticipantMemory,
  right: ParticipantMemory
): number {
  if (left.isPinned !== right.isPinned) {
    return Number(right.isPinned) - Number(left.isPinned);
  }

  const stabilityDiff =
    getStabilityWeight(right.stability) - getStabilityWeight(left.stability);

  if (stabilityDiff !== 0) {
    return stabilityDiff;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  return compareIsoDates(right.lastConfirmedAt ?? right.lastSeenAt, left.lastConfirmedAt ?? left.lastSeenAt);
}

function getSourceWeight(sourceKind: ParticipantMemorySourceKind): number {
  switch (sourceKind) {
    case "explicit":
      return 3;
    case "observed":
      return 2;
    case "inferred":
      return 1;
  }
}

function getStabilityWeight(stability: ParticipantMemoryStability): number {
  switch (stability) {
    case "core":
      return 3;
    case "durable":
      return 2;
    case "volatile":
      return 1;
  }
}

function compareIsoDates(left: string, right: string): number {
  const leftParsed = Date.parse(left);
  const rightParsed = Date.parse(right);

  if (Number.isNaN(leftParsed) || Number.isNaN(rightParsed)) {
    return 0;
  }

  return leftParsed - rightParsed;
}
