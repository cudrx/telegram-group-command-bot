import type {
  ParticipantAliasRecord,
  ParticipantReferenceResolution,
  ResolvedParticipant
} from "./models.js";

const WORD_PATTERN = /@?[\p{L}\p{N}_-]+/gu;
const CASE_ENDINGS = [
  "ами",
  "ями",
  "ого",
  "ему",
  "ому",
  "ыми",
  "ими",
  "ом",
  "ем",
  "ой",
  "ей",
  "ам",
  "ям",
  "ах",
  "ях",
  "а",
  "я",
  "у",
  "ю",
  "е",
  "ы",
  "и"
];

export function normalizeAlias(text: string): string {
  return text.trim().toLowerCase().replace(/^@+/, "").replace(/ё/g, "е").replace(/\s+/g, " ");
}

export function extractReferenceCandidates(text: string): string[] {
  const normalized = text.replace(/[!?.,:;()"']/g, " ");
  const tokens = Array.from(normalized.matchAll(WORD_PATTERN), (match) => match[0] ?? "");
  const candidates = new Set<string>();

  for (const token of tokens) {
    const base = normalizeAlias(token);

    if (!base || isNoiseToken(base)) {
      continue;
    }

    candidates.add(base);

    for (const variant of buildInflectionVariants(base)) {
      candidates.add(variant);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = normalizeAlias(tokens[index] ?? "");
    const right = normalizeAlias(tokens[index + 1] ?? "");

    if (!left || !right || isNoiseToken(left) || isNoiseToken(right)) {
      continue;
    }

    candidates.add(`${left} ${right}`);
  }

  return Array.from(candidates);
}

export function resolveParticipantReferences(input: {
  text: string;
  aliases: ParticipantAliasRecord[];
}): ParticipantReferenceResolution {
  const aliasMap = new Map<string, ParticipantAliasRecord[]>();

  for (const alias of input.aliases) {
    const key = normalizeAlias(alias.aliasNormalized);
    const bucket = aliasMap.get(key) ?? [];
    bucket.push(alias);
    aliasMap.set(key, bucket);
  }

  const resolved = new Map<number, ResolvedParticipant>();
  const ambiguousParticipants: ParticipantReferenceResolution["ambiguousParticipants"] = [];
  const unresolvedCandidates: string[] = [];

  for (const candidate of extractReferenceCandidates(input.text)) {
    const matches = aliasMap.get(candidate) ?? [];

    if (matches.length === 0) {
      unresolvedCandidates.push(candidate);
      continue;
    }

    if (matches.length === 1) {
      const [match] = matches;

      if (match) {
        resolved.set(match.userId, {
          userId: match.userId,
          displayName: match.displayName
        });
      }

      continue;
    }

    ambiguousParticipants.push({
      candidate,
      matches: dedupeParticipants(matches)
    });
  }

  return {
    resolvedParticipants: Array.from(resolved.values()),
    ambiguousParticipants,
    unresolvedCandidates: Array.from(new Set(unresolvedCandidates))
  };
}

function dedupeParticipants(matches: ParticipantAliasRecord[]): ResolvedParticipant[] {
  const participants = new Map<number, ResolvedParticipant>();

  for (const match of matches) {
    participants.set(match.userId, {
      userId: match.userId,
      displayName: match.displayName
    });
  }

  return Array.from(participants.values());
}

function buildInflectionVariants(token: string): string[] {
  for (const ending of CASE_ENDINGS) {
    if (!token.endsWith(ending) || token.length <= ending.length + 1) {
      continue;
    }

    return [token.slice(0, -ending.length)];
  }

  return [];
}

function isNoiseToken(token: string): boolean {
  return token.length < 2 || /^[0-9]+$/.test(token) || token === "fun_bot";
}
