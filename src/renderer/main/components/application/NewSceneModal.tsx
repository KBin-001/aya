import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import LunaModal from 'luna-modal/react'
import { t } from 'common/util'
import { notify } from 'share/renderer/lib/util'
import { IModalProps } from 'share/common/types'
import { IScene } from 'common/types'
import Style from './NewSceneModal.module.scss'

interface IProps extends IModalProps {
  onSaved: () => void
}

const exampleSteps = [
  { type: 'wait-device', title: 'adb wait-for-device' },
  {
    type: 'install',
    apk: 'TestApp.apk',
    args: ['-r', '-t', '-d', '-g'],
    title: 'adb install -r -t -d -g TestApp.apk',
  },
  {
    type: 'push',
    src: 'test.mp3',
    dest: '/sdcard/Music/',
    title: 'adb push test.mp3 /sdcard/Music/',
  },
  {
    type: 'start',
    package: 'com.example.testapp',
    optional: true,
    title: 'Start TestApp',
  },
]

export default function NewSceneModal(props: IProps) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [stepsJson, setStepsJson] = useState(
    JSON.stringify(exampleSteps, null, 2)
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (props.visible) {
      setName('')
      setId('')
      setIcon('')
      setDescription('')
      setStepsJson(JSON.stringify(exampleSteps, null, 2))
    }
  }, [props.visible])

  function loadExample() {
    setName(t('sceneExampleName'))
    setId('audio_test')
    setIcon('🔊')
    setDescription(t('sceneExampleDesc'))
    setStepsJson(JSON.stringify(exampleSteps, null, 2))
  }

  async function save() {
    if (!name.trim()) {
      notify(t('sceneNameRequired'), { icon: 'error' })
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
      notify(t('sceneIdInvalid'), { icon: 'error' })
      return
    }
    let steps
    try {
      steps = JSON.parse(stepsJson)
    } catch {
      notify(t('sceneStepsInvalid'), { icon: 'error' })
      return
    }
    if (!Array.isArray(steps)) {
      notify(t('sceneStepsInvalid'), { icon: 'error' })
      return
    }
    const scene: IScene = {
      id: id.trim(),
      name: name.trim(),
      icon: icon.trim(),
      description: description.trim(),
      steps,
    }
    setSaving(true)
    try {
      await main.saveScene(scene)
      props.onSaved()
      props.onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), { icon: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <LunaModal
      title={t('newScene')}
      visible={props.visible}
      width={520}
      onClose={props.onClose}
    >
      <div className={Style.container}>
        <div className={Style.row}>
          <label className={Style.label}>{t('sceneName')}</label>
          <input
            className={Style.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sceneNamePlaceholder')}
          />
        </div>
        <div className={Style.row}>
          <label className={Style.label}>{t('sceneId')}</label>
          <input
            className={Style.input}
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="audio_test"
          />
        </div>
        <div className={Style.row}>
          <label className={Style.label}>{t('sceneIcon')}</label>
          <input
            className={Style.input}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🔊"
          />
        </div>
        <div className={Style.row}>
          <label className={Style.label}>{t('sceneDescription')}</label>
          <input
            className={Style.input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className={Style.row}>
          <label className={Style.label}>{t('sceneSteps')}</label>
          <textarea
            className={Style.steps}
            value={stepsJson}
            onChange={(e) => setStepsJson(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className={Style.footer}>
          <button
            className={Style.button}
            onClick={loadExample}
          >
            {t('sceneLoadExample')}
          </button>
          <div className={Style.actions}>
            <button className={Style.button} onClick={props.onClose}>
              {t('cancel')}
            </button>
            <button
              className={Style.buttonPrimary}
              disabled={saving}
              onClick={save}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </LunaModal>,
    document.body
  )
}
