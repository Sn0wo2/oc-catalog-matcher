import type { Model } from "@opencode/plugin"

const core = await Promise.all([import("@opencode/core/aisdk-native"), import("@opencode/core/variant")]).catch(
  (error) => {
    console.warn("[model-catalog-match] @opencode/core unavailable; keeping target variants", error)
    return undefined
  },
)

export function resolveVariants(
  target: { model: Model.Info; providerPackage: string },
  donor: { model: Model.Info; providerPackage: string },
) {
  const model = target.model
  if (model.variants.length > 0 || donor.model.variants.length === 0 || !core) return model.variants
  const [aisdkNative, variant] = core
  const resolvePackage = (input: { model: Model.Info; providerPackage: string }) => {
    const packageName = input.model.package ?? input.providerPackage
    return packageName.startsWith("aisdk:")
      ? (aisdkNative.native(packageName.slice(6), {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
        }) ?? packageName)
      : packageName
  }
  const packageName = resolvePackage(target)
  if (packageName && packageName === resolvePackage(donor)) return structuredClone(donor.model.variants)
  const ids = new Set(donor.model.variants.map((entry) => String(entry.id)))
  const efforts = [...ids].filter((id) => id !== "thinking")
  const supports = [
    ...(efforts.some((id) => id !== "none") ? [{ type: "effort" as const, values: efforts }] : []),
    ...(ids.has("none") || ids.has("thinking") ? [{ type: "toggle" as const }] : []),
  ]
  const variants = variant.resolve({ ...model, package: packageName }, supports).filter((entry) => ids.has(entry.id))
  return variants.length > 0 ? variants : model.variants
}
