import { Plugin } from "@opencode/plugin";
import { matchDonors, MERGEABLE_KEYS } from "./match/donor.ts";
import { matchRpc, type MatchInput, type MatchResult } from "./rpc.ts";
import { loadTargets } from "./target/load.ts";

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    const targets = await loadTargets(ctx.location);
    let catalogMatches = new Map<string, MatchResult>();
    let resolveCatalogMatches!: () => void;
    const rpc = await ctx.rpc.register(matchRpc, {
      lookup: async (input) => {
        const { providerID, modelID } = input as MatchInput;
        await new Promise<void>((resolve) => {
          resolveCatalogMatches = resolve;
        });
        return (
          catalogMatches.get(`${providerID}\0${modelID}`) ?? {
            matched: false,
          }
        );
      },
    });
    const registration = await ctx.model.transform((draft) => {
      try {
        const existing = new Set(
          draft.list().map((model) => `${model.providerID}\0${model.id}`),
        );
        const activeTargets = [...targets.values()].filter((target) =>
          existing.has(`${target.providerID}\0${target.configKey}`),
        );
        const matches = matchDonors(draft.provider.list(), activeTargets);
        const nextCatalogMatches = new Map<string, MatchResult>();
        const fuzzy = [];
        let unmatched = 0;
        for (const target of activeTargets) {
          const key = `${target.providerID}\0${target.configKey}`;
          const match = matches.get(key);
          nextCatalogMatches.set(
            key,
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
            draft.update(target.providerID, target.configKey, (model) => {
              if (!match) return;
              for (const key of MERGEABLE_KEYS) {
                if (
                  key === "enabled" ||
                  (match.candidate.providerID !== target.providerID &&
                    (key === "settings" || key === "headers" || key === "body"))
                )
                  continue;
                const value = match.candidate.metadata[key];
                if (value !== undefined)
                  (model as Record<string, unknown>)[key] = value;
              }
            });
          } catch (error) {
            console.warn(
              `[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`,
              error,
            );
          }
        }
        catalogMatches = nextCatalogMatches;
        resolveCatalogMatches();
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
        resolveCatalogMatches();
      }
    });
    return async () => {
      await registration.dispose();
      await rpc.dispose();
    };
  },
});
