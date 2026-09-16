#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(dir)
  // npm rate-limits bursts (E429) when publishing many packages back-to-back,
  // so retry with a delay before giving up.
  const attempts = 6
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir).nothrow()
    if (result.exitCode === 0) return
    if (attempt === attempts) process.exit(result.exitCode)
    const delay = Math.min(120_000 * attempt, 600_000)
    console.log(`npm publish of ${name} failed (attempt ${attempt}/${attempts}), retrying in ${delay / 1000}s...`)
    await Bun.sleep(delay)
  }
}

const binaries: Record<string, { version: string; dir: string }> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = { version: pkg.version, dir: filepath.split("/")[0] }
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0].version

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/bin/${pkg.name}.exe`).write(
  [
    `echo "Error: @digitain-com/${pkg.name}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/@digitain-com/${pkg.name} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall @digitain-com/${pkg.name} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "@digitain-com/" + pkg.name,
      bin: {
        [pkg.name]: `./bin/${pkg.name}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: Object.fromEntries(Object.entries(binaries).map(([name, b]) => [name, b.version])),
    },
    null,
    2,
  ),
)

for (const [name, { version, dir }] of Object.entries(binaries)) {
  await publish(`./dist/${dir}`, name, version)
}
await publish(`./dist/${pkg.name}`, `@digitain-com/${pkg.name}`, version)
