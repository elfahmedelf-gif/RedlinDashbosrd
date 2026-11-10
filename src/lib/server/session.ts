// ============================================================================
// جلسات الخادم — token → SessionUser (مع إعادة التحقق من المستخدم في كل طلب)
// ============================================================================
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { matchPermission, type SessionUser } from '../permissions'
import { ApiError } from './http'
import { hashPassword, parsePerms } from './passwords'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

const sessions = new Map<string, { userId: string; loginAt: string; at: number }>()

/** بناء جلسة كاملة من مستخدم قاعدة البيانات — يدمج صلاحيات كل الأدوار المسندة للمستخدم */
async function buildSessionUser(userId: string, loginAt: string): Promise<SessionUser | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  })
  if (!u || !u.active) return null
  const roles = u.roles.map((ur) => ur.role).filter(Boolean)
  // دمج صلاحيات كل الأدوار (دعم تعدد الأدوار للمستخدم الواحد)
  const permSet = new Set<string>()
  for (const r of roles) {
    for (const p of parsePerms(r?.permissions)) permSet.add(p)
  }
  const perms = Array.from(permSet)
  // الإدارة: لو مفيش صلاحيات صريحة والدور admin — افتح الكل
  if (!perms.length && roles.some((r) => r?.name === 'admin')) perms.push('*')
  const primaryRole = roles[0] ?? null
  return {
    userId: u.id,
    username: u.username,
    name: u.name,
    roleId: primaryRole?.id ?? null,
    roleName: primaryRole?.name ?? null,
    roleLabel: primaryRole?.label ?? null,
    permissions: perms,
    loginAt,
  }
}

export async function authLoginUser(username: string, password: string) {
  const uname = String(username ?? '').trim()
  const u = await db.user.findUnique({ where: { username: uname }, include: { roles: { include: { role: true } } } })
  if (!u || u.password !== hashPassword(String(password ?? ''))) {
    throw new ApiError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة')
  }
  if (!u.active) throw new ApiError(403, 'هذا الحساب موقوف — راجع مدير النظام')
  const loginAt = new Date().toISOString()
  const user = await buildSessionUser(u.id, loginAt)
  if (!user) throw new ApiError(403, 'هذا الحساب موقوف — راجع مدير النظام')
  const token = randomUUID()
  sessions.set(token, { userId: u.id, loginAt, at: Date.now() })
  await db.auditLog.create({ data: { userId: u.id, userName: u.username, action: 'login', entity: 'user', entityId: u.id, notes: `تسجيل دخول المستخدم ${u.name} (${u.username})` } }).catch(() => {})
  return { token, user }
}

export async function authValidateToken(token: string): Promise<SessionUser | null> {
  const s = sessions.get(token)
  if (!s) return null
  if (Date.now() - s.at > SESSION_TTL_MS) {
    sessions.delete(token)
    return null
  }
  // إعادة التحقق من حالة المستخدم والصلاحيات من قاعدة البيانات في كل طلب
  const user = await buildSessionUser(s.userId, s.loginAt)
  if (!user) {
    sessions.delete(token)
    return null
  }
  s.at = Date.now()
  return user
}

export async function authLogoutToken(token: string): Promise<void> {
  const s = sessions.get(token)
  if (s) {
    sessions.delete(token)
    const u = await db.user.findUnique({ where: { id: s.userId } }).catch(() => null)
    if (u) {
      await db.auditLog.create({ data: { userId: u.id, userName: u.username, action: 'logout', entity: 'user', entityId: u.id, notes: `تسجيل خروج المستخدم ${u.name} (${u.username})` } }).catch(() => {})
    }
  }
}

export function tokenFrom(req: Request): string {
  return req.headers.get('x-session-token')?.trim() ?? ''
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = tokenFrom(req)
  if (!token) return null
  return authValidateToken(token)
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req)
  if (!user) throw new ApiError(401, 'غير مصرح — سجّل الدخول أولًا')
  return user
}

/** يفرض صلاحية من الخادم — الحماية الحقيقية وليست في الواجهة فقط */
export async function requirePerm(req: Request, key: string): Promise<SessionUser> {
  const user = await requireUser(req)
  if (!matchPermission(user.permissions, key)) {
    throw new ApiError(403, `غير مصرح — هذه العملية تتطلب صلاحية "${key}"`)
  }
  return user
}
