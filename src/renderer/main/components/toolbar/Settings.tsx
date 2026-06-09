import LunaToolbar from 'luna-toolbar/react'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { useState } from 'react'
import SettingsModal from './SettingsModal'
import { openUnlockRemount } from '../unlockRemount/UnlockRemount'
import store from '../../store'
import { observer } from 'mobx-react-lite'

export default observer(function Settings() {
  const [settingsModalVisible, setSettingsModalVisible] = useState(false)

  return (
    <>
      <LunaToolbar>
        <ToolbarIcon
          icon="unlock"
          title={'\u89e3\u9501Remount'}
          disabled={!store.device}
          onClick={openUnlockRemount}
        />
        <ToolbarIcon
          icon="setting"
          title={t('settings')}
          onClick={() => setSettingsModalVisible(true)}
        />
      </LunaToolbar>
      <SettingsModal
        visible={settingsModalVisible}
        onClose={() => setSettingsModalVisible(false)}
      />
    </>
  )
})
