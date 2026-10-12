import { deepmergeCustom } from "deepmerge-ts";

export const mergeRecords = deepmergeCustom({ mergeArrays: false });

export const MERGEABLE_KEYS = [
  "name",
  "family",
  "capabilities",
  "limit",
  "cost",
  "compatibility",
  "time",
  "settings",
  "headers",
  "body",
  "variants",
  "enabled",
] as const;

export type MergeableKey = (typeof MERGEABLE_KEYS)[number];
export type MergeLayer = Partial<Record<MergeableKey, unknown>>;
