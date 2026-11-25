import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', 'prisma')
const cmd = fs.existsSync(prismaBin) ? `"${prismaBin}"` : 'npx prisma'
if (!process.env.DATABASE_URL) {
  console.error('[db-sync] ERROR: DATABASE_URL is empty!')
  process.exit(1)
}
execSync(`${cmd} db push --accept-data-loss --skip-generate`, { stdio: 'inherit', env: process.env })
