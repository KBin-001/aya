import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { observer } from 'mobx-react-lite'
import map from 'licia/map'
import className from 'licia/className'
import { t } from 'common/util'
import Style from './Tabs.module.scss'
import store from '../../store'

export default observer(function Panels() {
  const tabItems = map(
    [
      'overview',
      'file',
      'application',
      'process',
      'performance',
      'shell',
      'layout',
      'screenshot',
      'logcat',
      'webview',
    ],
    (panel) => {
      return (
        <LunaTabItem
          key={panel}
          id={panel}
          title={t(panel)}
          selected={panel === store.panel}
        />
      )
    }
  )

  return (
    <LunaTab
      className={className(Style.container, {
        [Style.shellActive]: store.panel === 'shell' && store.theme === 'dark',
      })}
      height={31}
      onSelect={(panel) => store.selectPanel(panel)}
    >
      {tabItems}
    </LunaTab>
  )
})
