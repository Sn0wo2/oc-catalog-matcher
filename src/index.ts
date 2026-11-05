import { type Model, Plugin } from "@opencode/plugin"
import { MERGEABLE_KEYS, matchDonors } from "./match/donor.ts"
import { resolveVariants } from "./match/variants.ts"
import { matchRpc } from "./rpc.ts"
import { loadTargets, type Target } from "./target/load.ts"

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    const targets = await loadTargets(ctx.location)
    let matches = new Map<string, { target: Target; donor: { model: Model.Info; providerPackage: string } }>()
    let resolveMatches = () => {}
    const matchesReady = new Promise<void>((resolve) => {
      resolveMatches = resolve
    })
    const rpc = await ctx.rpc.register(matchRpc, {
      lookup: async (input) => {
        const { providerID, modelID } = input
        await matchesReady
        const donor = matches.get(`${providerID}\0${modelID}`)?.donor
        if (!donor) return { matched: false as const }
        return {
          matched: true as const,
          catalogProviderID: donor.model.providerID,
          catalogModelID: donor.model.id,
        }
      },
    })
    const registration = await ctx.provider.transform((draft) => {
      try {
        const activeTargets = [...targets.values()]
        const matched = matchDonors(draft.list(), activeTargets)
        const configured = new Map<string, Set<string>>()
        for (const target of activeTargets)
          configured.set(
            target.providerID,
            configured.get(target.providerID)?.add(target.configKey) ?? new Set([target.configKey]),
          )
        for (const [providerID, models] of configured)
          for (const id of draft.get(providerID)?.models.keys() ?? [])
            if (!models.has(id)) draft.models.remove(providerID, id)
        const next: typeof matches = new Map()
        const fuzzy = []
        let unmatched = 0
        for (const target of activeTargets) {
          const match = matched.get(`${target.providerID}\0${target.configKey}`)
          if (!match) {
            unmatched++
            continue
          }
          if (match.modelScore < 100)
            fuzzy.push(
              `${target.providerID}/${target.configKey} -> ${match.candidate.providerID}/${match.candidate.modelID} ` +
                `(model ${match.modelScore}, provider ${match.providerScore})`,
            )
          try {
            next.set(`${target.providerID}\0${target.configKey}`, {
              target,
              donor: {
                model: structuredClone(match.candidate.model),
                providerPackage: draft.get(match.candidate.providerID)?.provider.package ?? "",
              },
            })
            draft.models.update(target.providerID, target.configKey, (model) => {
              for (const mergeKey of MERGEABLE_KEYS) {
                if (
                  mergeKey === "enabled" ||
                  mergeKey === "variants" ||
                  (match.candidate.providerID !== target.providerID &&
                    (mergeKey === "settings" || mergeKey === "headers" || mergeKey === "body"))
                )
                  continue
                const value = match.candidate.metadata[mergeKey]
                if (value !== undefined) (model as Record<string, unknown>)[mergeKey] = value
              }
            })
          } catch (error) {
            console.warn(`[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`, error)
          }
        }
        matches = next
        if (fuzzy.length > 0)
          console.warn(
            `[model-catalog-match] fuzzy matches (${fuzzy.length}):\n  ` +
              fuzzy.slice(0, 40).join("\n  ") +
              (fuzzy.length > 40 ? `\n  …+${fuzzy.length - 40} more` : ""),
          )
        if (unmatched > 0)
          console.warn(`[model-catalog-match] ${unmatched} target(s) with no donatable catalog sibling`)
      } catch (error) {
        console.warn("[model-catalog-match] transform failed", error)
      } finally {
        resolveMatches()
      }
    })
    const modelRegistration = await ctx.model.transform((models) => {
      for (const entry of matches.values()) {
        const model = models.get(entry.target.providerID, entry.target.configKey)
        if (model?.variants.length !== 0) continue
        model.variants = structuredClone(
          resolveVariants(
            { model, providerPackage: models.provider.get(entry.target.providerID)?.provider.package ?? "" },
            entry.donor,
          ),
        ) as typeof model.variants
      }
    })
    return async () => {
      await registration.dispose()
      await modelRegistration.dispose()
      await rpc.dispose()
    }
  },
})
