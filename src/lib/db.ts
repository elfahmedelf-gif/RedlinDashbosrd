// MOCK MODE — Prisma disabled to eliminate database engine overhead
// All data is served from static JSON (mock-data.json) via src/lib/mock-data.ts
// No PrismaClient, no libquery_engine, no SQLite — zero database memory footprint

export const db = null
