// ============================================================================
// سكربت مزامنة دور "prices_viewer" + إسناده لمحمود (ops) على قاعدة البيانات الحية
// يُشغّل مرة واحدة بعد تعديل seed.ts لضمان تطبيق التغييرات على القاعدة الموجودة
// دون إعادة التهيئة. Usage: bun scripts/sync-prices-role.ts
// ============================================================================
import { db } from '../src/lib/db'

async function main() {
  // 1) تأكد من وجود دور prices_viewer (أنشئه إن لم يوجد)
  let pricesRole = await db.role.findUnique({ where: { name: 'prices_viewer' } })
  if (!pricesRole) {
    pricesRole = await db.role.create({
      data: {
        name: 'prices_viewer',
        label: 'رؤية الأسعار (خاص)',
        permissions: JSON.stringify(['prices.view', 'reports.view']),
      },
    })
    console.log(`[sync] أُنشئ دور prices_viewer (${pricesRole.id})`)
  } else {
    // تأكد من تحديث الأذونات لضمان التطابق مع seed.ts
    await db.role.update({
      where: { id: pricesRole.id },
      data: {
        label: 'رؤية الأسعار (خاص)',
        permissions: JSON.stringify(['prices.view', 'reports.view']),
      },
    })
    console.log(`[sync] دور prices_viewer موجود (${pricesRole.id}) — حُدّثت أذوناته`)
  }

  // 2) ابحث عن مستخدم ops (محمود) وأسند له الدور (إضافة على دور branch_manager)
  const opsUser = await db.user.findUnique({
    where: { username: 'ops' },
    include: { roles: { include: { role: true } } },
  })
  if (!opsUser) {
    console.error('[sync] مستخدم ops غير موجود — تأكد من تهيئة قاعدة البيانات')
    process.exit(1)
  }
  const hasPricesRole = opsUser.roles.some((ur) => ur.roleId === pricesRole.id)
  if (!hasPricesRole) {
    await db.userRole.create({
      data: { userId: opsUser.id, roleId: pricesRole.id },
    })
    console.log(`[sync] أُسند دور prices_viewer لمحمود (ops ${opsUser.id})`)
  } else {
    console.log(`[sync] محمود لديه بالفعل دور prices_viewer`)
  }

  // 3) تأكد من تحديث admin للحصول على '*' (يحتوي ضمنيًا على prices.view)
  const adminRole = await db.role.findUnique({ where: { name: 'admin' } })
  if (adminRole) {
    const perms = JSON.parse(adminRole.permissions ?? '[]')
    if (!perms.includes('*')) {
      await db.role.update({
        where: { id: adminRole.id },
        data: { permissions: JSON.stringify(['*']) },
      })
      console.log(`[sync] حُدّث دور admin ليشمل '*'`)
    } else {
      console.log(`[sync] دور admin لديه بالفعل '*'`)
    }
  }

  // 4) أظهر ملخص الأدوار لكل مستخدم للتأكد
  const users = await db.user.findMany({ include: { roles: { include: { role: true } } } })
  console.log('\n[ملخص الأدوار]:')
  for (const u of users) {
    const roles = u.roles.map((ur) => ur.role.name).join(', ') || '(لا يوجد)'
    console.log(`  ${u.username} (${u.name}): ${roles}`)
  }

  console.log('\n[sync] تمت المزامنة بنجاح ✓')
}

main()
  .catch((e) => {
    console.error('[sync] خطأ:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
