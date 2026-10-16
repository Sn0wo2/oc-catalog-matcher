import { Plugin, type Model } from "@opencode/plugin";
import { kebabCase } from "es-toolkit";
import { listCatalog } from "./catalog";
import { loadTargets, targetKey } from "./config";
import { applyMetadata, type CatalogModel } from "./merge";
import { buildIndex, pickDonor } from "./match";

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: async (ctx) => {
    const targets = await loadTargets(ctx.location);
    // Model transforms run after config-defined models exist as candidates but
    // before the late config fold re-applies config fields, so edits made here
    // land on the final definitions (provider transforms never see config
    // providers at all).
    const registration = await ctx.model.transform((draft) => {
      try {
        // draft.list() yields DeepMutable copies; the catalog builder only
        // reads them, so the wider mutable view is safe to narrow here.
        const catalogEntries = listCatalog(
          draft.list() as unknown as Model.Info[],
        );
        const pending = new Map(targets);
        for (const entry of catalogEntries) {
          if (entry.model.id === entry.model.modelID) continue;
          const key = targetKey({
            providerID: entry.providerID,
            configKey: entry.modelID,
          });
          if (!pending.has(key)) {
            pending.set(key, {
              providerID: entry.providerID,
              configKey: entry.modelID,
              cataID: entry.model.modelID,
              modelKey: kebabCase(entry.model.modelID),
              providerKey: kebabCase(entry.providerID),
            });
          }
        }
        const index = buildIndex(catalogEntries);
        const fuzzyReport: string[] = [];
        let unmatched = 0;
        for (const target of pending.values()) {
          const donorMatch = pickDonor(index, target);
          if (donorMatch) {
            if (donorMatch.modelScore < 100)
              fuzzyReport.push(
                `${target.providerID}/${target.configKey} -> ` +
                  `${donorMatch.candidate.providerID}/${donorMatch.candidate.modelID} ` +
                  `(model ${donorMatch.modelScore}, provider ${donorMatch.providerScore})`,
              );
          } else {
            unmatched++;
          }
          try {
            draft.update(target.providerID, target.configKey, (model) => {
              applyMetadata(
                model as unknown as CatalogModel,
                target,
                donorMatch,
                draft.provider.get(target.providerID)?.provider.body,
              );
            });
          } catch (error) {
            console.warn(
              `[model-catalog-match] failed to update ${target.providerID}/${target.configKey}`,
              error,
            );
          }
        }
        if (fuzzyReport.length > 0) {
          console.warn(
            `[model-catalog-match] fuzzy matches (${fuzzyReport.length}):\n  ` +
              fuzzyReport.slice(0, 40).join("\n  ") +
              (fuzzyReport.length > 40
                ? `\n  …+${fuzzyReport.length - 40} more`
                : ""),
          );
        }
        if (unmatched > 0) {
          console.warn(
            `[model-catalog-match] ${unmatched} target(s) with no donatable catalog sibling`,
          );
        }
      } catch (error) {
        console.warn("[model-catalog-match] transform failed", error);
      }
    });
    return () => registration.dispose();
  },
});
