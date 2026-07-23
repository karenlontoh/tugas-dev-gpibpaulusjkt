import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const stripUndefinedDeep = (value) => {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value.constructor && value.constructor !== Object && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefinedDeep(child)])
  );
};

const clean = (value) => stripUndefinedDeep(value);

async function commitBatchOperations(db, operations = [], chunkSize = 450) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const batch = writeBatch(db);
    const chunk = operations.slice(start, start + chunkSize);
    for (const operation of chunk) {
      if (operation.type === 'delete') batch.delete(operation.ref);
      if (operation.type === 'set') batch.set(operation.ref, operation.data, operation.options || {});
    }
    await batch.commit();
  }
}
const slug = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'item';

const idPart = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'ITEM';

const categoryCode = (value = '') => {
  const normalized = slug(value);
  const codes = {
    services: 'SVC',
    customservices: 'CST',
    specialservices: 'SPC',
  };
  return codes[normalized] || idPart(value).slice(0, 4);
};

const slotCode = (value = '') => idPart(value)
  .replace(/^MM_/, 'MM_')
  .replace(/^PS_/, 'PS_');

const assignmentDocumentId = (date, category, categoryId, slotKey) => {
  const compactDate = String(date || '').replace(/[^0-9]/g, '');
  const numericCategoryId = /^\d+$/.test(String(categoryId || ''))
    ? String(categoryId).padStart(2, '0')
    : idPart(categoryId);
  return `ASG_${compactDate}_${categoryCode(category)}${numericCategoryId}_${slotCode(slotKey)}`;
};

const publishedDocumentId = (key = '') => {
  const match = String(key).match(/^(\d{4})-(\d{2})-(.+)$/);
  if (!match) return `PUB_${idPart(key)}`;
  return `PUB_${match[1]}${match[2]}_${idPart(match[3])}`;
};

async function getNextSequentialIds(db, collectionName, prefix, count, width = 4) {
  if (!count) return [];
  const snap = await getDocs(collection(db, collectionName));
  let maxNumber = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  for (const row of snap.docs) {
    const match = String(row.id).match(pattern);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
  }
  return Array.from({ length: count }, (_, index) =>
    `${prefix}${String(maxNumber + index + 1).padStart(width, '0')}`
  );
}

async function getMatching(db, collectionName, field, value) {
  const snap = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snap.docs;
}

export async function syncPerson(db, person) {
  const userId = String(person.id);
  const now = serverTimestamp();
  const base = {
    userId,
    name: person.name || '',
    normalizedName: slug(person.name || ''),
    email: person.email || '',
    phone: person.phone || '',
    status: person.status || 'active',
    updatedAt: now,
  };

  if (person.wargaJemaat !== undefined && person.wargaJemaat !== null) base.wargaJemaat = person.wargaJemaat;
  if (person.multimediaAssignment) base.multimediaAssignment = person.multimediaAssignment;
  if ((person.pelkatClasses || []).length) base.pelkatClasses = person.pelkatClasses;

  await setDoc(doc(db, 'users', userId), clean(base), { merge: true });

  const directoryPayload = {
    name: person.name || '',
    status: person.status || 'active',
    updatedAt: now,
  };
  if (person.loginEmail) directoryPayload.loginEmail = person.loginEmail;
  if (person.email) directoryPayload.contactEmail = person.email;
  if (person.phone) directoryPayload.phone = person.phone;
  await setDoc(doc(db, 'loginDirectory', userId), clean(directoryPayload), { merge: true });

  // Keep the Firebase profile document aligned with edits from the Petugas screen.
  const profileRows = await getMatching(db, 'profiles', 'personId', userId);
  for (const profile of profileRows) {
    await setDoc(profile.ref, clean({
      displayName: person.name || '',
      contactEmail: person.email || '',
      phone: person.phone || '',
      status: person.status || 'active',
      wargaJemaat: person.wargaJemaat ?? null,
      unitIds: (person.unitMemberships?.length
        ? person.unitMemberships.filter(x => x.status !== 'inactive').map(x => x.name)
        : (person.units || [])),
      updatedAt: now,
    }), { merge: true });
  }

  // Preserve imported sequential document IDs (UU0001, UR0001) when records already exist.
  // Only allocate new sequential IDs for new unit/role links.
  const existingUnits = await getMatching(db, 'userUnits', 'userId', userId);
  const existingRoles = await getMatching(db, 'userRoles', 'userId', userId);

  const unitMemberships = (person.unitMemberships?.length
    ? person.unitMemberships
    : (person.units || []).map(name => ({ name, status: person.unitStatuses?.[name] || 'active' }))
  ).filter(x => x?.name);
  const roleMemberships = (person.roleMemberships?.length
    ? person.roleMemberships
    : (person.roles || []).map(name => ({ name, status: person.roleStatuses?.[name] || 'active', unit: '' }))
  ).filter(x => x?.name);
  const desiredUnits = [...new Set(unitMemberships.map(x => x.name))];
  const desiredRoles = [...new Set(roleMemberships.map(x => x.name))];
  const unitStatusByName = new Map(unitMemberships.map(x => [x.name, x.status || 'active']));
  const roleMembershipByName = new Map(roleMemberships.map(x => [x.name, x]));

  const unitByName = new Map(existingUnits.map(row => [String(row.data().unitName || ''), row]));
  const roleKey = (roleName, unitName = '') => `${String(unitName)}::${String(roleName)}`;
  const roleByName = new Map(existingRoles.map(row => [roleKey(row.data().roleName || '', row.data().unitName || ''), row]));

  const missingUnits = desiredUnits.filter(unit => !unitByName.has(unit));
  const desiredRoleRows = roleMemberships.map(role => ({ ...role, key: roleKey(role.name, role.unit || '') }));
  const missingRoleRows = desiredRoleRows.filter(role => !roleByName.has(role.key));
  const newUnitIds = await getNextSequentialIds(db, 'userUnits', 'UU', missingUnits.length);
  const newRoleIds = await getNextSequentialIds(db, 'userRoles', 'UR', missingRoleRows.length);

  const batch = writeBatch(db);

  for (const row of existingUnits) {
    if (!desiredUnits.includes(String(row.data().unitName || ''))) batch.delete(row.ref);
  }
  for (const row of existingRoles) {
    if (!desiredRoleRows.some(role => role.key === roleKey(row.data().roleName || '', row.data().unitName || ''))) batch.delete(row.ref);
  }

  for (const unit of desiredUnits) {
    const existing = unitByName.get(unit);
    const id = existing?.id || newUnitIds[missingUnits.indexOf(unit)];
    batch.set(doc(db, 'userUnits', id), clean({
      userId,
      unitName: unit,
      status: unitStatusByName.get(unit) || 'active',
      updatedAt: now,
    }), { merge: true });
  }

  for (const role of desiredRoleRows) {
    const existing = roleByName.get(role.key);
    const id = existing?.id || newRoleIds[missingRoleRows.findIndex(item => item.key === role.key)];
    batch.set(doc(db, 'userRoles', id), clean({
      userId,
      roleName: role.name,
      unitName: role.unit || '',
      status: role.status || 'active',
      updatedAt: now,
    }), { merge: true });
  }

  // groupMembers dikelola khusus melalui menu Kelola Muger.
  // Jangan sinkronkan atau menghapus membership grup saat data petugas diedit,
  // karena data hasil load petugas tidak selalu membawa musicTeams/collaborations.

  await batch.commit();
}

export async function deletePerson(db, userId) {
  const id = String(userId);
  const unitRows = await getMatching(db, 'userUnits', 'userId', id);
  const roleRows = await getMatching(db, 'userRoles', 'userId', id);
  const groupRows = await getMatching(db, 'groupMembers', 'userId', id);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', id));
  batch.delete(doc(db, 'loginDirectory', id));
  for (const row of [...unitRows, ...roleRows, ...groupRows]) batch.delete(row.ref);
  await batch.commit();
}

export async function syncPersonnelDiff(db, before = [], after = []) {
  const beforeMap = new Map(before.map(x => [String(x.id), x]));
  const afterMap = new Map(after.map(x => [String(x.id), x]));
  const tasks = [];
  for (const [id, row] of afterMap) {
    const old = beforeMap.get(id);
    if (!old || JSON.stringify(old) !== JSON.stringify(row)) tasks.push(syncPerson(db, row));
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) tasks.push(deletePerson(db, id));
  }
  await Promise.all(tasks);
}

function flattenAssignments(assignments = {}) {
  const rows = [];
  for (const [date, categories] of Object.entries(assignments || {})) {
    for (const [category, categoryRows] of Object.entries(categories || {})) {
      for (const [categoryId, slots] of Object.entries(categoryRows || {})) {
        for (const [slotKey, assignment] of Object.entries(slots || {})) {
          if (!assignment || typeof assignment !== 'object') continue;

          // Slot kosong dari tombol Reset tidak perlu disimpan sebagai dokumen Firestore.
          // Dengan begitu reset benar-benar menghapus dokumen lama maupun format ID lama.
          const userId = String(assignment.userId || '').trim();
          const status = String(assignment.status || '').trim();
          if (!userId && !status) continue;

          rows.push({
            id: assignmentDocumentId(date, category, categoryId, slotKey),
            date,
            category,
            categoryId,
            slotKey,
            ...assignment,
          });
        }
      }
    }
  }
  return rows;
}

export async function syncAssignments(db, assignments = {}) {
  const snap = await getDocs(collection(db, 'scheduleAssignments'));
  const next = flattenAssignments(assignments);
  const nextIds = new Set(next.map(x => x.id));
  const operations = [];

  // Hapus SEMUA dokumen yang sudah tidak ada di state, termasuk ID lama
  // seperti ASG_2026_07_05__services__1__mm_cam1.
  for (const row of snap.docs) {
    if (!nextIds.has(row.id)) operations.push({ type: 'delete', ref: row.ref });
  }

  for (const row of next) {
    const { id, ...payload } = row;
    operations.push({
      type: 'set',
      ref: doc(db, 'scheduleAssignments', id),
      data: clean({ ...payload, updatedAt: serverTimestamp() }),
      options: { merge: true },
    });
  }

  // Firestore batch maksimal 500 operasi. Jadwal sebulan dapat melebihi batas,
  // jadi commit dipecah agar proses cleanup tidak gagal diam-diam.
  await commitBatchOperations(db, operations);
}

export async function syncSwapRequests(db, requests = []) {
  const snap = await getDocs(collection(db, 'swapRequests'));
  const ids = new Set(requests.map(x => String(x.id)));
  const batch = writeBatch(db);
  for (const row of snap.docs) if (!ids.has(row.id)) batch.delete(row.ref);
  for (const req of requests) {
    batch.set(doc(db, 'swapRequests', String(req.id)), clean({ ...req, updatedAt: serverTimestamp() }), { merge: true });
  }
  await batch.commit();
}

export async function syncServices(db, services = {}) {
  const snap = await getDocs(collection(db, 'services'));
  const rows = Object.entries(services || {}).map(([id, value]) => ({ id, ...(value || {}) }));
  const ids = new Set(rows.map(x => String(x.id)));
  const batch = writeBatch(db);
  for (const row of snap.docs) if (!ids.has(row.id)) batch.delete(row.ref);
  for (const row of rows) {
    const { id, ...payload } = row;
    batch.set(doc(db, 'services', String(id)), clean({ ...payload, updatedAt: serverTimestamp() }), { merge: true });
  }
  await batch.commit();
}

export async function syncPublishedSchedules(db, items = []) {
  const snap = await getDocs(collection(db, 'publishedSchedules'));
  const rows = items.map((key) => ({
    id: publishedDocumentId(key),
    key: String(key),
  }));
  const ids = new Set(rows.map((row) => row.id));
  const operations = [];

  // Menghapus ID lama seperti 2026-07-presbiter dan menggantinya dengan
  // format konsisten: PUB_202607_PRESBITER.
  for (const row of snap.docs) {
    if (!ids.has(row.id)) operations.push({ type: 'delete', ref: row.ref });
  }

  for (const row of rows) {
    const [period = '', unit = ''] = row.key.split(/-(?=[^-]+$)/);
    operations.push({
      type: 'set',
      ref: doc(db, 'publishedSchedules', row.id),
      data: {
        key: row.key,
        period,
        unit,
        published: true,
        updatedAt: serverTimestamp(),
      },
      options: { merge: true },
    });
  }

  await commitBatchOperations(db, operations);
}
