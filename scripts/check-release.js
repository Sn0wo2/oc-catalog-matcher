import { appendFileSync } from "node:fs"

try {
  for (const name of ["GITHUB_REPOSITORY", "GH_TOKEN", "GITHUB_OUTPUT"])
    if (!process.env[name]) throw new Error(`${name} is not set`)

  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
  if (!tag) throw new Error("Release tag is not set")

  const parts = process.env.GITHUB_REPOSITORY.split("/")
  if (parts.length !== 2 || parts.some((part) => !part))
    throw new Error("GITHUB_REPOSITORY must be in owner/name format")
  const [owner, name] = parts

  const response = await fetch(process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query($owner: String!, $name: String!, $tag: String!) {
        repository(owner: $owner, name: $name) {
          release(tagName: $tag) { isDraft }
        }
      }`,
      variables: { owner, name, tag },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`)

  const result = await response.json()
  const errors = result?.errors
  if (errors !== undefined && (!Array.isArray(errors) || errors.some((error) => typeof error?.message !== "string")))
    throw new Error("Invalid release lookup response")
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "))

  const repository = result?.data?.repository
  if (typeof repository !== "object" || repository === null || !Object.hasOwn(repository, "release"))
    throw new Error("Repository lookup failed")

  const release = repository.release
  if (release !== null && (typeof release !== "object" || typeof release.isDraft !== "boolean"))
    throw new Error("Invalid release lookup response")

  const skip = release !== null && !release.isDraft
  appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`)
  console.log(skip ? `Release ${tag} is already published; skipping.` : `Release ${tag} is not published; continuing.`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
