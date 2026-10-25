import { Plugin, type Model } from "@opencode/plugin";
import { matchDonors, MERGEABLE_KEYS } from "./match/donor.ts";
import { loadCore, resolveVariants } from "./match/variants.ts";
import { matchRpc, type MatchInput, type MatchResult } from "./rpc.ts";
import { loadTargets } from "./target/load.ts";

type VariantAssignment = {
  providerID: string;
  configKey: string;
  donor: Model.Info;
  donorProviderPackage: string;
};

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    await loadCore();
    const targets = await loadTargets(ctx.location);
    let catalogMatches = new Map<string, MatchResult>();
    let variantAssignments = new Map<string, VariantAssignment>();
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
        const nextAssignments = new Map<string, VariantAssignment>();
        const fuzzy = [];
        let unmatched = 0;
        for (const target of activeTargets) {
          const match = matches.get(
            `${target.providerID}\0${target.configKey}`,
          );
          if (match)
            nextAssignments.set(`${target.providerID}\0${target.configKey}`, {
              providerID: target.providerID,
              configKey: target.configKey,
              donor: structuredClone(match.candidate.model),
              donorProviderPackage:
                draft.get(match.candidate.providerID)?.provider.package ?? "",
            });
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
        variantAssignments = nextAssignments;
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
    // The host config plugin rewrites `variants` for configured models in its late
    // model transform and can resolve none for config-only providers. This runs
    // after it; models that still have variants (config-provided or surviving)
    // are left alone.
    const modelRegistration = await ctx.model.transform((models) => {
      for (const assignment of variantAssignments.values()) {
        const model = models.get(assignment.providerID, assignment.configKey);
        if (!model || model.variants.length > 0) continue;
        try {
          const resolved = resolveVariants(
            model,
            assignment.donor,
            models.provider.get(assignment.providerID)?.provider.package ?? "",
            assignment.donorProviderPackage,
          );
          if (resolved.length > 0)
            model.variants = structuredClone(resolved) as typeof model.variants;
        } catch (error) {
          console.warn(
            `[model-catalog-match] failed to restore variants for ${assignment.providerID}/${assignment.configKey}`,
            error,
          );
        }
      }
    });
    return async () => {
      await registration.dispose();
      await modelRegistration.dispose();
      await rpc.dispose();
    };
  },
});
