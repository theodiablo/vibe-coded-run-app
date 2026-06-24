import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Sets window.__NATIVE_SHELL__ inside the Capacitor shell before the app renders
// (no-op in the browser). Imported first so the flag is ready for everything.
import './native'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
