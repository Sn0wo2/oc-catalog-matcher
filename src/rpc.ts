import { z } from "zod"

export const matchRpc = {
  id: "oc-catalog-matcher",
  methods: {
    lookup: {
      input: z.object({ providerID: z.string(), modelID: z.string() }),
      output: z.discriminatedUnion("matched", [
        z.object({ matched: z.literal(false) }),
        z.object({ matched: z.literal(true), catalogProviderID: z.string(), catalogModelID: z.string() }),
      ]),
    },
  },
  events: {},
}
