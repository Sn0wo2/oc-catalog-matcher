import type { Location } from "@opencode/plugin";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isPlainObject as isRecord, kebabCase } from "es-toolkit";
import { parse, type ParseError } from "jsonc-parser";
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

function configPaths(
  location?: Pick<Location.Info, "directory" | "project">,
): string[] {
  const names = ["opencode.json", "opencode.jsonc"];
  const globalDirectory =
    process.env.OPENCODE_CONFIG_DIR?.trim() ||
    join(
      process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"),
      "opencode",
    );
  const paths = names.map((name) => join(globalDirectory, name));
  if (location) {
    const directories: string[] = [];
    const root = resolve(location.project.directory);
    let current = resolve(location.directory);
    while (true) {
      directories.unshift(current);
      if (
        process.platform === "win32"
          ? current.toLowerCase() === root.toLowerCase()
          : current === root
      )
        break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    paths.push(
      ...directories.flatMap((directory) =>
        names.map((name) => join(directory, name)),
      ),
      ...directories.flatMap((directory) =>
        names.map((name) => join(directory, ".opencode", name)),
      ),
    );
  }
  return paths;
}

function parseConfig(
  text: string,
  source = "OpenCode config",
): Record<string, unknown> {
  const errors: ParseError[] = [];
  const config: unknown = parse(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first)
    throw new SyntaxError(
      `${source}: JSONC syntax error near offset ${first.offset} (code ${first.error})`,
    );
  if (!isRecord(config)) throw new TypeError(`${source} must be an object`);
  return config;
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
          (typeof configuration.modelID === "string" &&
            configuration.modelID.trim()) ||
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
