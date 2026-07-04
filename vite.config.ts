import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { CHAINS } from './src/chains'
import { VENUES } from './src/venues'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Every venue in src/venues.ts must ship its static companions (entry HTML + manifest + icon), and
 * the manifests must stay in sync with the config. Failing the build here (and on dev-server start)
 * is what keeps "add a venue" a checklist instead of a debugging session — see
 * docs/adding-a-venue.md.
 */
function validateVenues() {
  const seenIds = new Map<string, string>()
  for (const [key, venue] of Object.entries(VENUES)) {
    const at = `VENUES.${key} (src/venues.ts)`
    const fail = (msg: string) => {
      throw new Error(`[venues] ${at}: ${msg} — see docs/adding-a-venue.md`)
    }

    if (key !== venue.slug) fail(`key "${key}" must equal slug "${venue.slug}"`)
    if (!/^[a-z0-9-]+$/.test(venue.slug)) fail(`slug must be lowercase [a-z0-9-]`)
    if (!CHAINS[venue.chainId]) {
      fail(`chainId ${venue.chainId} has no viem chain in src/chains.ts — add it there`)
    }

    if (!existsSync(resolve(root, venue.slug, 'index.html'))) {
      fail(`missing entry page ${venue.slug}/index.html`)
    }
    const manifestPath = resolve(root, 'public', venue.slug, 'manifest.json')
    if (!existsSync(manifestPath)) fail(`missing public/${venue.slug}/manifest.json`)
    if (!existsSync(resolve(root, 'public', venue.slug, 'icon.svg'))) {
      fail(`missing public/${venue.slug}/icon.svg`)
    }

    const dapp = JSON.parse(readFileSync(manifestPath, 'utf8')).cow_hook_dapp
    if (!dapp) fail(`manifest has no cow_hook_dapp object`)
    if (!/^[0-9a-f]{64}$/.test(dapp.id ?? '')) {
      fail(`cow_hook_dapp.id must be 64 lowercase hex chars (openssl rand -hex 32)`)
    }
    const dup = seenIds.get(dapp.id)
    if (dup) fail(`cow_hook_dapp.id duplicates venue "${dup}" — every venue needs a fresh id`)
    seenIds.set(dapp.id, venue.slug)
    if (dapp.name !== venue.name) {
      fail(`cow_hook_dapp.name "${dapp.name}" != venue name "${venue.name}"`)
    }
    if (!dapp.conditions?.supportedNetworks?.includes(venue.chainId)) {
      fail(`manifest conditions.supportedNetworks must include chainId ${venue.chainId}`)
    }
  }
}

validateVenues()

export default defineConfig({
  plugins: [react()],
  // MPA: one HTML entry per venue (dist/<slug>/index.html) plus the root venue directory.
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        ...Object.fromEntries(
          Object.values(VENUES).map((v) => [v.slug, resolve(root, v.slug, 'index.html')]),
        ),
      },
    },
  },
  server: {
    port: 5180,
    // CoW Swap loads the dapp in an iframe; allow it during local "My Custom Hooks" testing.
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
})
