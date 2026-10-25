import { Plugin } from "@opencode/plugin";
import { matchDonors, MERGEABLE_KEYS } from "./match/donor.ts";
import { loadCore, resolveVariants } from "./match/variants.ts";
import { matchRpc, type MatchInput, type MatchResult } from "./rpc.ts";
import { loadTargets } from "./target/load.ts";

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    await loadCore();
    const targets = await loadTargets(ctx.location);
    let catalogMatches = new Map<string, MatchResult>();
    let resolveCatalogMatches = () => {};
    const catalogMatchesReady = new Promise<void>((resolve) => {
      resolveCatalogMatches = resolve;
    });
    const rpc = await ctx.rpc.register(matchRpc, {
      lookup: async (input) => {
        const { providerID, modelID } = input as MatchInput;
        await catalogMatchesReady;
        return (
          catalogMatches.get(`${providerID}\0${modelID}`) ?? {
            matched: false,
          }
        );
      },
    });
    const registration = await ctx.provider.transform((draft) => {
      try {
        const activeTargets = [...targets.values()];
        const matches = matchDonors(draft.list(), activeTargets);
        const configuredModels = new Map<string, Set<string>>();
        for (const target of activeTargets) {
          let models = configuredModels.get(target.providerID);
          if (!models) {
            models = new Set();
            configuredModels.set(target.providerID, models);
          }
          models.add(target.configKey);
        }
        for (const [providerID, models] of configuredModels) {
          for (const id of draft.get(providerID)?.models.keys() ?? []) {
            if (!models.has(id)) draft.models.remove(providerID, id);
          }
        }
        const nextCatalogMatches = new Map<string, MatchResult>();
        const fuzzy = [];
        let unmatched = 0;
        for (const target of activeTargets) {
          const match = matches.get(
            `${target.providerID}\0${target.configKey}`,
          );
          nextCatalogMatches.set(
            `${target.providerID}\0${target.configKey}`,
            match
              ? {
                  matched: true,
                  catalogProviderID: match.candidate.providerID,
                  catalogModelID: match.candidate.modelID,
                }
              : { matched: false },
          );
          if (!match) unmatched++;
          else if (match.modelScore < 100)
            fuzzy.push(
              `${target.providerID}/${target.configKey} -> ` +
                `${match.candidate.providerID}/${match.candidate.modelID} ` +
                `(model ${match.modelScore}, provider ${match.providerScore})`,
            );
          try {
            if (!match) continue;
            draft.models.update(
              target.providerID,
              target.configKey,
              (model) => {
                for (const key of MERGEABLE_KEYS) {
                  if (
                    key === "enabled" ||
                    key === "variants" ||
                    (match.candidate.providerID !== target.providerID &&
                      (key === "settings" ||
                        key === "headers" ||
                        key === "body"))
                  )
                    continue;
                  const value = match.candidate.metadata[key];
                  if (value !== undefined)
                    (model as Record<string, unknown>)[key] = value;
                }
                model.variants = structuredClone(
                  resolveVariants(
                    model,
                    match.candidate.model,
                    draft.get(target.providerID)?.provider.package ?? "",
                    draft.get(match.candidate.providerID)?.provider.package ??
                      "",
                  ),
                ) as typeof model.variants;
              },
            );
          } catch (error) {
            console.warn(
              `[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`,
              error,
            );
          }
        }
        catalogMatches = nextCatalogMatches;
        if (fuzzy.length > 0)
          console.warn(
            `[model-catalog-match] fuzzy matches (${fuzzy.length}):\n  ` +
              fuzzy.slice(0, 40).join("\n  ") +
              (fuzzy.length > 40 ? `\n  …+${fuzzy.length - 40} more` : ""),
          );
        if (unmatched > 0)
          console.warn(
            `[model-catalog-match] ${unmatched} target(s) with no donatable catalog sibling`,
          );
      } catch (error) {
        console.warn("[model-catalog-match] transform failed", error);
      } finally {
        resolveCatalogMatches();
      }
    });
    return async () => {
      await registration.dispose();
      await rpc.dispose();
    };
  },
});
