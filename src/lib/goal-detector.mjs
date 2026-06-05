// Deferred-/follow-up-work detection for the Stop hook (v1.9).
//
// Goal: catch the moment an assistant turn names work it is NOT doing now but
// that should happen later ("out of scope for this PR", "follow-up: wire up
// retries", "we'll handle pagination in a separate goal") so the Stop hook can
// auto-draft a PROPOSED goal to .arch/goals/proposed/<hash>.json. A later
// session reviews them via /mcp__archkit__goal_review and promotes the chosen
// ones into planned goals.
//
// Mirrors decision-detector.mjs deliberately: same hash/excerpt/dedup shape,
// same HIGH-PRECISION-over-recall calibration. False positives spam the queue
// and erode trust faster than missed follow-ups hurt, so patterns are
// conservative — exploratory "should we…?" questions are filtered out.

import crypto from "node:crypto";

// Each pattern: { name, regex, description }. Case-insensitive.
// Anchored on explicit deferral language, not vague future tense.
export const PATTERNS = [
  {
    name: "defer_followup_label",
    regex: /\b(?:follow[- ]?up|followup|next step|todo|to-do)\s*:/gi,
    description: "explicit follow-up/TODO label ('Follow-up:', 'TODO:')",
  },
  {
    name: "defer_out_of_scope",
    regex: /\bout of scope\b[^.\n]{0,60}?\b(?:for (?:now|this|here)|of this (?:pr|change|goal|task))\b/gi,
    description: "scoping-out ('out of scope for now', 'out of scope of this PR')",
  },
  {
    name: "defer_later_session",
    regex: /\bin a (?:follow[- ]?up|future|later|separate) (?:session|pr|change|goal|task|commit)\b/gi,
    description: "explicit deferral to later unit ('in a follow-up PR', 'in a separate goal')",
  },
  {
    name: "defer_separate_unit",
    regex: /\b(?:should be|belongs in|deserves|warrants) (?:a|its own) (?:separate|follow[- ]?up|future) (?:goal|task|pr|change|effort)\b/gi,
    description: "calls for a separate unit of work",
  },
  {
    name: "defer_punt",
    regex: /\b(?:punt(?:ing)? on|defer(?:ring)?|leave (?:it )?for later|come back to|circle back (?:to|on)|revisit later)\b/gi,
    description: "explicit punt ('punting on X', 'leave for later', 'circle back')",
  },
  {
    name: "defer_not_now",
    regex: /\b(?:we(?:'ll)?|i(?:'ll)?) (?:should )?(?:handle|address|tackle|do|implement|wire up|build) (?:this|that|it|[^.\n]{0,40}) (?:later|eventually|in a follow[- ]?up|next time)\b/gi,
    description: "explicit not-now commitment ('we'll handle that later')",
  },
];

function extractSentence(text, idx) {
  const before = text.slice(0, idx);
  const after = text.slice(idx);
  const startMatches = [...before.matchAll(/[.!?\n]\s+(?=[A-Z]|$)/g)];
  let start = 0;
  if (startMatches.length) {
    const last = startMatches[startMatches.length - 1];
    start = last.index + last[0].length;
  }
  const endMatch = after.match(/[.!?\n](?:\s|$)/);
  let end = after.length;
  if (endMatch) end = endMatch.index + 1;
  return text.slice(start, idx + end).trim();
}

function extractExcerpt(text, idx, matchLen) {
  const radius = 400;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + matchLen + radius);
  return text.slice(start, end).trim();
}

function hashMatch(titleHint, regexMatch) {
  return crypto.createHash("sha1").update(`${titleHint}::${regexMatch}`).digest("hex").slice(0, 12);
}

// Questions and hypotheticals are exploration, not a committed deferral.
const QUESTION_OPENERS = /^(?:should we|could we|would we|do we|can we|what about|what if|is it worth|are we going to)\b/i;
function looksLikeQuestion(sentence) {
  if (!sentence) return false;
  const trimmed = sentence.trim();
  if (trimmed.endsWith("?")) return true;
  if (QUESTION_OPENERS.test(trimmed)) return true;
  return false;
}

// Turn the matched sentence into a short imperative-ish title for the proposal.
// Strips the deferral framing so "Follow-up: add retry logic" → "add retry logic".
function titleFromSentence(sentence, matchedText) {
  let t = sentence.replace(/\s+/g, " ").trim();
  // Drop a leading "Follow-up:" / "TODO:" label if present.
  t = t.replace(/^(?:follow[- ]?up|followup|next step|todo|to-do)\s*:\s*/i, "");
  return t.slice(0, 100);
}

export function detectDeferredGoals(text) {
  if (!text || typeof text !== "string") return [];
  const results = [];
  const seenHashes = new Set();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern.regex)) {
      const idx = m.index;
      const matchedText = m[0];
      const sentence = extractSentence(text, idx);
      if (looksLikeQuestion(sentence)) continue;
      const titleHint = titleFromSentence(sentence, matchedText);
      if (titleHint.length < 8) continue; // too thin to be a useful goal
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

export const _internals = { extractSentence, extractExcerpt, hashMatch, looksLikeQuestion, titleFromSentence };
