import type { Model } from "@opencode/plugin";

type Support = import("@opencode/core/variant").Variant.Support;

let core:
  | [
      typeof import("@opencode/core/aisdk-native"),
      typeof import("@opencode/core/variant"),
    ]
  | undefined;

/**
 * Preloads @opencode/core once. A failed load only disables variant respelling;
 * the rest of the plugin keeps working.
 */
export async function loadCore() {
  core ??= await Promise.all([
    import("@opencode/core/aisdk-native"),
    import("@opencode/core/variant"),
  ]).catch((error) => {
    console.warn(
      "[model-catalog-match] @opencode/core unavailable; keeping target variants",
      error,
    );
    return undefined;
  });
}

function nativePackage(
  native: (typeof import("@opencode/core/aisdk-native"))["AISDKNative"],
  model: Model.Info,
  providerPackage: string,
) {
  const packageName = model.package ?? providerPackage;
  return packageName.startsWith("aisdk:")
    ? (native.native(packageName.slice(6), {
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
) {
  if (model.variants.length > 0 || donor.variants.length === 0 || !core)
    return model.variants;
  const [aisdkNative, variant] = core;
  const packageName = nativePackage(
    aisdkNative.AISDKNative,
    model,
    providerPackage,
  );
  const donorPackage = nativePackage(
    aisdkNative.AISDKNative,
    donor,
    donorProviderPackage,
  );
  if (packageName && packageName === donorPackage)
    return structuredClone(donor.variants);
  const ids = new Set(donor.variants.map((entry) => String(entry.id)));
  const supports: Support[] = [];
  if ([...ids].some((id) => id !== "none" && id !== "thinking"))
    supports.push({ type: "effort" });
  if (ids.has("none") || ids.has("thinking")) supports.push({ type: "toggle" });
  const variants = variant.Variant.resolve(
    { ...model, package: packageName },
    supports,
  ).filter((entry) => ids.has(entry.id));
  return variants.length > 0 ? variants : model.variants;
}
