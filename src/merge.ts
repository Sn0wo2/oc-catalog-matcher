import type { Model } from "@opencode/plugin";
import { isEmptyObject, isPlainObject as isRecord } from "es-toolkit";
import { explicitMetadata } from "./catalog";
import type { Target } from "./config";
import type { ScoredMatch } from "./match";
import {
  MERGEABLE_KEYS,
  type MergeableKey,
  type MergeLayer,
  mergeRecords,
} from "./shared";

type ModelVariant = Model.Info["variants"][number];
export type CatalogModel = {
  -readonly [Key in keyof Model.Info]: Model.Info[Key];
};

const CONNECTION_KEYS: ReadonlySet<MergeableKey> = new Set([
  "settings",
  "headers",
  "body",
]);

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function configLayer(configuration: Record<string, unknown>): MergeLayer {
  const layer: MergeLayer = {};
  layer.name =
    configuration.name === undefined
      ? undefined
      : typeof configuration.name === "string"
        ? configuration.name
        : null;
  layer.family =
    configuration.family === undefined
      ? undefined
      : typeof configuration.family === "string"
        ? configuration.family
        : null;
  const rawLimit = configuration.limit;
  layer.limit =
    rawLimit === undefined
      ? undefined
      : isRecord(rawLimit) && !isEmptyObject(rawLimit)
        ? Object.fromEntries(
            ["context", "input", "output"]
              .map((key) => [key, asNumber(rawLimit[key])] as const)
              .filter(([_, value]) => value !== undefined),
          )
        : null;
  layer.capabilities =
    configuration.capabilities === undefined
      ? undefined
      : isRecord(configuration.capabilities) &&
          !isEmptyObject(configuration.capabilities)
        ? {
            ...(typeof configuration.capabilities.tools === "boolean"
              ? { tools: configuration.capabilities.tools }
              : {}),
            ...(Array.isArray(configuration.capabilities.input)
              ? {
                  input: configuration.capabilities.input.filter(
                    (item): item is string => typeof item === "string",
                  ),
                }
              : {}),
            ...(Array.isArray(configuration.capabilities.output)
              ? {
                  output: configuration.capabilities.output.filter(
                    (item): item is string => typeof item === "string",
                  ),
                }
              : {}),
          }
        : null;
  layer.cost =
    configuration.cost === undefined
      ? undefined
      : Array.isArray(configuration.cost)
        ? configuration.cost.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const input = asNumber(entry.input);
            const output = asNumber(entry.output);
            if (input === undefined || output === undefined) return [];
            const cacheValue = isRecord(entry.cache) ? entry.cache : entry;
            const tierSize =
              isRecord(entry.tier) && entry.tier.type === "context"
                ? asNumber(entry.tier.size)
                : undefined;
            return [
              {
                ...(tierSize === undefined
                  ? {}
                  : { tier: { type: "context", size: tierSize } }),
                input,
                output,
                cache: {
                  read:
                    asNumber(cacheValue.read) ??
                    asNumber(cacheValue.cache_read) ??
                    0,
                  write:
                    asNumber(cacheValue.write) ??
                    asNumber(cacheValue.cache_write) ??
                    0,
                },
              },
            ];
          })
        : null;
  layer.compatibility =
    configuration.compatibility === undefined
      ? undefined
      : isRecord(configuration.compatibility) &&
          !isEmptyObject(configuration.compatibility)
        ? structuredClone(configuration.compatibility)
        : null;
  for (const key of ["settings", "headers", "body"] as const) {
    if (configuration[key] === undefined) continue;
    layer[key] =
      key === "headers"
        ? isRecord(configuration.headers)
          ? Object.fromEntries(
              Object.entries(configuration.headers).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            )
          : null
        : isRecord(configuration[key])
          ? structuredClone(configuration[key])
          : null;
  }
  layer.variants =
    configuration.variants === undefined
      ? undefined
      : Array.isArray(configuration.variants)
        ? configuration.variants.flatMap((value) =>
            isRecord(value) && typeof value.id === "string"
              ? [structuredClone(value)]
              : [],
          )
        : null;
  layer.enabled =
    typeof configuration.disabled === "boolean"
      ? !configuration.disabled
      : configuration.enabled === undefined
        ? undefined
        : typeof configuration.enabled === "boolean"
          ? configuration.enabled
          : null;
  return layer;
}

function variantEffort(variant: Record<string, unknown>): string | undefined {
  const settings = variant.settings;
  if (isRecord(settings) && typeof settings.reasoningEffort === "string")
    return settings.reasoningEffort;
  const body = variant.body;
  const reasoning = isRecord(body) ? body.reasoning : undefined;
  if (isRecord(reasoning) && typeof reasoning.effort === "string")
    return reasoning.effort;
  if (isRecord(body) && typeof body.reasoning_effort === "string")
    return body.reasoning_effort;
  return undefined;
}

function alignEffort(
  variant: Record<string, unknown>,
  effort: string | undefined,
  ...baseBodies: unknown[]
): void {
  if (effort === undefined) return;
  const settings = isRecord(variant.settings) ? variant.settings : {};
  variant.settings = { ...settings, reasoningEffort: effort };
  const body = isRecord(variant.body) ? variant.body : {};
  const sources = [body, ...baseBodies].filter(isRecord);
  if (sources.some((source) => typeof source.reasoning_effort === "string")) {
    body.reasoning_effort = effort;
  }
  if (
    sources.some(
      (source) =>
        isRecord(source.reasoning) &&
        typeof source.reasoning.effort === "string",
    )
  ) {
    body.reasoning = {
      ...(isRecord(body.reasoning) ? body.reasoning : {}),
      effort,
    };
  }
  if (!isEmptyObject(body)) variant.body = body;
}

export function applyMetadata(
  model: CatalogModel,
  target: Target,
  donorMatch: ScoredMatch | undefined,
  providerBody: unknown,
): void {
  const layer = target.configuration
    ? configLayer(target.configuration)
    : undefined;
  const donor: MergeLayer = {};
  if (donorMatch) {
    const sameProvider = donorMatch.candidate.providerID === target.providerID;
    for (const key of MERGEABLE_KEYS) {
      if (!sameProvider && CONNECTION_KEYS.has(key)) continue;
      const value = donorMatch.candidate.metadata[key];
      if (value !== undefined) donor[key] = structuredClone(value);
    }
  }
  const merged: Record<string, unknown> = {};
  const cleared = new Set<MergeableKey>();
  for (const source of [
    explicitMetadata(model),
    layer !== undefined && !isEmptyObject(layer) ? layer : undefined,
    donorMatch ? donor : undefined,
  ]) {
    if (!source) continue;
    for (const key of MERGEABLE_KEYS) {
      if (cleared.has(key) || !(key in source)) continue;
      const value = source[key];
      if (value === undefined) continue;
      if (value === null) {
        cleared.add(key);
        continue;
      }
      if (
        (Array.isArray(value) && value.length === 0) ||
        isEmptyObject(value)
      ) {
        merged[key] = value;
        cleared.add(key);
        continue;
      }
      const existing = merged[key];
      if (key === "variants") {
        const variantMerged = new Map<string, Record<string, unknown>>();
        for (const variantLayer of [
          existing as readonly ModelVariant[] | undefined,
          value as readonly ModelVariant[],
        ]) {
          if (!variantLayer) continue;
          for (const rawVariant of variantLayer) {
            const variant = rawVariant as unknown as Record<string, unknown>;
            const variantExisting = variantMerged.get(rawVariant.id);
            if (!variantExisting) {
              alignEffort(variant, variantEffort(variant));
              variantMerged.set(rawVariant.id, variant);
              continue;
            }
            const locked =
              variantEffort(variantExisting) ?? variantEffort(variant);
            const combined = mergeRecords(variant, variantExisting) as Record<
              string,
              unknown
            >;
            alignEffort(combined, locked);
            variantMerged.set(rawVariant.id, combined);
          }
        }
        merged[key] = [...variantMerged.values()];
      } else if (isRecord(existing) && isRecord(value)) {
        merged[key] = mergeRecords(value, existing);
      } else {
        merged[key] = existing ?? value;
      }
    }
  }
  if (Array.isArray(merged.variants)) {
    for (const variant of merged.variants) {
      alignEffort(variant, variantEffort(variant), providerBody, merged.body);
    }
  }
  for (const key of MERGEABLE_KEYS) {
    const value = merged[key];
    if (value === undefined) continue;
    Object.assign(model, { [key]: value });
  }
}
