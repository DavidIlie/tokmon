import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './styles.css'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { App } from './app'
import { ShareProvider } from './components/share-provider'
import { installPreloadRecovery } from './lib/preload-recovery'

installPreloadRecovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NuqsAdapter>
      <ShareProvider>
        <App />
      </ShareProvider>
    </NuqsAdapter>
  </StrictMode>,
)
