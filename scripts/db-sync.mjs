// ============================================================================
// Startup schema sync — runs before the production server starts.
//
// Ensures the SQLite database exists and matches prisma/schema.prisma in any
// freshly provisioned deployment container (where the project may live at a
// different path and .env may not exist at all).
//
// The database path is pinned to "<current working directory>/db/custom.db"
// — npm/next scripts always run from the project root, so this resolves to
// the same file in the local sandbox and in the cloud container.
// ============================================================================
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dbFile = path.join(process.cwd(), 'db', 'custom.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

// Prefer the locally installed prisma binary (no npx network lookup).
const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma')
const cmd = fs.existsSync(prismaBin) ? `"${prismaBin}"` : 'npx prisma'

const env = { ...process.env, DATABASE_URL: `file:${dbFile}` }
try {
  execSync(`${cmd} db push --accept-data-loss --skip-generate`, {
    stdio: 'inherit',
    env,
  })
} catch (err) {
  console.error('[db-sync] prisma db push failed:', err?.message ?? err)
  process.exit(1)
}
