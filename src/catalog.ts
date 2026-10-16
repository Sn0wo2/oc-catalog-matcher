import { Model } from "@opencode/plugin";
import { isEmptyObject, isEqual, kebabCase, uniq } from "es-toolkit";
import { MERGEABLE_KEYS, type MergeableKey, type MergeLayer } from "./shared";

export type CatalogEntry = {
  providerID: string;
  modelID: string;
  modelKeys: readonly string[];
  providerKey: string;
  family?: string;
  official: boolean;
  completeness: number;
  model: Model.Info;
  metadata: MergeLayer;
};

const OFFICIAL_PROVIDER_STEMS: Readonly<Record<string, string>> = {
  deepseek: "deepseek",
  claude: "anthropic",
  gemini: "google",
  gpt: "openai",
  grok: "xai",
  kimi: "moonshotai",
  glm: "zai",
  qwen: "alibaba",
  minimax: "minimax",
  mistral: "mistral",
};

export function listCatalog(
  models: readonly Model.Info[],
): CatalogEntry[] {
  return models.flatMap((model) => {
    const metadata = explicitMetadata(model);
    delete metadata.enabled;
    const providerKey = kebabCase(model.providerID);
    const family = model.family;
    return [
      {
        providerID: model.providerID,
        modelID: model.id,
        modelKeys: uniq(
          [model.id, model.modelID].flatMap((id) =>
            [id, id.split("/").at(-1) ?? ""].map(kebabCase),
          ),
        ).filter(Boolean),
        providerKey,
        ...(family === undefined ? {} : { family }),
        official:
          family !== undefined &&
          Object.entries(OFFICIAL_PROVIDER_STEMS).some(
            ([stem, provider]) =>
              family.startsWith(stem) && provider === providerKey,
          ),
        completeness:
          (metadata.limit !== undefined || metadata.capabilities !== undefined
            ? 2
            : 0) +
          (metadata.cost !== undefined ? 2 : 0) +
          (metadata.variants !== undefined ? 2 : 0) +
          (metadata.family !== undefined ||
          metadata.compatibility !== undefined ||
          metadata.time !== undefined
            ? 2
            : 0) +
          (metadata.settings !== undefined ||
          metadata.headers !== undefined ||
          metadata.body !== undefined
            ? 2
            : 0),
        metadata,
        model,
      } satisfies CatalogEntry,
    ];
  });
}

export function explicitMetadata(model: Model.Info): MergeLayer {
  const defaults = Model.Info.default(model.providerID, model.id);
  const differs = (key: MergeableKey): boolean => {
    switch (key) {
      case "name":
        return model.name !== model.id && model.name !== model.modelID;
      case "limit":
        return !isEqual(model.limit, defaults.limit);
      case "cost":
        return model.cost.length > 0;
      case "capabilities":
        return !isEqual(model.capabilities, defaults.capabilities);
      case "time":
        return !isEqual(model.time, defaults.time);
      case "settings":
      case "headers":
      case "body":
        return model[key] !== undefined && !isEmptyObject(model[key]);
      case "variants":
        return model[key].length > 0;
      default:
        return model[key] !== undefined;
    }
  };
  const layer: MergeLayer = {};
  for (const key of MERGEABLE_KEYS) {
    if (differs(key)) layer[key] = structuredClone(model[key]);
  }
  return layer;
}
