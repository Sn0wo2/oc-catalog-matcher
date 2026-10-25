import { Plugin, type Model } from "@opencode/plugin";
import { matchDonors, MERGEABLE_KEYS } from "./match/donor.ts";
import { loadCore, resolveVariants } from "./match/variants.ts";
import { matchRpc, type MatchInput, type MatchResult } from "./rpc.ts";
import { loadTargets, type Target } from "./target/load.ts";

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    await loadCore();
    const targets = await loadTargets(ctx.location);
    let matches = new Map<
      string,
      {
        target: Target;
        result: MatchResult;
        variants: Model.Info["variants"] | undefined;
      }
    >();
    let resolveMatches = () => {};
    const matchesReady = new Promise<void>((resolve) => {
      resolveMatches = resolve;
    });
    const rpc = await ctx.rpc.register(matchRpc, {
      lookup: async (input) => {
        const { providerID, modelID } = input as MatchInput;
        await matchesReady;
        return (
          matches.get(`${providerID}\0${modelID}`)?.result ?? { matched: false }
        );
      },
    });
    const registration = await ctx.provider.transform((draft) => {
      try {
        const activeTargets = [...targets.values()];
        const matched = matchDonors(draft.list(), activeTargets);
        const configured = new Map<string, Set<string>>();
        for (const target of activeTargets)
          configured.set(
            target.providerID,
            configured.get(target.providerID)?.add(target.configKey) ??
              new Set([target.configKey]),
          );
        for (const [providerID, models] of configured)
          for (const id of draft.get(providerID)?.models.keys() ?? [])
            if (!models.has(id)) draft.models.remove(providerID, id);
        const next: typeof matches = new Map();
        const fuzzy = [];
        let unmatched = 0;
        for (const target of activeTargets) {
          const match = matched.get(
            `${target.providerID}\0${target.configKey}`,
          );
          if (!match) {
            unmatched++;
            next.set(`${target.providerID}\0${target.configKey}`, {
              target,
              result: { matched: false },
              variants: undefined,
            });
            continue;
          }
          if (match.modelScore < 100)
            fuzzy.push(
              `${target.providerID}/${target.configKey} -> ` +
                `${match.candidate.providerID}/${match.candidate.modelID} ` +
                `(model ${match.modelScore}, provider ${match.providerScore})`,
            );
          try {
            const model = draft
              .get(target.providerID)
              ?.models.get(target.configKey);
            const variants = model
              ? structuredClone(
                  resolveVariants(
                    model,
                    match.candidate.model,
                    draft.get(target.providerID)?.provider.package ?? "",
                    draft.get(match.candidate.providerID)?.provider.package ??
                      "",
                  ),
                )
              : [];
            next.set(`${target.providerID}\0${target.configKey}`, {
              target,
              result: {
                matched: true,
                catalogProviderID: match.candidate.providerID,
                catalogModelID: match.candidate.modelID,
              },
              variants: variants.length > 0 ? variants : undefined,
            });
            draft.models.update(
              target.providerID,
              target.configKey,
              (model) => {
                for (const mergeKey of MERGEABLE_KEYS) {
                  if (
                    mergeKey === "enabled" ||
                    mergeKey === "variants" ||
                    (match.candidate.providerID !== target.providerID &&
                      (mergeKey === "settings" ||
                        mergeKey === "headers" ||
                        mergeKey === "body"))
                  )
                    continue;
                  const value = match.candidate.metadata[mergeKey];
                  if (value !== undefined)
                    (model as Record<string, unknown>)[mergeKey] = value;
                }
              },
            );
          } catch (error) {
            console.warn(
              `[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`,
              error,
            );
          }
        }
        matches = next;
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
        resolveMatches();
      }
    });
    const modelRegistration = await ctx.model.transform((models) => {
      for (const entry of matches.values()) {
        if (!entry.variants) continue;
        const model = models.get(
          entry.target.providerID,
          entry.target.configKey,
        );
        if (model?.variants.length === 0)
          model.variants = structuredClone(
            entry.variants,
          ) as typeof model.variants;
      }
    });
    return async () => {
      await registration.dispose();
      await modelRegistration.dispose();
      await rpc.dispose();
    };
  },
});
