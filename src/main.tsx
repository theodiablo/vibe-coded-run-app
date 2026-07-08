import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Sets window.__NATIVE_SHELL__ inside the Capacitor shell before the app renders
// (no-op in the browser). Imported first so the flag is ready for everything.
import './native'
import { initTelemetry, installGlobalErrorHandlers } from './telemetry'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'

// Start telemetry (no-op until a provider is wired in and the user consents)
// and catch foreground errors that escape React. Both honour the consent flag.
initTelemetry()
installGlobalErrorHandlers()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
