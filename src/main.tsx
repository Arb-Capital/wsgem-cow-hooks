import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { resolveVenue, VENUES } from './venues'
import './styles.css'

// Each venue is its own hook dapp at /<slug>/ — the path picks the config. The root (and any
// unknown path) renders the venue directory, which doubles as the landing page.
const venue = resolveVenue(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {venue ? (
      <App venue={venue} />
    ) : (
      <main className="card">
        <h1>wsgem CoW hooks</h1>
        <p>
          Each venue is a separate CoW Swap hook dapp with its own URL — paste a venue URL into CoW
          Swap → Hooks → My Custom Hooks (or find it in the Hook Store once listed):
        </p>
        <ul>
          {Object.values(VENUES).map((v) => (
            <li key={v.slug}>
              <a href={`${v.slug}/`}>{v.name}</a> ({v.chainLabel})
            </li>
          ))}
        </ul>
      </main>
    )}
  </React.StrictMode>,
)
