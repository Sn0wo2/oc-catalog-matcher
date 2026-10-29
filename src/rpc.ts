export type MatchInput = {
  providerID: string
  modelID: string
}

export type MatchResult = {
  matched: boolean
  catalogProviderID?: string
  catalogModelID?: string
}

export const matchRpc = {
  id: "oc-catalog-matcher",
  methods: {
    lookup: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          modelID: { type: "string" },
        },
        required: ["providerID", "modelID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          matched: { type: "boolean" },
          catalogProviderID: { type: "string" },
          catalogModelID: { type: "string" },
        },
        required: ["matched"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const
