/**
 * main.tsx
 *
 * Application entry point. Mounts the React app into the #root div in index.html.
 * This file should be as small as possible — just the mount call.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
