import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import XLSX from 'xlsx';
import admin from 'firebase-admin';

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const excelPath = path.resolve(arg('file', './Sample Value Database.xlsx'));
const serviceAccountPath = path.resolve(arg('service-account', './service-account.json'));
const multimediaFileArg = arg('multimedia-file', './Petugas Multimedia GPIB Paulus Jakarta.xlsx');
const multimediaPath = multimediaFileArg ? path.resolve(multimediaFileArg) : '';
const RESET = process.argv.includes('--reset');
const RESET_AUTH = process.argv.includes('--reset-auth') || RESET;
if (!fs.existsSync(excelPath)) throw new Error(`Excel tidak ditemukan: ${excelPath}`);
if (!fs.existsSync(serviceAccountPath)) throw new Error(`Service account tidak ditemukan: ${serviceAccountPath}`);

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();
const workbook = XLSX.readFile(excelPath, { cellDates: true });

const aliases = {
  nama_user:'name', phone_no:'phoneNo', membership_status:'membershipStatus', warga_jemaat:'wargaJemaat', active:'status',
  unit_name:'unitName', parent_unit_id:'parentUnitId', role_code:'roleCode', role_name:'roleName', role_scope:'roleScope', is_schedulable:'isSchedulable',
  user_unit_id:'userUnitId', user_id:'userId', unit_id:'unitId', joined_at:'joinedAt', left_at:'leftAt',
  user_role_id:'userRoleId', role_id:'roleId', priority_weight:'priorityWeight', assigned_at:'assignedAt', ended_at:'endedAt', score:'score',
  group_type:'groupType', group_name:'groupName', group_id:'groupId', member_role:'memberRole', valid_from:'validFrom', valid_to:'validTo',
  position_code:'positionCode', position_name:'positionName', assignment_target_type:'assignmentTargetType',
  position_id:'positionId', service_time:'serviceTime', location_code:'locationCode', service_type:'serviceType', eligibility_status:'eligibilityStatus', assignment_rule:'assignmentRule', other_commitments:'otherCommitments',
  scope_type:'scopeType', scope_id:'scopeId', period_type:'periodType', max_assignments:'maxAssignments', min_gap_days:'minGapDays',
  left_user_id:'leftUserId', right_user_id:'rightUserId', rule_type:'ruleType',
  support_position_id:'supportPositionId', support_user_id:'supportUserId',
  template_code:'templateCode', service_name:'serviceName', template_id:'templateId', slot_no:'slotNo', required_count:'requiredCount', assignee_type:'assigneeType',
  app_role:'appRole', app_role_id:'appRoleId', scope_unit_id:'scopeUnitId', user_app_role_id:'userAppRoleId',
  tim_id:'groupId', tim_name:'groupName',
  create_time:'createdAtLegacy', update_time:'updatedAtLegacy',
};
const camel = key => aliases[key] || key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const clean = value => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  return value;
};

// PNT / DKN hanya label jabatan, bukan bagian dari nama orang.
function cleanDisplayName(value) {
  return String(value || '')
    .replace(/^\s*(PNT|PENATUA|DKN|DIAKEN)\s*[.\-:]*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function canonicalName(value) {
  return cleanDisplayName(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function readSheet(...names) {
  const name = names.find(n => workbook.Sheets[n]);
  if (!name) return [];
  const sheet = workbook.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headerIndex = matrix.findIndex(row => row.some(cell => typeof cell === 'string' && /(^|_)(id|status)$|^nama_user$|^user_id$|^tim_id$/i.test(cell.trim())));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map(v => String(v || '').trim());
  return matrix.slice(headerIndex + 1)
    .filter(row => row.some(v => v !== null && v !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = clean(row[i]); });
      return obj;
    });
}

const rawUsers = readSheet('users', 'Sheet1', 'user');
const rawUnits = readSheet('units');
const rawRoles = readSheet('roles');
const rawUserUnits = readSheet('user_units');
const rawUserRoles = readSheet('user_roles');
const rawGroups = readSheet('groups', 'tim_musik');
const rawGroupMembers = readSheet('group_members', 'tim_members');
const rawAppRoles = readSheet('user_app_roles');

// Gabungkan duplicate user berdasarkan NAMA, setelah prefix PNT/DKN diabaikan.
const userByCanonical = new Map();
const userIdRemap = new Map();
for (const row of rawUsers) {
  const oldId = String(row.user_id || '').trim();
  const cleanedName = cleanDisplayName(row.nama_user);
  if (!oldId || !cleanedName) continue;
  const key = canonicalName(cleanedName);
  if (!userByCanonical.has(key)) {
    userByCanonical.set(key, { ...row, user_id: oldId, nama_user: cleanedName });
  }
  userIdRemap.set(oldId, userByCanonical.get(key).user_id);
}
const users = [...userByCanonical.values()];
console.log(`✓ Master user Sheet1: ${rawUsers.length} baris → ${users.length} user unik berdasarkan nama`);

const remapRelations = (rows, idKey = 'user_id') => rows
  .map(row => ({ ...row, [idKey]: userIdRemap.get(String(row[idKey] || '').trim()) || row[idKey] }))
  .filter(row => row[idKey]);

function dedupeRows(rows, keyFn) {
  const seen = new Set();
  return rows.filter(row => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const userUnits = dedupeRows(remapRelations(rawUserUnits), r => `${r.user_id}|${r.unit_id}`);
const userRoles = dedupeRows(remapRelations(rawUserRoles), r => `${r.user_id}|${r.role_id}`);
const inferredAdminRoles = [];
const adminUnitByName = new Map([
  ['admin muger', 'UN00005'],
  ['admin pa', 'UN00006'],
  ['admin pt', 'UN00007'],
  ['admin sound', 'UN00008'],
  ['admin multimedia', 'UN00004'],
  ['admin gp', 'UN00009'],
]);
for (const row of users) {
  const userId = String(row.user_id || '').trim();
  const nameKey = cleanDisplayName(row.nama_user).toLowerCase();
  if (nameKey === 'admin phmj') {
    inferredAdminRoles.push({
      user_app_role_id: `UAR_${userId}_SUPERADMIN`, user_id: userId,
      app_role: 'SUPERADMIN', app_role_id: 'AR001', scope_unit_id: null, status: 'active',
    });
  } else if (adminUnitByName.has(nameKey)) {
    inferredAdminRoles.push({
      user_app_role_id: `UAR_${userId}_ADMIN_UNIT`, user_id: userId,
      app_role: 'ADMIN_UNIT', app_role_id: 'AR002', scope_unit_id: adminUnitByName.get(nameKey), status: 'active',
    });
  }
}
const appRoles = dedupeRows([
  ...remapRelations(rawAppRoles),
  ...inferredAdminRoles,
], r => `${r.user_id}|${r.app_role || r.app_role_id || ''}`);

// Infer anggota tim musik langsung dari kolom Muger pada sheet sumber.
function readSourcePeople() {
  const sheetName = ['Sheet16', 'Sheet2'].find(n => workbook.Sheets[n]);
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, range: sheetName === 'Sheet16' ? 2 : 0 });
}
const sourcePeople = readSourcePeople();

// Ambil ketentuan jam Multimedia dari file khusus, berdasarkan nama orang.
// File bersifat opsional agar seed tetap bisa berjalan tanpa file tersebut.
const multimediaAssignmentByName = new Map();
if (multimediaPath && fs.existsSync(multimediaPath)) {
  const mmWorkbook = XLSX.readFile(multimediaPath, { cellDates: true });
  const mmSheet = mmWorkbook.Sheets['Anggota'] || mmWorkbook.Sheets[mmWorkbook.SheetNames[0]];
  const mmRows = XLSX.utils.sheet_to_json(mmSheet, { header: 1, defval: null });
  const headerRowIndex = mmRows.findIndex(row => row.some(cell => String(cell || '').trim().toLowerCase() === 'penugasan'));
  if (headerRowIndex >= 0) {
    const headers = mmRows[headerRowIndex].map(v => String(v || '').trim().toLowerCase());
    const nameIndex = headers.indexOf('nama');
    const assignmentIndex = headers.indexOf('penugasan');
    for (const row of mmRows.slice(headerRowIndex + 1)) {
      const name = cleanDisplayName(row[nameIndex]);
      const assignment = String(row[assignmentIndex] || '').replace(/\s+/g, ' ').trim();
      if (name && assignment) multimediaAssignmentByName.set(canonicalName(name), assignment);
    }
  }
  console.log(`✓ Ketentuan Multimedia dibaca: ${multimediaAssignmentByName.size}`);
} else {
  console.log('! File ketentuan Multimedia tidak ditemukan; semua jam dianggap tersedia.');
}

// Fallback bila kolom Penugasan sudah tersedia di sheet sumber utama.
for (const row of sourcePeople) {
  const rawName = row[' Nama '] ?? row['Nama '] ?? row['Nama'] ?? row.nama;
  const assignment = String(row[' Penugasan '] ?? row['Penugasan '] ?? row['Penugasan'] ?? '').replace(/\s+/g, ' ').trim();
  if (rawName && assignment && !multimediaAssignmentByName.has(canonicalName(rawName))) {
    multimediaAssignmentByName.set(canonicalName(rawName), assignment);
  }
}

const groupNameToId = new Map(rawGroups.map(g => [String(g.tim_name || g.group_name || '').trim().toLowerCase(), String(g.tim_id || g.group_id || '').trim()]));
const inferredGroupMembers = [];
let gmCounter = 1;
for (const row of sourcePeople) {
  const rawName = row[' Nama '] ?? row['Nama '] ?? row['Nama'] ?? row.nama;
  const person = userByCanonical.get(canonicalName(rawName));
  if (!person) continue;
  const muger = String(row[' Muger '] ?? row['Muger '] ?? row['Muger'] ?? '').trim();
  if (!muger || muger === '-') continue;
  for (const token of muger.split(',').map(x => x.trim()).filter(Boolean)) {
    if (!/^Tim Musik\b/i.test(token)) continue;
    const groupId = groupNameToId.get(token.toLowerCase());
    if (!groupId) continue;
    inferredGroupMembers.push({
      group_member_id: `GM${String(gmCounter++).padStart(5, '0')}`,
      group_id: groupId,
      user_id: person.user_id,
      member_role: 'Anggota',
      status: 'active',
    });
  }
}
const groupMembers = dedupeRows([
  ...remapRelations(rawGroupMembers),
  ...inferredGroupMembers,
], r => `${r.group_id}|${r.user_id}`);

async function clearCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  let deleted = 0;
  for (let start = 0; start < snapshot.docs.length; start += 400) {
    const batch = db.batch();
    for (const item of snapshot.docs.slice(start, start + 400)) {
      batch.delete(item.ref);
      deleted++;
    }
    await batch.commit();
  }
  if (deleted) console.log(`↺ ${collectionName}: hapus ${deleted} data lama`);
}

async function commitChunk(collectionName, rows, idKey, { replace = false } = {}) {
  if (replace) await clearCollection(collectionName);
  let count = 0;
  for (let start = 0; start < rows.length; start += 400) {
    const batch = db.batch();
    for (const raw of rows.slice(start, start + 400)) {
      const id = String(raw[idKey] || '').trim();
      if (!id) continue;
      const data = {};
      for (const [key, value] of Object.entries(raw)) {
        if (key === idKey || value === null) continue;
        data[camel(key)] = value;
      }
      if (data.name) data.name = cleanDisplayName(data.name);
      data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      batch.set(db.collection(collectionName).doc(id), data, { merge: true });
      count++;
    }
    await batch.commit();
  }
  console.log(`✓ ${collectionName}: ${count}`);
}


const ALL_COLLECTIONS = [
  'users','profiles','loginDirectory','units','roles','userUnits','userRoles','groups','groupMembers','userAppRoles',
  'positions','eligibilities','schedulingPolicies','pairingRules','groupSupportRules','serviceTemplates','templateSlots',
  'scheduleAssignments','swapRequests','services','publishedSchedules','serviceEvents','serviceSlots','assignments','swapAssignments','penugasanData'
];

async function deleteAllAuthUsers() {
  let pageToken;
  let deleted = 0;
  do {
    const result = await auth.listUsers(1000, pageToken);
    const uids = result.users.map(x => x.uid);
    if (uids.length) {
      const outcome = await auth.deleteUsers(uids);
      deleted += outcome.successCount;
      if (outcome.failureCount) console.warn(`! Gagal hapus ${outcome.failureCount} akun Auth`);
    }
    pageToken = result.pageToken;
  } while (pageToken);
  console.log(`↺ Authentication: hapus ${deleted} akun lama`);
}

if (RESET) {
  console.log('=== RESET DATABASE DEVELOPMENT ===');
  for (const name of ALL_COLLECTIONS) await clearCollection(name);
}
if (RESET_AUTH) await deleteAllAuthUsers();

// MASTER SYNC: collection berikut harus persis mengikuti workbook.
// Data lama yang tidak ada di Excel dihapus agar tidak muncul sebagai user ganda di interface.
await commitChunk('users', users, 'user_id', { replace: true });
await commitChunk('units', rawUnits, 'unit_id', { replace: true });
await commitChunk('roles', rawRoles, 'role_id', { replace: true });
await commitChunk('userUnits', userUnits, 'user_unit_id', { replace: true });
await commitChunk('userRoles', userRoles, 'user_role_id', { replace: true });
await commitChunk('groups', rawGroups, rawGroups.some(x => x.group_id) ? 'group_id' : 'tim_id', { replace: true });
await commitChunk('groupMembers', groupMembers, 'group_member_id', { replace: true });
await commitChunk('userAppRoles', appRoles, 'user_app_role_id', { replace: true });

// Tabel opsional dari workbook versi full.
const optionalConfigs = [
  ['positions', 'positions', 'position_id'],
  ['user_role_eligibility', 'eligibilities', 'eligibility_id'],
  ['scheduling_policies', 'schedulingPolicies', 'policy_id'],
  ['pairing_rules', 'pairingRules', 'pairing_rule_id'],
  ['group_support_rules', 'groupSupportRules', 'support_rule_id'],
  ['service_templates', 'serviceTemplates', 'template_id'],
  ['template_slots', 'templateSlots', 'template_slot_id'],
];
for (const [sheet, collectionName, idKey] of optionalConfigs) {
  await commitChunk(collectionName, readSheet(sheet), idKey, { replace: true });
}

const unitNameById = new Map(rawUnits.map(x => [String(x.unit_id), String(x.unit_name || '').trim()]));
const roleNameById = new Map(rawRoles.map(x => [String(x.role_id), String(x.role_name || '').trim()]));
const groupNameById = new Map(rawGroups.map(x => [String(x.tim_id || x.group_id), String(x.tim_name || x.group_name || '').trim()]));
const teamMembersByGroup = new Map();
for (const gm of groupMembers) {
  const gid = String(gm.group_id);
  if (!teamMembersByGroup.has(gid)) teamMembersByGroup.set(gid, []);
  teamMembersByGroup.get(gid).push(String(gm.user_id));
}

const appRoleNames = {
  AR001: 'Superadmin', SUPERADMIN: 'Superadmin',
  AR002: 'Admin Unit', ADMIN_UNIT: 'Admin Unit',
};
const roleMapToApp = name => {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'camera') return 'Kameraman';
  if (n === 'operator slide') return 'Operator Slide';
  if (n === 'pemandu lagu') return 'Pemandu Lagu (Muger)';
  if (n === 'organis' || n === 'orgel') return 'Organis / Pianis';
  return String(name || '').trim();
};

// Personnel legacy disusun dari tabel normalisasi, bukan dari record per-unit.
const personnel = users.map(u => {
  const userId = String(u.user_id);
  const units = userUnits.filter(x => String(x.user_id) === userId).map(x => unitNameById.get(String(x.unit_id))).filter(Boolean);
  const roles = userRoles.filter(x => String(x.user_id) === userId).map(x => roleMapToApp(roleNameById.get(String(x.role_id)))).filter(Boolean);
  const adminRoles = appRoles.filter(x => String(x.user_id) === userId).map(x => appRoleNames[String(x.app_role || x.app_role_id || '').toUpperCase()]).filter(Boolean);
  const musicTeams = groupMembers.filter(x => String(x.user_id) === userId).map(x => ({ id: String(x.group_id), name: groupNameById.get(String(x.group_id)) })).filter(x => x.name);
  return {
    id: userId,
    name: cleanDisplayName(u.nama_user),
    units: [...new Set(units)],
    roles: [...new Set([...roles, ...adminRoles])],
    pelkatClasses: [],
    musicTeams,
    multimediaAssignment: multimediaAssignmentByName.get(canonicalName(u.nama_user)) || null,
    wargaJemaat: u.warga_jemaat ?? null,
    status: u.active || u.status || 'active',
    password: '1234',
    assignments: 0,
  };
});

// Tim Musik dibuat sebagai assignee sendiri, dengan daftar anggota lengkap.
for (const g of rawGroups) {
  const gid = String(g.tim_id || g.group_id || '').trim();
  const gname = String(g.tim_name || g.group_name || '').trim();
  if (!gid || !gname) continue;
  const memberIds = [...new Set(teamMembersByGroup.get(gid) || [])];
  const memberNames = memberIds.map(id => personnel.find(p => p.id === id)?.name).filter(Boolean);
  personnel.push({
    id: `TEAM_${gid}`,
    groupId: gid,
    name: gname,
    units: ['Muger'],
    roles: ['Tim Musik'],
    isTeam: true,
    memberIds,
    memberNames,
    pelkatClasses: [],
    status: g.status || 'active',
    assignments: 0,
  });
}
await db.collection('penugasanData').doc('main').set({
  personnel,
  assignments: {},
  swapRequests: [],
  customServices: {},
  publishedSchedules: [],
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: !RESET });
console.log(`✓ penugasanData/main personnel: ${personnel.length}`);

// loginDirectory juga harus persis mengikuti master user.
await clearCollection('loginDirectory');

const DEFAULT_PIN = arg('default-pin', process.env.DEFAULT_PIN || '1234');
const pinToFirebasePassword = pin => `GPIB-PAULUS::${pin}`;
const loginEmailFor = userId => `${String(userId).toLowerCase().replace(/[^a-z0-9._-]/g, '-')}@login.gpib.local`;
let accountCount = 0;
for (const row of users) {
  const personId = String(row.user_id || '').trim();
  const displayName = cleanDisplayName(row.nama_user);
  if (!personId || !displayName) continue;
  const loginEmail = loginEmailFor(personId);
  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(loginEmail);
    if (firebaseUser.displayName !== displayName) await auth.updateUser(firebaseUser.uid, { displayName });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    firebaseUser = await auth.createUser({
      email: loginEmail,
      password: pinToFirebasePassword(DEFAULT_PIN),
      displayName,
      emailVerified: true,
      disabled: String(row.status || row.active || '').toLowerCase() === 'inactive',
    });
  }
  const roleCodes = appRoles.filter(x => String(x.user_id) === personId).map(x => String(x.app_role || x.app_role_id || '').toUpperCase());
  const appRole = roleCodes.some(x => x === 'SUPERADMIN' || x === 'AR001') ? 'SUPERADMIN'
    : roleCodes.some(x => x === 'ADMIN_UNIT' || x === 'AR002') ? 'ADMIN_UNIT' : 'USER';
  const unitIds = userUnits.filter(x => String(x.user_id) === personId).map(x => String(x.unit_id));
  const profileRef = db.collection('profiles').doc(firebaseUser.uid);
  const existingProfile = await profileRef.get();
  await profileRef.set({
    personId, displayName, loginEmail, appRole, unitIds,
    status: row.status || row.active || 'active',
    ...(existingProfile.exists ? {} : { mustChangePassword: true }),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection('loginDirectory').doc(personId).set({
    name: displayName, loginEmail, status: row.status || row.active || 'active',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  accountCount++;
}
// Hapus profile lama yang user master-nya sudah tidak ada. Akun Auth tidak dihapus,
// tetapi tidak lagi muncul di dropdown karena loginDirectory sudah disinkronkan ulang.
const masterPersonIds = new Set(users.map(row => String(row.user_id || '').trim()));
const profileSnapshot = await db.collection('profiles').get();
let removedProfiles = 0;
for (let start = 0; start < profileSnapshot.docs.length; start += 400) {
  const batch = db.batch();
  for (const item of profileSnapshot.docs.slice(start, start + 400)) {
    const personId = String(item.data()?.personId || '').trim();
    if (personId && !masterPersonIds.has(personId)) {
      batch.delete(item.ref);
      removedProfiles++;
    }
  }
  await batch.commit();
}
if (removedProfiles) console.log(`↺ profiles: hapus ${removedProfiles} profile lama`);


// Buat collection runtime agar struktur lengkap langsung terlihat setelah seed.
// Dokumen _meta akan otomatis dihapus/ditimpa ketika aplikasi mulai menyimpan data riil.
const runtimeCollections = {
  scheduleAssignments: { type: 'metadata', description: 'Penugasan jadwal per slot' },
  swapRequests: { type: 'metadata', description: 'Permintaan tukar jadwal' },
  services: { type: 'metadata', description: 'Ibadah khusus / service events' },
  publishedSchedules: { type: 'metadata', description: 'Jadwal yang sudah dipublikasikan' },
  serviceEvents: { type: 'metadata', description: 'Event ibadah terstruktur' },
  serviceSlots: { type: 'metadata', description: 'Slot posisi per ibadah' },
  assignments: { type: 'metadata', description: 'Assignment Firestore-native' },
  swapAssignments: { type: 'metadata', description: 'Swap assignment Firestore-native' },
};
for (const [collectionName, payload] of Object.entries(runtimeCollections)) {
  await db.collection(collectionName).doc('_meta').set({
    ...payload, status: 'ready', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}
console.log(`✓ Runtime collections: ${Object.keys(runtimeCollections).length}`);

console.log(`✓ Akun login aktif di directory: ${accountCount} (PIN awal ${DEFAULT_PIN})`);
console.log('Seed selesai. Sheet1 menjadi master user; detail unit/role/tim/Multimedia hanya memperkaya user master.');
