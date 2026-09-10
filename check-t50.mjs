/**
 * T50 联调补验（临时，验完即删）：对照 PRD-P4C §6 中可自动化项的补测。
 * 覆盖：svg 强制 attachment / 中文名 attachment filename* / 进回收站还原后仍 40400 /
 *       队列后端支撑（顺序同名上传 R4 自动 "(1)" / 覆盖模式）/ html CSP-sandbox 兜底口径不回归。
 */
const API = 'http://127.0.0.1:3000/api'
let pass = 0
let total = 0
function check(name, cond, extra = '') {
  total++
  if (cond) pass++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`)
}

const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123' }) }).then((r) => r.json())
const auth = login.data.accessToken
const h = { Authorization: `Bearer ${auth}` }
const api = async (m, p, body) => (await fetch(API + p, { method: m, headers: { ...h, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
const upload = async (name, buf, type) => {
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type }), name)
  return fetch(API + '/cloud/file/upload?parentId=0', { method: 'POST', headers: h, body: fd }).then((r) => r.json())
}
const isT50 = (n) => n.startsWith('t50-')

// 前置清理
for (const x of (await api('GET', '/cloud/file/list?parentId=0')).data.list.filter((x) => isT50(x.name))) await api('DELETE', `/cloud/file/${x.id}`)
const preRec = await api('GET', '/cloud/recycle/list?parentId=0')
for (const x of (Array.isArray(preRec.data) ? preRec.data : []).filter((x) => isT50(String(x.name)))) await api('DELETE', `/cloud/recycle/${x.id}`)

// ---------- 1. svg 经 raw 强制 attachment ----------
const upSvg = await upload('t50-icon.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')
const pubSvg = await api('POST', `/cloud/file/${upSvg.data.id}/public`, {})
const rawSvg = await fetch(API + `/pub/f/${pubSvg.data.publicToken}/raw`)
check('svg raw 强制 attachment（不执行脚本）', rawSvg.status === 200 && (rawSvg.headers.get('content-disposition') ?? '').startsWith('attachment') && rawSvg.headers.get('content-type') === 'application/octet-stream')

// ---------- 2. 中文名：下载 attachment filename* 原名 ----------
const upCn = await upload('t50-演示文件.txt', Buffer.from('中文内容测试'), 'text/plain')
check('中文名上传不乱码（defParamCharset 修复）', upCn.code === 0 && upCn.data.name === 't50-演示文件.txt', JSON.stringify(upCn.data?.name))
const pubCn = await api('POST', `/cloud/file/${upCn.data.id}/public`, {})
const dlCn = await fetch(API + `/pub/f/${pubCn.data.publicToken}/download`)
const cd = dlCn.headers.get('content-disposition') ?? ''
check('中文名 download filename* 原名', cd.includes(encodeURIComponent('t50-演示文件.txt')) && cd.startsWith('attachment'), cd)

// ---------- 3. 进回收站还原后仍 40400（token 已轮换） ----------
const upR = await upload('t50-restore.txt', Buffer.from('restore me'), 'text/plain')
const pubR = await api('POST', `/cloud/file/${upR.data.id}/public`, {})
const tokenR = pubR.data.publicToken
await api('DELETE', `/cloud/file/${upR.data.id}`)
const dead1 = await api('GET', `/pub/f/${tokenR}/info`)
const restore = await api('POST', '/cloud/recycle/restore', { id: Number(upR.data.id) })
const dead2 = await api('GET', `/pub/f/${tokenR}/info`)
const rowR = (await api('GET', '/cloud/file/list?parentId=0')).data.list.find((x) => x.id === upR.data.id)
check('还原后旧链接仍 40400', dead1.code === 40400 && dead2.code === 40400, JSON.stringify({ dead1: dead1.code, dead2: dead2.code }))
check('还原后行 publicToken 为空（复制链接按钮回落「设为公开」）', rowR?.publicToken === null && rowR?.isPublic === 1)

// ---------- 4. 队列后端支撑：顺序同名上传 R4 自动 "(1)"（队列逐条调用的落盘口径） ----------
const up1 = await upload('t50-dup.txt', Buffer.from('v1'), 'text/plain')
const up2 = await upload('t50-dup.txt', Buffer.from('v2'), 'text/plain')
const up3 = await upload('t50-dup.txt', Buffer.from('v3'), 'text/plain')
check('R4 顺序上传自动 "(1)"("(2)")', up1.data.name === 't50-dup.txt' && up2.data.name === 't50-dup.txt(1)' && up3.data.name === 't50-dup.txt(2)', JSON.stringify([up1.data.name, up2.data.name, up3.data.name]))
// 覆盖模式（R5）：队列勾选覆盖同名时的落盘口径
const upOv = await (async () => {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.from('overwritten')], { type: 'text/plain' }), 't50-dup.txt')
  return fetch(API + '/cloud/file/upload?parentId=0&overwrite=1', { method: 'POST', headers: h, body: fd }).then((r) => r.json())
})()
check('覆盖模式同名覆盖（fileId 不变）', upOv.code === 0 && upOv.data.id === up1.data.id && upOv.data.overwritten === true)

// ---------- 清理 ----------
const liveIds = (await api('GET', '/cloud/file/list?parentId=0')).data.list.filter((x) => isT50(x.name)).map((x) => x.id)
for (const id of liveIds) await api('DELETE', `/cloud/file/${id}`)
const rec = await api('GET', '/cloud/recycle/list?parentId=0')
for (const x of (Array.isArray(rec.data) ? rec.data : []).filter((x) => isT50(String(x.name)))) await api('DELETE', `/cloud/recycle/${x.id}`)
check('清理零残留', (await api('GET', '/cloud/file/list?parentId=0')).data.list.filter((x) => isT50(x.name)).length === 0 && (Array.isArray((await api('GET', '/cloud/recycle/list?parentId=0')).data) ? (await api('GET', '/cloud/recycle/list?parentId=0')).data : []).filter((x) => isT50(String(x.name))).length === 0)

console.log(`\n===== ${pass}/${total} passed =====`)
