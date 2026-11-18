// Prisma client — real SQLite persistence (S1 migration from mock mode)
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

// ---------------------------------------------------------------------------
// Pin the SQLite database location to "<project root>/db/custom.db".
//
// Why: relative `file:` URLs are resolved by the Prisma CLI against
// prisma/schema.prisma while runtime resolution varies per environment, and an
// absolute path in .env would break in a cloud container where the project
// lives at a different path (or .env may not ship at all). Computing the path
// from process.cwd() — always the project root for `next dev` / `next start`
// and npm scripts — works identically everywhere, with or without .env.
// ---------------------------------------------------------------------------
const envUrl = process.env.DATABASE_URL ?? ''
const envFile = envUrl.startsWith('file:') ? envUrl.slice('file:'.length) : ''
if (!envFile || !path.isAbsolute(envFile)) {
  const dbFile = path.join(process.cwd(), 'db', 'custom.db')
  try {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  } catch {
    // directory already exists or FS is read-only — prisma will surface a clear error if unusable
  }
  process.env.DATABASE_URL = `file:${dbFile}`
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
