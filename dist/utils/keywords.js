"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAndCleanKeywords = parseAndCleanKeywords;
exports.formatListAsNumbered = formatListAsNumbered;
function parseAndCleanKeywords(input) {
  const text = input.replace(/<@[^>]+>/g, '');
  const parts = text
    .split(/\n|,|;|\t/g)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(parts)).map((p) => p.replace(/\s+/g, ' '));
}
function formatListAsNumbered(keywords) {
  return keywords.join('\n');
}
