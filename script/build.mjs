import { spawnSync } from 'child_process'
import path from 'path'
import fs from 'fs-extra'

const rootDir = process.cwd()
const distDir = path.resolve(rootDir, 'dist')

const pkg = await fs.readJson(path.resolve(rootDir, 'package.json'))
const electron = pkg.devDependencies.electron
const distPkg = {
  ...pkg,
  main: 'main/index.js',
  devDependencies: {
    electron,
  },
  scripts: {
    start: 'electron main/index.js',
  },
}

runNpm(['run', 'build:main'], rootDir)
runNpm(['run', 'build:preload'], rootDir)
runNpm(['run', 'build:renderer'], rootDir)

await fs.copy(path.resolve(rootDir, 'build'), path.resolve(distDir, 'build'))
await fs.copy(
  path.resolve(rootDir, 'resources'),
  path.resolve(distDir, 'resources')
)

await fs.writeJson(path.resolve(distDir, 'package.json'), distPkg, {
  spaces: 2,
})

runNpm(['i', '--production'], distDir)

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath
  const command = npmExecPath ? process.execPath : 'npm'
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
