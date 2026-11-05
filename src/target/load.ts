import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { Location } from "@opencode/plugin"
import { kebabCase } from "es-toolkit"
import { isPlainObject } from "es-toolkit/predicate"
import { type ParseError, parse } from "jsonc-parser"

export type Target = {
  providerID: string
  configKey: string
  cataID?: string
  providerCataID?: string
  modelKeys: readonly string[]
  providerKey: string
}

export async function loadTargets(location: Location.Info) {
  const directories = []
  const root = resolve(location.project.directory)
  let current = resolve(location.directory)
  while (true) {
    directories.unshift(current)
    if (process.platform === "win32" ? current.toLowerCase() === root.toLowerCase() : current === root) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const paths = [
    ...["opencode.json", "opencode.jsonc"].map((name) =>
      join(
        process.env["OPENCODE_CONFIG_DIR"]?.trim() ||
          join(process.env["XDG_CONFIG_HOME"]?.trim() || join(homedir(), ".config"), "opencode"),
        name,
      ),
    ),
    ...directories.flatMap((directory) => ["opencode.json", "opencode.jsonc"].map((name) => join(directory, name))),
    ...directories.flatMap((directory) =>
      ["opencode.json", "opencode.jsonc"].map((name) => join(directory, ".opencode", name)),
    ),
  ]
  const documents = await Promise.all(
    paths.map(async (path) => {
      const text = await Bun.file(path)
        .text()
        .catch(() => "")
      if (!text) return undefined
      try {
        const errors: ParseError[] = []
        const document = parse(text, errors, { allowTrailingComma: true })
        if (errors[0])
          throw new SyntaxError(`JSONC syntax error near offset ${errors[0].offset} (code ${errors[0].error})`)
        if (!isPlainObject(document)) throw new TypeError("config must be an object")
        return document
      } catch (error) {
        console.warn(`[model-catalog-match] ignoring invalid config at ${path}`, error)
        return undefined
      }
    }),
  )
  const providers = documents.flatMap((document) =>
    document && isPlainObject(document["providers"])
      ? Object.entries(document["providers"]).filter((entry): entry is [string, Record<string, unknown>] =>
          isPlainObject(entry[1]),
        )
      : [],
  )
  const providerCataIDs = new Map<string, string>()
  for (const [providerID, provider] of providers) {
    const cataID = typeof provider["cataID"] === "string" ? provider["cataID"].trim() : undefined
    if (cataID) providerCataIDs.set(providerID, cataID)
  }
  const targets = new Map<string, Target>()
  for (const [providerID, provider] of providers) {
    if (!isPlainObject(provider["models"])) continue
    const providerCataID = providerCataIDs.get(providerID)
    for (const [configKey, rawModel] of Object.entries(provider["models"])) {
      const previous = targets.get(`${providerID}\0${configKey}`)
      const raw = isPlainObject(rawModel) ? rawModel : undefined
      const rawCataID = typeof raw?.["cataID"] === "string" ? raw["cataID"].trim() : undefined
      const rawModelID = typeof raw?.["modelID"] === "string" ? raw["modelID"].trim() : undefined
      const cataID = rawCataID || rawModelID || previous?.cataID
      targets.set(`${providerID}\0${configKey}`, {
        providerID,
        configKey,
        modelKeys: [
          ...new Set(
            [rawCataID, rawModelID, previous?.cataID, configKey]
              .filter((id): id is string => Boolean(id))
              .map(kebabCase),
          ),
        ],
        providerKey: kebabCase(providerID),
        ...(cataID === undefined ? {} : { cataID }),
        ...(providerCataID === undefined ? {} : { providerCataID }),
      })
    }
  }
  return targets
}
