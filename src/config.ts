import type { Location } from "@opencode/plugin";
import { configPaths, parseConfig } from "@sn0wo2/oc-utils";
import { isPlainObject as isRecord, kebabCase } from "es-toolkit";
import { mergeRecords } from "./shared";

export type Target = {
  providerID: string;
  configKey: string;
  cataID?: string;
  modelKey: string;
  providerKey: string;
  configuration?: Record<string, unknown>;
};

export function targetKey(
  target: Pick<Target, "providerID" | "configKey">,
): string {
  return `${target.providerID}\0${target.configKey}`;
}

export async function loadTargets(
  location: Location.Info,
): Promise<Map<string, Target>> {
  const targets = new Map<string, Target>();
  const documents = await Promise.all(
    configPaths(location).map(async (path) => {
      const text = await Bun.file(path)
        .text()
        .catch(() => "");
      if (!text) return undefined;
      try {
        return parseConfig(text);
      } catch (error) {
        console.warn(
          `[model-catalog-match] ignoring invalid config at ${path}`,
          error,
        );
        return undefined;
      }
    }),
  );
  for (const document of documents) {
    if (!document || !isRecord(document.providers)) continue;
    for (const [providerID, rawProvider] of Object.entries(
      document.providers,
    )) {
      if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
      for (const [configKey, rawModel] of Object.entries(rawProvider.models)) {
        const configuration = isRecord(rawModel)
          ? structuredClone(rawModel)
          : {};
        const previous = targets.get(targetKey({ providerID, configKey }));
        const cataID =
          (typeof configuration.cataID === "string" &&
            configuration.cataID.trim()) ||
          previous?.cataID;
        targets.set(targetKey({ providerID, configKey }), {
          providerID,
          configKey,
          modelKey: kebabCase(cataID ?? configKey),
          providerKey: kebabCase(providerID),
          configuration: previous
            ? mergeRecords(previous.configuration ?? {}, configuration)
            : configuration,
          ...(cataID === undefined ? {} : { cataID }),
        });
      }
    }
  }
  return targets;
}
