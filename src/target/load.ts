import { isPlainObject } from "es-toolkit/predicate";
import { kebabCase } from "es-toolkit";
import type { Location } from "@opencode/plugin";
import { configPaths, parseConfig } from "../utils/config.ts";

export type Target = {
  providerID: string;
  configKey: string;
  cataID?: string;
  providerCataID?: string;
  modelKeys: readonly string[];
  providerKey: string;
};

export async function loadTargets(location: Location.Info) {
  const targets = new Map<string, Target>();
  const documents = await Promise.all(
    configPaths(location).map(async (path) => {
      const text = await Bun.file(path)
        .text()
        .catch(() => "");
      if (!text) return undefined;
      try {
        return parseConfig(text, path);
      } catch (error) {
        console.warn(
          `[model-catalog-match] ignoring invalid config at ${path}`,
          error,
        );
        return undefined;
      }
    }),
  );
  const providerCataIDs = new Map<string, string>();
  for (const document of documents) {
    if (!document || !isPlainObject(document.providers)) continue;
    for (const [providerID, rawProvider] of Object.entries(
      document.providers,
    )) {
      if (!isPlainObject(rawProvider)) continue;
      const cataID =
        typeof rawProvider.cataID === "string" && rawProvider.cataID.trim();
      if (cataID) providerCataIDs.set(providerID, cataID);
    }
  }
  for (const document of documents) {
    if (!document || !isPlainObject(document.providers)) continue;
    for (const [providerID, rawProvider] of Object.entries(
      document.providers,
    )) {
      if (!isPlainObject(rawProvider) || !isPlainObject(rawProvider.models))
        continue;
      const providerCataID = providerCataIDs.get(providerID);
      for (const [configKey, rawModel] of Object.entries(rawProvider.models)) {
        const previous = targets.get(`${providerID}\0${configKey}`);
        const raw = isPlainObject(rawModel) ? rawModel : undefined;
        const cataID =
          (typeof raw?.cataID === "string" && raw.cataID.trim()) ||
          (typeof raw?.modelID === "string" && raw.modelID.trim()) ||
          previous?.cataID;
        targets.set(`${providerID}\0${configKey}`, {
          providerID,
          configKey,
          modelKeys: [
            ...new Set(
              [
                cataID,
                typeof raw?.modelID === "string"
                  ? raw.modelID.trim()
                  : undefined,
                previous?.cataID,
                configKey,
              ]
                .filter((id): id is string => Boolean(id))
                .map(kebabCase),
            ),
          ],
          providerKey: kebabCase(providerID),
          ...(cataID === undefined ? {} : { cataID }),
          ...(providerCataID === undefined ? {} : { providerCataID }),
        });
      }
    }
  }
  return targets;
}
