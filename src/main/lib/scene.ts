import path from 'node:path'
import fs from 'fs-extra'
import sleep from 'licia/sleep'
import endWith from 'licia/endWith'
import { shell as electronShell } from 'electron'
import { shell, spawnAdb } from './adb/base'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import * as window from 'share/main/lib/window'
import log from 'share/common/log'
import {
  IpcOpenSceneFolder,
  IpcSaveScene,
  IScene,
  ISceneRunResult,
  ISceneStep,
  ISceneStepResult,
} from 'common/types'

const logger = log('scene')

export function getScenesDir() {
  return resolveResources('scenes')
}

function assertValidSceneId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid scene id')
  }
}

function getSceneFile(id: string) {
  assertValidSceneId(id)
  return path.join(getScenesDir(), id, 'scene.json')
}

function resolveSceneFile(id: string, file: string) {
  assertValidSceneId(id)
  if (path.isAbsolute(file)) {
    return file
  }
  return path.join(getScenesDir(), id, file)
}

export async function listScenes(): Promise<IScene[]> {
  const dir = getScenesDir()
  if (!(await fs.pathExists(dir))) {
    return []
  }

  const scenes: IScene[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const sceneFile = getSceneFile(entry.name)
    if (!(await fs.pathExists(sceneFile))) {
      continue
    }
    try {
      const scene = await fs.readJson(sceneFile)
      if (scene && scene.id && Array.isArray(scene.steps)) {
        scenes.push(scene)
      }
    } catch (err) {
      logger.error('invalid scene json', entry.name, err)
    }
  }

  return scenes
}

async function getScene(id: string): Promise<IScene> {
  const sceneFile = getSceneFile(id)
  if (!(await fs.pathExists(sceneFile))) {
    throw new Error('Scene not found: ' + id)
  }
  return fs.readJson(sceneFile)
}

export async function runScene(
  deviceId: string,
  sceneId: string
): Promise<ISceneRunResult> {
  const scene = await getScene(sceneId)
  const steps: ISceneStepResult[] = []
  let success = true

  for (let i = 0, len = scene.steps.length; i < len; i++) {
    const step = scene.steps[i]
    const result = await runStep(deviceId, scene, step, i)
    steps.push(result)
    window.sendAll('sceneStep', sceneId, result)
    if (!result.success) {
      if (step.optional) {
        continue
      }
      success = false
      break
    }
  }

  return {
    sceneId,
    success,
    steps,
  }
}

async function runStep(
  deviceId: string,
  scene: IScene,
  step: ISceneStep,
  index: number
): Promise<ISceneStepResult> {
  const start = Date.now()
  const title = step.title || step.type
  const base: ISceneStepResult = {
    index,
    type: step.type,
    title,
    command: '',
    success: false,
    code: null,
    stdout: '',
    stderr: '',
    message: '',
    duration: 0,
  }

  function finish(
    data: Partial<ISceneStepResult>
  ): ISceneStepResult {
    return {
      ...base,
      ...data,
      duration: Date.now() - start,
    }
  }

  function commandResult(
    command: string,
    result: { stdout: string; stderr: string; code: number | null }
  ): ISceneStepResult {
    const { stdout, stderr, code } = result
    return finish({
      command,
      success: code === 0,
      code,
      stdout,
      stderr,
      message: code === 0 ? '' : stderr || stdout || 'Command failed',
    })
  }

  try {
    switch (step.type) {
      case 'wait-device': {
        const args = ['-s', deviceId, 'wait-for-device']
        const result = await spawnAdb(args)
        return commandResult('adb ' + args.join(' '), result)
      }
      case 'install': {
        const apk = step.apk || ''
        const apkPath = resolveSceneFile(scene.id, apk)
        if (!(await fs.pathExists(apkPath))) {
          return finish({
            command: 'adb install ' + apk,
            message: 'APK file not found: ' + apkPath,
          })
        }
        const args = [
          '-s',
          deviceId,
          'install',
          ...(step.args && step.args.length
            ? step.args
            : ['-r', '-t', '-d', '-g']),
          apkPath,
        ]
        const result = await spawnAdb(args)
        return commandResult('adb ' + args.join(' '), result)
      }
      case 'push': {
        const src = step.src || ''
        const srcPath = resolveSceneFile(scene.id, src)
        if (!(await fs.pathExists(srcPath))) {
          return finish({
            command: 'adb push ' + src,
            message: 'File not found: ' + srcPath,
          })
        }
        // Some devices drop the file extension when the destination is a
        // directory (e.g. test.mp3 -> test.), so always use a full path.
        let dest = step.dest || ''
        if (endWith(dest, '/')) {
          dest += path.basename(srcPath)
        }
        const args = ['-s', deviceId, 'push', srcPath, dest]
        const result = await spawnAdb(args)
        return commandResult('adb ' + args.join(' '), result)
      }
      case 'shell': {
        const command = step.command || ''
        const result = await runShellCommand(deviceId, command)
        return finish({
          command: 'adb shell ' + command,
          ...result,
          message: result.success ? '' : result.stderr || result.stdout || 'Command failed',
        })
      }
      case 'start': {
        const pkg = step.package || ''
        let command = ''
        if (step.activity) {
          command = 'am start -n ' + pkg + '/' + step.activity
        } else {
          command =
            'am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ' +
            pkg
        }
        const result = await runShellCommand(deviceId, command)
        return finish({
          command: 'adb shell ' + command,
          ...result,
          message: result.success ? '' : result.stderr || result.stdout || 'Failed to start package',
        })
      }
      case 'input': {
        const command = 'input keyevent ' + step.keyCode
        const result = await runShellCommand(deviceId, command)
        return finish({
          command: 'adb shell ' + command,
          ...result,
          message: result.success ? '' : result.stderr || result.stdout || 'Failed to input keyevent',
        })
      }
      case 'sleep': {
        const ms = step.ms || 0
        await sleep(ms)
        return finish({
          command: 'sleep ' + ms + 'ms',
          success: true,
          code: 0,
        })
      }
      default:
        return finish({
          message: 'Unknown step type: ' + (step as any).type,
        })
    }
  } catch (err) {
    return finish({
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function runShellCommand(deviceId: string, command: string) {
  try {
    const marker = 'AYA_SCENE_EXIT:'
    const output = await shell(deviceId, command + '; echo ' + marker + '$?')
    const lines = output.split('\n')
    const lastLine = lines[lines.length - 1].trim()
    let code = 0
    if (lastLine.indexOf(marker) === 0) {
      code = parseInt(lastLine.slice(marker.length), 10)
      lines.pop()
    }
    return {
      success: code === 0,
      code,
      stdout: lines.join('\n'),
      stderr: '',
    }
  } catch (err) {
    return {
      success: false,
      code: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    }
  }
}

const saveScene: IpcSaveScene = async function (scene) {
  if (!scene || !scene.id || !scene.name || !Array.isArray(scene.steps)) {
    throw new Error('Invalid scene')
  }
  assertValidSceneId(scene.id)
  const dir = path.join(getScenesDir(), scene.id)
  await fs.ensureDir(dir)
  await fs.writeJson(getSceneFile(scene.id), scene, { spaces: 2 })
}

const openSceneFolder: IpcOpenSceneFolder = async function (sceneId) {
  const dir = path.join(getScenesDir(), sceneId)
  await fs.ensureDir(dir)
  electronShell.openPath(dir)
}

export function init() {
  logger.info('init')

  handleEvent('getScenes', listScenes)
  handleEvent('runScene', runScene)
  handleEvent('saveScene', saveScene)
  handleEvent('openSceneFolder', openSceneFolder)
}
