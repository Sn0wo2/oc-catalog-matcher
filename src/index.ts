import { Plugin } from "@opencode/plugin";
import { matchDonors, MERGEABLE_KEYS } from "./match/donor.ts";
import { loadTargets, targetKey } from "./target/load.ts";

const CONNECTION_KEYS = new Set(["settings", "headers", "body"]);

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    const targets = await loadTargets(ctx.location);
    const registration = await ctx.model.transform((draft) => {
      try {
        const matches = matchDonors(draft.provider.list(), [
          ...targets.values(),
        ]);
        const fuzzy: string[] = [];
        let unmatched = 0;
        for (const target of targets.values()) {
          const match = matches.get(targetKey(target));
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
              const sink = model as Record<string, unknown>;
              for (const key of MERGEABLE_KEYS) {
                if (
                  key === "enabled" ||
                  (match.candidate.providerID !== target.providerID &&
                    CONNECTION_KEYS.has(key))
                )
                  continue;
                const value = match.candidate.metadata[key];
                if (value !== undefined) sink[key] = value;
              }
            });
          } catch (error) {
            console.warn(
              `[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`,
              error,
            );
          }
        }
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
      }
    });
    return () => registration.dispose();
  },
});
