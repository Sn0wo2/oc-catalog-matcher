import { AISDKNative } from "@opencode/core/aisdk-native";
import { Variant } from "@opencode/core/variant";
import type { Model } from "@opencode/plugin";

function nativePackage(model: Model.Info, providerPackage: string): string {
  const packageName = model.package ?? providerPackage;
  return packageName.startsWith("aisdk:")
    ? (AISDKNative.native(packageName.slice(6), {
        providerID: model.providerID,
        modelID: model.modelID,
      }) ?? packageName)
    : packageName;
}

export function resolveVariants(
  model: Model.Info,
  donor: Model.Info,
  providerPackage: string,
  donorProviderPackage: string,
): Model.Info["variants"] {
  if (model.variants.length > 0 || donor.variants.length === 0)
    return model.variants;
  const packageName = nativePackage(model, providerPackage);
  const donorPackage = nativePackage(donor, donorProviderPackage);
  if (packageName && packageName === donorPackage)
    return structuredClone(donor.variants);
  const ids = new Set(donor.variants.map((variant) => String(variant.id)));
  const supports: Variant.Support[] = [];
  if ([...ids].some((id) => id !== "none" && id !== "thinking"))
    supports.push({ type: "effort" });
  if (ids.has("none") || ids.has("thinking")) supports.push({ type: "toggle" });
  const variants = Variant.resolve(
    { ...model, package: packageName },
    supports,
  ).filter((variant) => ids.has(variant.id));
  return variants.length > 0 ? variants : model.variants;
}
