// Deterministic ranked search over merged tools.
// Pure: no filesystem, no renderers, no regex built from input.

import { catalogError, compareCodeUnits } from './merge.js';
import { trimBoundary } from '../security/trim.js';

const MAX_QUERY_CODE_UNITS = 200;
const MAX_EMITTED_MATCHES = 1000;

// Trim per Normalization: ALL White_Space, Cc and Cf characters (property
// escapes; covers U+200B and friends).
const QUERY_COLLAPSE_RE = /\p{White_Space}+/gu;

function checkTool(tool) {
  if (
    tool === null ||
    typeof tool !== 'object' ||
    typeof tool.name !== 'string' ||
    typeof tool.serverOrdinal !== 'number' ||
    typeof tool.ordinal !== 'number' ||
    typeof tool.index !== 'number'
  ) {
    throw catalogError('invalid_snapshot');
  }
}

// searchTools(tools, query) -> {matches, total}
// Query: trim, collapse internal whitespace runs to one ASCII space,
// lowercase, split on whitespace into tokens; 1..200 code units,
// at least one token (usage_error otherwise; the CLI maps this to exit 3).
// Match: EVERY token is a case-insensitive (toLowerCase on both sides)
// substring of name, title, or description.
// Score: 100 per token in name + 10 per token in title + 1 per token in
// description. Ranking: score desc, then name code-unit, then server
// ordinal, then index. Emission cap 1,000; total is the true count.
export function searchTools(tools, query) {
  if (!Array.isArray(tools)) throw catalogError('invalid_snapshot');
  if (typeof query !== 'string') throw catalogError('usage_error');

  const trimmed = trimBoundary(query);
  if (trimmed.length < 1 || trimmed.length > MAX_QUERY_CODE_UNITS) {
    throw catalogError('usage_error');
  }
  const normalized = trimmed.replace(QUERY_COLLAPSE_RE, ' ').toLowerCase();
  const tokens = normalized.split(' ').filter((token) => token.length > 0);
  if (tokens.length === 0) throw catalogError('usage_error');

  const ranked = [];
  for (const tool of tools) {
    checkTool(tool);
    const nameLower = tool.name.toLowerCase();
    const titleLower = typeof tool.title === 'string' ? tool.title.toLowerCase() : '';
    const descLower = typeof tool.description === 'string' ? tool.description.toLowerCase() : '';

    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const inName = nameLower.includes(token);
      const inTitle = titleLower.includes(token);
      const inDesc = descLower.includes(token);
      if (!inName && !inTitle && !inDesc) {
        matched = false;
        break;
      }
      if (inName) score += 100;
      if (inTitle) score += 10;
      if (inDesc) score += 1;
    }
    if (matched) {
      ranked.push({ tool, score });
    }
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const byName = compareCodeUnits(a.tool.name, b.tool.name);
    if (byName !== 0) return byName;
    if (a.tool.serverOrdinal !== b.tool.serverOrdinal) return a.tool.serverOrdinal - b.tool.serverOrdinal;
    return a.tool.index - b.tool.index;
  });

  const total = ranked.length;
  const matches = ranked
    .slice(0, MAX_EMITTED_MATCHES)
    .map(({ tool, score }) => ({ tool: tool.tool, server: tool.server, score }));
  return { matches, total };
}
