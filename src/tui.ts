import { Plugin } from "@opencode/plugin/tui"
import { matchRpc } from "./rpc.ts"

export default Plugin.define({
  id: "oc-catalog-matcher",
  setup: (ctx) => {
    const rpc = ctx.client.rpc(matchRpc)
    let selected: string | undefined
    let request = 0
    const showMatch = async (providerID: string, modelID: string) => {
      if (`${providerID}\0${modelID}` === selected) return
      selected = `${providerID}\0${modelID}`
      const current = ++request
      try {
        const match = await rpc.lookup({ providerID, modelID })
        if (current !== request) return
        if (!match.matched) {
          selected = undefined
          return
        }
        ctx.ui.toast.show({
          title: "Catalog match",
          message: `${providerID}/${modelID} → ${match.catalogProviderID}/${match.catalogModelID}`,
          variant: "info",
        })
      } catch {
        if (current === request) selected = undefined
      }
    }
    const model = ctx.ui.model.current()
    if (model) void showMatch(model.providerID, model.modelID)
    return ctx.data.on("session.model.selected", (event) => {
      void showMatch(event.data.model.providerID, event.data.model.id)
    })
  },
})
