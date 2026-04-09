import { clamp } from "./utils.js";

const FEAT_REGEX = /\b(feat|ft|featuring)\b.*$/i;
const VERSION_REGEX = /\(([^)]*(live|edit|version|mix|remaster|deluxe|explicit)[^)]*)\)|\[([^\]]*(live|edit|version|mix|remaster|deluxe|explicit)[^\]]*)\]/gi;

export function normalizeText(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(FEAT_REGEX, "")
    .replace(VERSION_REGEX, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapseInitialisms(normalized);
}

export function tokenize(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

export function tokenSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

export function stringSimilarity(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  return Math.max(tokenSimilarity(normalizedLeft, normalizedRight), diceCoefficient(normalizedLeft, normalizedRight));
}

function diceCoefficient(left, right) {
  if (left.length < 2 || right.length < 2) {
    return left === right ? 1 : 0;
  }
  const leftPairs = buildBigrams(left);
  const rightPairs = buildBigrams(right);
  const rightMap = new Map();
  for (const pair of rightPairs) {
    rightMap.set(pair, (rightMap.get(pair) ?? 0) + 1);
  }
  let matches = 0;
  for (const pair of leftPairs) {
    const count = rightMap.get(pair) ?? 0;
    if (count > 0) {
      matches += 1;
      rightMap.set(pair, count - 1);
    }
  }
  return (2 * matches) / (leftPairs.length + rightPairs.length);
}

function buildBigrams(value) {
  const output = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    output.push(value.slice(index, index + 2));
  }
  return output;
}

function collapseInitialisms(value) {
  const tokens = value.split(" ").filter(Boolean);
  const output = [];
  let initialsBuffer = [];
  for (const token of tokens) {
    if (token.length === 1) {
      initialsBuffer.push(token);
      continue;
    }
    if (initialsBuffer.length > 0) {
      output.push(initialsBuffer.join(""));
      initialsBuffer = [];
    }
    output.push(token);
  }
  if (initialsBuffer.length > 0) {
    output.push(initialsBuffer.join(""));
  }
  return output.join(" ");
}

export function durationSimilarity(leftMs, rightMs) {
  if (!leftMs || !rightMs) {
    return 0;
  }
  const delta = Math.abs(Number(leftMs) - Number(rightMs));
  if (delta <= 1500) {
    return 1;
  }
  if (delta <= 3000) {
    return 0.92;
  }
  if (delta <= 5000) {
    return 0.82;
  }
  if (delta <= 8000) {
    return 0.65;
  }
  if (delta <= 12000) {
    return 0.45;
  }
  return clamp(1 - delta / 60000, 0, 0.35);
}
