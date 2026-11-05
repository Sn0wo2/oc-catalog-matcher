import { Model } from "@opencode/plugin"
import { diceCoefficient } from "dice-coefficient"
import { isEqual, kebabCase, maxBy, orderBy, round, uniq } from "es-toolkit"
import { isEmptyObject } from "es-toolkit/predicate"
import type { Target } from "../target/load.ts"

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
] as const

type CatalogEntry = {
  providerID: string
  modelID: string
  modelKeys: readonly string[]
  providerKey: string
  official: boolean
  completeness: number
  model: Model.Info
  metadata: Partial<Record<(typeof MERGEABLE_KEYS)[number], unknown>>
}

export function matchDonors(
  providers: readonly { models: ReadonlyMap<string, Model.Info> }[],
  targets: readonly Target[],
) {
  const entries: CatalogEntry[] = []
  for (const record of providers) {
    for (const model of record.models.values()) {
      const defaults = Model.Info.default(model.providerID, model.id)
      const differs: Partial<Record<(typeof MERGEABLE_KEYS)[number], boolean>> = {
        name: model.name !== model.id && model.name !== model.modelID,
        family: model.family !== undefined,
        capabilities: !isEqual(model.capabilities, defaults.capabilities),
        limit: !isEqual(model.limit, defaults.limit),
        cost: model.cost.length > 0,
        compatibility: model.compatibility !== undefined,
        time: !isEqual(model.time, defaults.time),
        settings: model.settings !== undefined && !isEmptyObject(model.settings),
        headers: model.headers !== undefined && !isEmptyObject(model.headers),
        body: model.body !== undefined && !isEmptyObject(model.body),
        variants: model.variants.length > 0,
      }
      const metadata: Partial<Record<(typeof MERGEABLE_KEYS)[number], unknown>> = {}
      for (const key of MERGEABLE_KEYS) if (differs[key]) metadata[key] = structuredClone(model[key])
      const providerKey = kebabCase(model.providerID)
      const family = model.family
      entries.push({
        providerID: model.providerID,
        modelID: model.id,
        modelKeys: uniq(
          [model.id, model.modelID].flatMap((id) => [id, id.split("/").at(-1) ?? ""].map(kebabCase)),
        ).filter(Boolean),
        providerKey,
        official:
          family !== undefined &&
          (
            [
              ["deepseek", "deepseek"],
              ["claude", "anthropic"],
              ["gemini", "google"],
              ["gpt", "openai"],
              ["grok", "xai"],
              ["kimi", "moonshotai"],
              ["glm", "zai"],
              ["qwen", "alibaba"],
              ["minimax", "minimax"],
              ["mistral", "mistral"],
            ] as const
          ).some(([stem, provider]) => family.startsWith(stem) && provider === providerKey),
        completeness:
          (metadata.limit !== undefined || metadata.capabilities !== undefined ? 2 : 0) +
          (metadata.cost !== undefined ? 2 : 0) +
          (metadata.variants !== undefined ? 2 : 0) +
          (metadata.family !== undefined || metadata.compatibility !== undefined || metadata.time !== undefined
            ? 2
            : 0) +
          (metadata.settings !== undefined || metadata.headers !== undefined || metadata.body !== undefined ? 2 : 0),
        metadata,
        model,
      })
    }
  }
  const index = new Map<string, CatalogEntry[]>()
  for (const entry of entries)
    for (const key of entry.modelKeys) {
      const group = index.get(key)
      if (group) group.push(entry)
      else index.set(key, [entry])
    }
  const best = (target: Target, pool: readonly CatalogEntry[], modelScore: number) => {
    const candidate = maxBy(
      orderBy(
        pool.some((entry) => entry.official) ? pool.filter((entry) => entry.official) : pool,
        [(entry) => `${entry.providerID}\0${entry.modelID}`],
        ["asc"],
      ),
      (entry) => diceCoefficient(target.providerKey, entry.providerKey) * 100 + entry.completeness,
    )
    if (!candidate) throw new Error("Cannot select a donor from an empty pool")
    return {
      candidate,
      modelScore,
      providerScore: round(
        diceCoefficient(target.providerKey, candidate.providerKey) * 100 + candidate.completeness,
        2,
      ),
    }
  }
  const donors = (target: Target, keys: readonly string[]) => {
    const providerCataID = target.providerCataID ? kebabCase(target.providerCataID) : undefined
    const candidates = uniq(keys.flatMap((key) => index.get(key) ?? [])).filter(
      (entry) =>
        entry.model.id === entry.model.modelID &&
        (entry.providerID !== target.providerID || entry.modelID !== target.configKey) &&
        !isEmptyObject(entry.metadata),
    )
    const preferred = providerCataID ? candidates.filter((entry) => entry.providerKey === providerCataID) : []
    return preferred.length > 0 ? preferred : candidates
  }
  return new Map(
    targets.flatMap((target) => {
      for (const modelKey of target.modelKeys) {
        const exact = donors(target, [modelKey])
        if (exact.length > 0) return [[`${target.providerID}\0${target.configKey}`, best(target, exact, 100)] as const]
      }
      const scored = [...index.keys()]
        .map((key) => {
          return {
            key,
            score: Math.max(...target.modelKeys.map((modelKey) => diceCoefficient(modelKey, key))),
          }
        })
        .sort((left, right) => right.score - left.score)
      for (let i = 0; i < scored.length; ) {
        const first = scored[i]
        if (!first) break
        const max = first.score
        const tierKeys = []
        while (i < scored.length) {
          const entry = scored[i]
          if (!entry || entry.score < max - 1e-9) break
          tierKeys.push(entry.key)
          i++
        }
        const tier = donors(target, tierKeys)
        if (tier.length > 0)
          return [[`${target.providerID}\0${target.configKey}`, best(target, tier, round(max * 100, 1))] as const]
      }
      return []
    }),
  )
}
