import { appendFileSync } from "node:fs"
import { $ } from "bun"

try {
  for (const name of ["GITHUB_OUTPUT", "VERSION", "GH_TOKEN", "DEFAULT_BRANCH"])
    if (!process.env[name]) throw new Error(`${name} is not set`)

  const version = process.env.VERSION
  const tag = `v${version}`
  const defaultBranch = process.env.DEFAULT_BRANCH
  const packageDir = process.env.PACKAGE_DIR ?? "."
  const manifest = packageDir === "." ? "package.json" : `${packageDir}/package.json`

  await $`git config user.name github-actions[bot]`
  await $`git config user.email github-actions[bot]@users.noreply.github.com`
  await $`git add -u -- ${manifest} bun.lock`

  const tagExists = (await $`git show-ref --verify --quiet refs/tags/${tag}`.nothrow()).exitCode === 0
  const staged = (await $`git diff --cached --quiet`.nothrow()).exitCode !== 0
  if (staged) await $`git commit -m ${`chore(release): bump version to ${version}`}`
  const releaseSha = (await $`git rev-parse HEAD`).stdout.trim()

  if (!staged && tagExists) {
    console.log(`Tag ${tag} already points at the checked version; nothing to commit.`)
  } else if (tagExists) {
    await $`git fetch origin ${defaultBranch}`
    await $`git checkout --detach FETCH_HEAD`
    const picked = await $`git cherry-pick ${releaseSha}`.nothrow()
    if (picked.exitCode !== 0) {
      if ((await $`git diff --cached --quiet`.nothrow()).exitCode !== 0)
        throw new Error(`\`git cherry-pick ${releaseSha}\` failed: ${picked.stderr?.trim() || picked.stdout?.trim()}`)
      await $`git cherry-pick --skip`
      console.log(`Version bump for ${tag} is already on ${defaultBranch}; nothing to cherry-pick.`)
    } else {
      await $`git -c "credential.helper=!gh auth git-credential" push origin HEAD:refs/heads/${defaultBranch}`
      console.log(`Cherry-picked the version bump for ${tag} onto ${defaultBranch}.`)
    }
  } else {
    await $`git tag ${tag}`
    await $`git -c "credential.helper=!gh auth git-credential" push --atomic origin HEAD:refs/heads/${defaultBranch} refs/tags/${tag}`
    console.log(`Tagged ${tag} and pushed it with ${defaultBranch}.`)
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${releaseSha}\n`)
} catch (error) {
  console.error(error.stderr?.trim() || error.message)
  process.exitCode = 1
}
