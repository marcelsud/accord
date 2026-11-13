import DefaultTheme from 'vitepress/theme'
import './custom.css'
import 'virtual:group-icons.css'
// Package-manager tab syncing adapted from honojs/website (MIT).
import { useSyncedPackageManagerCodeGroups } from './use-synced-package-manager-code-groups'

export default {
  extends: DefaultTheme,
  setup() {
    useSyncedPackageManagerCodeGroups()
  },
}
