import { diceCoefficient } from "dice-coefficient";
import { isEmptyObject, maxBy, orderBy, uniq } from "es-toolkit";
import type { CatalogEntry } from "./catalog";
import type { Target } from "./config";

export type ScoredMatch = {
  candidate: CatalogEntry;
  modelScore: number;
  providerScore: number;
};

export type MatchIndex = Map<string, CatalogEntry[]>;

export function buildIndex(entries: readonly CatalogEntry[]): MatchIndex {
  const index: MatchIndex = new Map();
  for (const candidate of entries) {
    for (const key of candidate.modelKeys) {
      const group = index.get(key);
      if (group) group.push(candidate);
      else index.set(key, [candidate]);
    }
  }
  return index;
}

function bestProvider(
  target: Target,
  pool: readonly CatalogEntry[],
  modelScore: number,
): ScoredMatch {
  const composite = (candidate: CatalogEntry) =>
    diceCoefficient(target.providerKey, candidate.providerKey) * 100 +
    (candidate.official ? 10 : 0) +
    candidate.completeness;
  const best = maxBy(
    orderBy(
      pool,
      [(candidate) => `${candidate.providerID}\0${candidate.modelID}`],
      ["asc"],
    ),
    composite,
  )!;
  return {
    candidate: best,
    modelScore,
    providerScore: Math.round(composite(best) * 100) / 100,
  };
}

export function pickDonor(
  index: MatchIndex,
  target: Target,
): ScoredMatch | undefined {
  const donors = (keys: readonly string[]): CatalogEntry[] =>
    uniq(keys.flatMap((key) => index.get(key) ?? [])).filter(
      (candidate) =>
        candidate.model.id === candidate.model.modelID &&
        (candidate.providerID !== target.providerID ||
          candidate.modelID !== target.configKey) &&
        !isEmptyObject(candidate.metadata),
    );
  const exact = donors([target.modelKey]);
  if (exact.length > 0) return bestProvider(target, exact, 100);
  const scored = [...index.keys()]
    .map((key) => ({ key, score: diceCoefficient(target.modelKey, key) }))
    .sort((left, right) => right.score - left.score);
  for (let tierIndex = 0; tierIndex < scored.length;) {
    const max = scored[tierIndex]!.score;
    const tierKeys: string[] = [];
    while (tierIndex < scored.length && scored[tierIndex]!.score >= max - 1e-9)
      tierKeys.push(scored[tierIndex++]!.key);
    const tier = donors(tierKeys);
    if (tier.length > 0)
      return bestProvider(target, tier, Math.round(max * 1000) / 10);
  }
  return undefined;
}
