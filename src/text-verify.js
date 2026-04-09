import { normalizeText, stringSimilarity } from "./text.js";

export function averageStringListSimilarity(leftItems, rightItems) {
  const leftNormalized = (leftItems ?? []).map((item) => normalizeText(item)).filter(Boolean);
  const rightNormalized = (rightItems ?? []).map((item) => normalizeText(item)).filter(Boolean);
  if (leftNormalized.length === 0 || rightNormalized.length === 0) {
    return 0;
  }
  let total = 0;
  for (const left of leftNormalized) {
    total += Math.max(...rightNormalized.map((right) => stringSimilarity(left, right)));
  }
  return total / leftNormalized.length;
}

export { normalizeText, stringSimilarity };
