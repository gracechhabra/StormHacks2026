import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { CHAT_KEY } from './hooks/useChat'
import './index.css'

// Arriving from the world generator with a new location: start with a clean chat
if (new URLSearchParams(window.location.search).has('lat')) localStorage.removeItem(CHAT_KEY)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
