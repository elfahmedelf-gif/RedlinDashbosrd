import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const envUrl = process.env.DATABASE_URL ?? ''

if (!envUrl || envUrl.startsWith('file:')) {
  const envFile = envUrl.startsWith('file:') ? envUrl.slice('file:'.length) : ''
  if (!envFile || !path.isAbsolute(envFile)) {
    const dbFile = path.join(process.cwd(), 'db', 'custom.db')
    try {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true })
    } catch {}
    process.env.DATABASE_URL = `file:${dbFile}`
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
