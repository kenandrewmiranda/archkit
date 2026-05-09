// Decision-language detection for the v1.6 Stop hook.
//
// Goal: catch the moment an assistant turn commits to a non-trivial choice
// ("we'll go with Postgres over SQLite because…") so the Stop hook can
// auto-draft a proposed ADR. Calibrated for HIGH PRECISION over recall —
// false positives spam .arch/decisions/proposed/ and erode trust faster
// than missed decisions hurt.
//
// Targets per v1.6 design: >85% precision AND >40% recall.
//
// Patterns are intentionally conservative. Weak signals like "should we use",
// "what about X", "X vs Y", "consider X" are NOT matched — those are
// exploration, not commitment.

import crypto from "node:crypto";

// Each pattern: { name, regex, description }.
// All patterns case-insensitive (regex `i` flag) except commit_over_because
// which depends on capital-letter constraint to avoid false positives.
//
// Word-boundary anchors keep them from matching inside identifiers.
// `we should` matches; `should we` does not (different word order).
export const PATTERNS = [
  {
    name: "commit_we",
    regex: /\bwe(?:'ll| will| should| are going to) (?:use|go with|pick|adopt|choose|migrate to|switch to|build with)\b/gi,
    description: "first-person plural commitment ('we'll use X', 'we should adopt X')",
  },
  {
    name: "commit_first_person",
    regex: /\b(?:I'll|I will|I am going to|I'm going to) (?:use|go with|pick|adopt|choose|migrate to|switch to|build with)\b/gi,
    description: "first-person singular commitment ('I'll go with X')",
  },
  {
    name: "commit_imperative",
    regex: /\b(?:going with|going to use|let's (?:use|go with|pick|adopt|choose))\b/gi,
    description: "implied commitment ('going with X', \"let's use X\")",
  },
  {
    name: "commit_decided",
    regex: /\bdecided (?:to use|on|against|to go with)\b/gi,
    description: "explicit decision marker ('decided to use', 'decided against')",
  },
  {
    name: "commit_right_choice",
    regex: /\b(?:the right (?:pick|answer|choice) (?:is|here is)|right answer is|best (?:option|choice) (?:is|here is))\b/gi,
    description: "evaluative resolution ('the right answer is X')",
  },
  {
    name: "commit_tradeoff",
    regex: /\b(?:the tradeoff is|tradeoff here is|the cost (?:is|of))\b/gi,
    description: "tradeoff articulation (often signals decision in flight)",
  },
  {
    name: "commit_over_because",
    // X over Y because Z. Capital-letter constraint on Y avoids matching
    // "win over the user because" etc.
    regex: /\bover (?:[A-Z][a-zA-Z0-9-]+|the alternative)\b.{0,80}\bbecause\b/g,
    description: "X over Y because Z — comparative commitment",
  },
];

// Find the sentence containing offset `idx` within `text`. Sentence boundary
// = . ! ? followed by whitespace + capital, or newline.
function extractSentence(text, idx) {
  const before = text.slice(0, idx);
  const after = text.slice(idx);

  const startMatches = [...before.matchAll(/[.!?\n]\s+(?=[A-Z]|$)/g)];
  let start = 0;
  if (startMatches.length) {
    const last = startMatches[startMatches.length - 1];
    start = last.index + last[0].length;
  }

  const endMatch = after.match(/[.!?](?:\s|$)/);
  let end = after.length;
  if (endMatch) end = endMatch.index + 1;

  return text.slice(start, idx + end).trim();
}

// Return up to ~800 chars of context centered on `idx`. Used for the
// proposal's contextExcerpt field.
function extractExcerpt(text, idx, matchLen) {
  const radius = 400;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + matchLen + radius);
  return text.slice(start, end).trim();
}

function hashMatch(titleHint, regexMatch) {
  return crypto
    .createHash("sha1")
    .update(`${titleHint}::${regexMatch}`)
    .digest("hex")
    .slice(0, 12);
}

// Sentences that look like questions or open exploration are exploration,
// not commitment. We filter them post-match rather than encoding the negation
// in every regex.
const QUESTION_OPENERS = /^(?:what about|what if|should we|could we|would we|would it|is it|are we|do we|can we|how about|what's the|whats the)\b/i;

function looksLikeQuestion(sentence) {
  if (!sentence) return false;
  const trimmed = sentence.trim();
  if (trimmed.endsWith("?")) return true;
  if (QUESTION_OPENERS.test(trimmed)) return true;
  return false;
}

export function detectDecisions(text) {
  if (!text || typeof text !== "string") return [];

  const results = [];
  const seenHashes = new Set();

  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern.regex)) {
      const idx = m.index;
      const matchedText = m[0];
      const sentence = extractSentence(text, idx);
      if (looksLikeQuestion(sentence)) continue;
      const titleHint = sentence.slice(0, 100);
      const hash = hashMatch(titleHint, matchedText);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      results.push({
        hash,
        patternName: pattern.name,
        matchedText,
        titleHint,
        contextExcerpt: extractExcerpt(text, idx, matchedText.length),
        source: "stop-hook",
      });
    }
  }

  return results;
}

export const _internals = { extractSentence, extractExcerpt, hashMatch, looksLikeQuestion };
