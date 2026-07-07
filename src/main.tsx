import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { resolveVenue, VENUES } from './venues'
import './styles.css'

// The dapp renders inside CoW Swap's iframe — an unhandled render error would otherwise leave a
// silent blank frame with no console the user can see.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="card">
          <p>Something went wrong — reload the page to try again.</p>
        </main>
      )
    }
    return this.props.children
  }
}

// Each venue is its own hook dapp at /<slug>/ — the path picks the config. The root (and any
// unknown path) renders the venue directory, which doubles as the landing page.
const venue = resolveVenue(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {venue ? (
      <ErrorBoundary>
        <App venue={venue} />
      </ErrorBoundary>
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
