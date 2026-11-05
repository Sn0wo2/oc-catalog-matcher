import { appendFileSync } from "node:fs"
import { $ } from "bun"

try {
  for (const name of ["GITHUB_OUTPUT", "VERSION"]) if (!process.env[name]) throw new Error(`${name} is not set`)

  const packageDir = process.env.PACKAGE_DIR ?? "."
  const manifest = packageDir === "." ? "package.json" : `${packageDir}/package.json`

  await $`npm pkg set version=${process.env.VERSION}`.cwd(packageDir)
  await $`bun install`

  const changed = (await $`git diff --quiet -- ${manifest} bun.lock`.nothrow()).exitCode !== 0
  if (changed) appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n")
  console.log(
    changed ? `Package version synced to ${process.env.VERSION}.` : `Package version already ${process.env.VERSION}.`,
  )
} catch (error) {
  console.error(error.stderr?.trim() || error.message)
  process.exitCode = 1
}
