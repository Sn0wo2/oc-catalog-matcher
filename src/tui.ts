import { Plugin } from "@opencode/plugin/tui";
import { matchRpc, type MatchInput, type MatchResult } from "./rpc.ts";

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: (ctx) => {
    const rpc = ctx.client.rpc(matchRpc);
    let selected: string | undefined;
    let request = 0;
    const showMatch = async ({ providerID, modelID }: MatchInput) => {
      const key = `${providerID}\0${modelID}`;
      if (key === selected) return;
      selected = key;
      const current = ++request;
      try {
        const match = (await rpc.lookup({
          providerID,
          modelID,
        })) as MatchResult;
        if (current !== request) return;
        if (!match.matched) {
          selected = undefined;
          return;
        }
        ctx.ui.toast.show({
          title: "Catalog match",
          message: `${providerID}/${modelID} → ${match.catalogProviderID}/${match.catalogModelID}`,
          variant: "info",
        });
      } catch {
        if (current === request) selected = undefined;
      }
    };
    const stop = ctx.data.on("session.model.selected", (event) => {
      void showMatch({
        providerID: event.data.model.providerID,
        modelID: event.data.model.id,
      });
    });
    const model = ctx.ui.model.current();
    if (model) void showMatch(model);
    return stop;
  },
});
