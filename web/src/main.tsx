import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles.css'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { App } from './app'
import { ShareProvider } from './components/share-provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NuqsAdapter>
      <ShareProvider>
        <App />
      </ShareProvider>
    </NuqsAdapter>
  </StrictMode>,
)
