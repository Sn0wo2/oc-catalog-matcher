import { diceCoefficient } from "dice-coefficient";
import { isEqual, kebabCase, maxBy, orderBy, uniq } from "es-toolkit";
import { isEmptyObject } from "es-toolkit/predicate";
import { Model } from "@opencode/plugin";
import { targetKey, type Target } from "../target/load.ts";

export const MERGEABLE_KEYS = [
  "name",
  "family",
  "capabilities",
  "limit",
  "cost",
  "compatibility",
  "time",
  "settings",
  "headers",
  "body",
  "variants",
  "enabled",
] as const;

export type MergeableKey = (typeof MERGEABLE_KEYS)[number];
type MergeLayer = Partial<Record<MergeableKey, unknown>>;

type CatalogEntry = {
  providerID: string;
  modelID: string;
  modelKeys: readonly string[];
  providerKey: string;
  official: boolean;
  completeness: number;
  model: Model.Info;
  metadata: MergeLayer;
};

type ScoredMatch = {
  candidate: CatalogEntry;
  modelScore: number;
  providerScore: number;
};

export function matchDonors(
  providers: readonly { models: ReadonlyMap<string, Model.Info> }[],
  targets: readonly Target[],
): Map<string, ScoredMatch | undefined> {
  const stems: Readonly<Record<string, string>> = {
    deepseek: "deepseek",
    claude: "anthropic",
    gemini: "google",
    gpt: "openai",
    grok: "xai",
    kimi: "moonshotai",
    glm: "zai",
    qwen: "alibaba",
    minimax: "minimax",
    mistral: "mistral",
  };
  const entries: CatalogEntry[] = [];
  for (const record of providers) {
    for (const model of record.models.values()) {
      const defaults = Model.Info.default(model.providerID, model.id);
      const differs: Partial<Record<MergeableKey, boolean>> = {
        name: model.name !== model.id && model.name !== model.modelID,
        family: model.family !== undefined,
        capabilities: !isEqual(model.capabilities, defaults.capabilities),
        limit: !isEqual(model.limit, defaults.limit),
        cost: model.cost.length > 0,
        compatibility: model.compatibility !== undefined,
        time: !isEqual(model.time, defaults.time),
        settings:
          model.settings !== undefined && !isEmptyObject(model.settings),
        headers: model.headers !== undefined && !isEmptyObject(model.headers),
        body: model.body !== undefined && !isEmptyObject(model.body),
        variants: model.variants.length > 0,
      };
      const metadata: MergeLayer = {};
      for (const key of MERGEABLE_KEYS)
        if (differs[key]) metadata[key] = structuredClone(model[key]);
      const providerKey = kebabCase(model.providerID);
      const family = model.family;
      entries.push({
        providerID: model.providerID,
        modelID: model.id,
        modelKeys: uniq(
          [model.id, model.modelID].flatMap((id) =>
            [id, id.split("/").at(-1) ?? ""].map(kebabCase),
          ),
        ).filter(Boolean),
        providerKey,
        official:
          family !== undefined &&
          Object.entries(stems).some(
            ([stem, provider]) =>
              family.startsWith(stem) && provider === providerKey,
          ),
        completeness:
          (metadata.limit !== undefined || metadata.capabilities !== undefined
            ? 2
            : 0) +
          (metadata.cost !== undefined ? 2 : 0) +
          (metadata.variants !== undefined ? 2 : 0) +
          (metadata.family !== undefined ||
          metadata.compatibility !== undefined ||
          metadata.time !== undefined
            ? 2
            : 0) +
          (metadata.settings !== undefined ||
          metadata.headers !== undefined ||
          metadata.body !== undefined
            ? 2
            : 0),
        metadata,
        model,
      });
    }
  }
  const index = new Map<string, CatalogEntry[]>();
  for (const entry of entries)
    for (const key of entry.modelKeys) {
      const group = index.get(key);
      if (group) group.push(entry);
      else index.set(key, [entry]);
    }
  const best = (
    target: Target,
    pool: readonly CatalogEntry[],
    modelScore: number,
  ): ScoredMatch => {
    const composite = (entry: CatalogEntry) =>
      diceCoefficient(target.providerKey, entry.providerKey) * 100 +
      (entry.official ? 10 : 0) +
      entry.completeness;
    const candidate = maxBy(
      orderBy(
        pool,
        [(entry) => `${entry.providerID}\0${entry.modelID}`],
        ["asc"],
      ),
      composite,
    )!;
    return {
      candidate,
      modelScore,
      providerScore: Math.round(composite(candidate) * 100) / 100,
    };
  };
  const donors = (target: Target, keys: readonly string[]): CatalogEntry[] =>
    uniq(keys.flatMap((key) => index.get(key) ?? [])).filter(
      (entry) =>
        entry.model.id === entry.model.modelID &&
        (entry.providerID !== target.providerID ||
          entry.modelID !== target.configKey) &&
        !isEmptyObject(entry.metadata),
    );
  return new Map(
    targets.map((target) => {
      const exact = donors(target, [target.modelKey]);
      if (exact.length > 0)
        return [targetKey(target), best(target, exact, 100)];
      const scored = [...index.keys()]
        .map((key) => ({ key, score: diceCoefficient(target.modelKey, key) }))
        .sort((left, right) => right.score - left.score);
      for (let i = 0; i < scored.length;) {
        const max = scored[i]!.score;
        const tierKeys: string[] = [];
        while (i < scored.length && scored[i]!.score >= max - 1e-9)
          tierKeys.push(scored[i++]!.key);
        const tier = donors(target, tierKeys);
        if (tier.length > 0)
          return [
            targetKey(target),
            best(target, tier, Math.round(max * 1000) / 10),
          ];
      }
      return [targetKey(target), undefined];
    }),
  );
}
