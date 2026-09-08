import {randomUUID} from 'node:crypto';
import {getUser, sameOrigin, authLimit} from '@/lib/auth';
import {isAdmin} from '@/lib/roles';
import {db} from '@/db/index';
import {hashPassword, validPassword} from '@/lib/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'private, no-store'}});

export async function GET() {
  const actor = await getUser();
  if (!actor) return json({error: 'Најавете се за пристап.'}, 401);
  if (!isAdmin(actor)) return json({error: 'Само администратор може да управува со корисници.'}, 403);
  const result = await db().prepare('SELECT id,username,display_name,role,active,created_at FROM users WHERE plant_owner=? ORDER BY created_at,id').bind(actor.plantOwner).all<{id:string;username:string;display_name:string;role:string;active:boolean;created_at:string}>();
  return json({users: result.results.map(row => ({id:row.id,username:row.username,displayName:row.display_name,role:row.role,active:row.active,createdAt:row.created_at,isPrimary:row.id === actor.plantOwner}))});
}

export async function POST(request: Request) {
  const actor = await getUser();
  if (!actor) return json({error: 'Најавете се за пристап.'}, 401);
  if (!isAdmin(actor)) return json({error: 'Само администратор може да управува со корисници.'}, 403);
  if (!sameOrigin(request)) return json({error: 'Невалидно потекло на барањето.'}, 403);
  if (Number(request.headers.get('content-length')) > 4096) return json({error: 'Внесот е преголем.'}, 413);
  if (!await authLimit('users:'+actor.userId,60)) return json({error:'Премногу промени. Обидете се по 15 минути.'},429);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({error: 'Внесот е преголем.'}, 413);
    const body = JSON.parse(raw);
    if (!body || !['create','update'].includes(body.action)) return json({error:'Невалидна операција.'},400);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!/^[a-z0-9][a-z0-9._@+\-]{2,99}$/.test(username)) return json({error:'Корисничкото име треба да има 3–100 латинични букви, бројки или знаци . _ @ + -'},400);
    if (!name || name.length > 100) return json({error:'Внесете име до 100 знаци.'},400);
    if (!['admin','viewer'].includes(body.role) || typeof body.active !== 'boolean') return json({error:'Изберете валидна улога и статус.'},400);
    const changingPassword = body.action === 'create' || (body.password !== undefined && body.password !== '');
    if (changingPassword && !validPassword(body.password)) return json({error:'Лозинката треба да има 12–128 знаци.'},400);
    const connection = db();
    if (body.action === 'create') {
      const id = randomUUID();
      await connection.prepare('INSERT INTO users(id,username,display_name,password_hash,plant_owner,role,active) VALUES (?,?,?,?,?,?,?)').bind(id,username,name,await hashPassword(body.password),actor.plantOwner,body.role,body.active).run();
      return json({id},201);
    }
    if (typeof body.id !== 'string') return json({error:'Изберете корисник.'},400);
    const target = await connection.prepare('SELECT id FROM users WHERE id=? AND plant_owner=?').bind(body.id,actor.plantOwner).first<{id:string}>();
    if (!target) return json({error:'Корисникот не е пронајден.'},404);
    // The original owner always remains an active administrator. Self-service password changes use /account.
    if (target.id === actor.plantOwner || target.id === actor.userId) return json({error:'Оваа администраторска сметка е заштитена. Својата лозинка сменете ја во „Мој профил“.'},403);
    const passwordHash = changingPassword ? await hashPassword(body.password) : null;
    await connection.batch([
      connection.prepare('UPDATE users SET username=?,display_name=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=? AND plant_owner=?').bind(username,name,body.role,body.active,passwordHash,target.id,actor.plantOwner),
      connection.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE id=? AND plant_owner=?)').bind(target.id,actor.plantOwner),
    ]);
    return json({ok:true});
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return json({error:'Ова корисничко име веќе се користи.'},409);
    return json({error:'Корисникот не е зачуван. Проверете го внесот и обидете се повторно.'},400);
  }
}
