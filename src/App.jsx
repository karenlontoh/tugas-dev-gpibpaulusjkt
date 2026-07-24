import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { Calendar, Users, BarChart3, Settings, LogOut, User, ShieldCheck, Lock, Unlock,
 Plus, Minus, Save, X, Bell, CheckCircle, XCircle, AlertCircle, Send, PieChart, ChevronRight,
 ChevronDown, Clock, Wand2, Trash2, RefreshCw, Download, FileSpreadsheet, Grid,
 Layers, Monitor, Menu, Search, Edit3, ArrowUpDown, Upload, Eye } from 'lucide-react';
// ==========================================
// 1. KONFIGURASI FIREBASE (Dual Mode Setup)
// ==========================================
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, collection, getDocs, getDoc, deleteDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { syncPersonnelDiff, syncAssignments, syncSwapRequests, syncServices, syncPublishedSchedules } from './firestoreSync';
import MugerManager from './MugerManager';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword } from "firebase/auth";
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const docPath = ['penugasanData', 'main'];
const pinToFirebasePassword = (pin) => `GPIB-PAULUS::${pin}`;

const getNextSequentialId = async (collectionName, prefix, width = 4) => {
  const snap = await getDocs(collection(db, collectionName));
  let maxNumber = 0;
  for (const row of snap.docs) {
    const match = String(row.id).match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
  }
  return `${prefix}${String(maxNumber + 1).padStart(width, '0')}`;
};

const normalizePhone = (value = '') => String(value).replace(/[^0-9+]/g, '');
const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

// Firestore does not accept `undefined`. This sanitizer is used for every write.
const stripUndefinedDeep = (value) => {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  // Preserve Firestore Timestamp, FieldValue, DocumentReference and other SDK objects.
  if (value.constructor && value.constructor !== Object && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefinedDeep(child)])
  );
};

const safeSetDoc = (ref, data, options) =>
  setDoc(ref, stripUndefinedDeep(data), options);
// ==========================================
// 2. DIALOG SYSTEM (To replace alert/confirm)
// ==========================================
const DialogContext = createContext(null);
export const useDialog = () => useContext(DialogContext);
const DialogProvider = ({ children }) => {
  const [dialogs, setDialogs] = useState([]);
  const showDialog = (options) => {
    return new Promise((resolve) => {
      setDialogs((current) => [
        ...current,
        { id: Date.now().toString(), ...options, resolve }
      ]);
    });
  };
  const closeDialog = (id, result) => {
    setDialogs((current) => {
      const dialog = current.find((d) => d.id === id);
      if (dialog) dialog.resolve(result);
      return current.filter((d) => d.id !== id);
    });
  };
  const showAlert = (message) => showDialog({ type: 'alert', message });
  const showConfirm = (message) => showDialog({ type: 'confirm', message });
  const showPrompt = (message) => showDialog({ type: 'prompt', message });
  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}
      {dialogs.map((dialog) => (
        <div key={dialog.id} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 relative">
            <h3 className="font-bold text-gray-800 mb-3 text-lg border-b pb-2">
              {dialog.type === 'alert' ? 'Pemberitahuan' : dialog.type === 'confirm' ? 'Konfirmasi' : 'Input'}
            </h3>
            <p className="text-sm text-gray-600 mb-4 whitespace-pre-wrap">{dialog.message}</p>
            
            {dialog.type === 'prompt' && (
              <input
                type="text"
                autoFocus
                id={`prompt-input-${dialog.id}`}
                className="w-full border border-gray-300 rounded p-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
              />
            )}
            <div className="flex justify-end gap-2">
              {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                <button
                  onClick={() => closeDialog(dialog.id, dialog.type === 'prompt' ? null : false)}
                  className="px-4 py-2 border border-gray-300 rounded font-medium text-gray-700 hover:bg-gray-50 text-sm"
                >
                  Batal
                </button>
              )}
              <button
                onClick={() => {
                  let result = true;
                  if (dialog.type === 'prompt') {
                    result = document.getElementById(`prompt-input-${dialog.id}`)?.value || "";
                  }
                  closeDialog(dialog.id, result);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 text-sm"
              >
                {dialog.type === 'alert' ? 'OK' : 'Ya / Lanjut'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </DialogContext.Provider>
  );
};
// ==========================================
// 3. KONSTANTA & DATA
// ==========================================
const getTodayString = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const getServiceDatesInMonth = (yearMonth, customServices = {}) => {
  if (!yearMonth) return [];
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  const datesSet = new Set();
  while (date.getDay() !== 0) date.setDate(date.getDate() + 1);
  while (date.getMonth() === month - 1) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayStr = String(d.getDate()).padStart(2, '0');
    datesSet.add(`${y}-${m}-${dayStr}`);
    date.setDate(date.getDate() + 7);
  }
  Object.keys(customServices).forEach(d => {
    if (d.startsWith(yearMonth)) datesSet.add(d);
  });
  return Array.from(datesSet).sort();
};
const formatDateIndo = (dateString) => {
  if (!dateString) return "";
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateString).toLocaleDateString('id-ID', options);
};
const formatDateShort = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  return `${date.getDate()}/${date.getMonth()+1}`;
};

const UNITS = {
  PRESBITER: 'Presbiter',
  MULTIMEDIA: 'Multimedia',
  SOUND: 'Sound System',
  MUGER: 'Muger',
  PENDETA: 'Pendeta',
  PA: 'Pelayanan Anak',
  PT: 'Persekutuan Teruna',
  GP: 'Gerakan Pemuda',
  PS: 'Paduan Suara'
};
const ROLES = {
  SUPERADMIN: 'Superadmin',
  ADMIN_UNIT: 'Admin Unit',
  PENATUA: 'Penatua',
  DIAKEN: 'Diaken',
  PENDETA: 'Pendeta',
  MM_PIC: 'PIC Multimedia',
  MM_CAM: 'Camera',
  MM_SLIDE: 'Operator Slide',
  MM_SWITCH: 'Switcher',
  SOUND_OPS: 'Operator Sound',
  KAKAK_LAYAN: 'Kakak Layan',
  PEMBAWA_CERITA: 'Pembawa Cerita',
  PL_PELKAT: 'Pemandu Lagu (Pelkat)',
  PA_BATITA: 'Batita',
  PA_TK: 'TK',
  PA_KECIL: 'Kecil',
  PA_TANGGUNG: 'Tanggung',
  PT_EKA: 'Eka',
  PT_DWI: 'Dwi',
  GP_MEMBER: 'Anggota GP',
  PS_PEMANDU: 'Pelayan Pujian',
  PS_ORGANIS: 'Organis',
  PS_PEMUSIK: 'Pemusik',
  PS_TIM_MUSIK: 'Tim Musik',
  PS_CHOIR: 'Paduan Suara/VG'
};

const UNIT_ROLE_OPTIONS = {
  [UNITS.PRESBITER]: [ROLES.PENATUA, ROLES.DIAKEN],
  [UNITS.MULTIMEDIA]: [ROLES.MM_SLIDE, ROLES.MM_CAM, ROLES.MM_SWITCH, ROLES.MM_PIC],
  [UNITS.SOUND]: [ROLES.SOUND_OPS],
  [UNITS.MUGER]: [ROLES.PS_PEMANDU, ROLES.PS_ORGANIS, ROLES.PS_PEMUSIK, ROLES.PS_TIM_MUSIK, ROLES.PS_CHOIR],
  [UNITS.PENDETA]: [ROLES.PENDETA],
  [UNITS.PA]: [ROLES.PA_BATITA, ROLES.PA_TK, ROLES.PA_KECIL, ROLES.PA_TANGGUNG],
  [UNITS.PT]: [ROLES.PT_EKA, ROLES.PT_DWI],
  [UNITS.GP]: [ROLES.GP_MEMBER],
  [UNITS.PS]: [ROLES.PS_CHOIR],
};

const GLOBAL_ROLE_UNIT_MAP = Object.entries(UNIT_ROLE_OPTIONS).reduce((map, [unit, roles]) => {
  (roles || []).forEach((role) => {
    // A role name can exist in more than one unit (for example PA and PT).
    // Keep the first mapping only as a fallback; explicit role.unit always wins.
    if (!map[role]) map[role] = unit;
  });
  return map;
}, {});

const normalizeMemberships = (person = {}) => {
  const rawUnits = person.unitMemberships?.length
    ? person.unitMemberships
    : (person.units || []).map((name) => ({
        name,
        status: person.unitStatuses?.[name] || 'active',
      }));

  const rawRoles = person.roleMemberships?.length
    ? person.roleMemberships
    : (person.roles || []).map((name) => ({
        name,
        unit: GLOBAL_ROLE_UNIT_MAP[name] || '',
        status: person.roleStatuses?.[name] || 'active',
      }));

  // Firestore/import data can contain duplicate memberships. Deduplicate them so
  // React keys remain stable and the same assignment is not shown twice.
  const unitMap = new Map();
  rawUnits.forEach((item) => {
    const name = String(item?.name || '').trim();
    if (!name) return;
    const current = unitMap.get(name);
    unitMap.set(name, {
      name,
      status:
        current?.status === 'active' || (item?.status || 'active') === 'active'
          ? 'active'
          : 'inactive',
    });
  });

  const roleMap = new Map();
  rawRoles.forEach((item) => {
    const name = String(item?.name || '').trim();
    if (!name) return;
    const unit = String(item?.unit || GLOBAL_ROLE_UNIT_MAP[name] || '').trim();
    const key = `${unit}::${name}`;
    const current = roleMap.get(key);
    roleMap.set(key, {
      name,
      unit,
      status:
        current?.status === 'active' || (item?.status || 'active') === 'active'
          ? 'active'
          : 'inactive',
    });
  });

  return {
    unitMemberships: Array.from(unitMap.values()),
    roleMemberships: Array.from(roleMap.values()),
  };
};

const MULTIMEDIA_ASSIGNMENT_OPTIONS = [
  'Semua Jam',
  'Pukul 06.00',
  'Pukul 08.00',
  'Pukul 10.00',
  'Pukul 17.00',
  'Pukul 17.00 & 19.00',
  'Pukul 19.00',
  'SP I (Tambak)',
  'Menyesuaikan Jadwal PL/Choir',
];

const getMultimediaRuleCode = value => {
  const text = String(value || '').trim().toLowerCase();

  if (
    !text ||
    text === '-' ||
    text.includes('bisa jam berapa aja') ||
    text.includes('semua jam')
  ) return 'ALL_TIMES';

  if (text.includes('tambak') || text.includes('sp i') || text.includes('sp 1')) return 'TAMBAK_ONLY';
  if ((text.includes('17.00') || text.includes('17:00')) && (text.includes('19.00') || text.includes('19:00'))) return 'TIME_1700_1900';
  if (text.includes('06.00') || text.includes('06:00')) return 'TIME_0600';
  if (text.includes('08.00') || text.includes('08:00')) return 'TIME_0800';
  if (text.includes('10.00') || text.includes('10:00')) return 'TIME_1000';
  if (text.includes('17.00') || text.includes('17:00')) return 'TIME_1700';
  if (text.includes('19.00') || text.includes('19:00')) return 'TIME_1900';
  if (
    text.includes('mengikuti jadwal') ||
    text.includes('menyesuaikan jadwal') ||
    text.includes('pl/choir') ||
    text.includes('choir')
  ) return 'FOLLOW_MUGER';

  return 'ALL_TIMES';
};

const MULTIMEDIA_RULE_LABELS = {
  ALL_TIMES: 'Semua Jam',
  TIME_0600: 'Pukul 06.00',
  TIME_0800: 'Pukul 08.00',
  TIME_1000: 'Pukul 10.00',
  TIME_1700: 'Pukul 17.00',
  TIME_1700_1900: 'Pukul 17.00 & 19.00',
  TIME_1900: 'Pukul 19.00',
  TAMBAK_ONLY: 'SP I (Tambak)',
  FOLLOW_MUGER: 'Menyesuaikan Jadwal PL/Choir',
};

const getMultimediaRuleLabel = value =>
  MULTIMEDIA_RULE_LABELS[getMultimediaRuleCode(value)] || 'Semua Jam';

const normalizeMultimediaAssignmentLabel = (value) => {
  const rule = String(value || '').trim().toLowerCase();
  if (!rule || rule === '-' || rule.includes('bisa jam berapa aja') || rule.includes('semua jam')) return 'Semua Jam';
  if (rule.includes('tambak') || rule.includes('sp i') || rule.includes('sp 1')) return 'SP I (Tambak)';
  if (rule.includes('mengikuti jadwal') || rule.includes('menyesuaikan jadwal') || rule.includes('pl/choir') || rule.includes('choir')) return 'Menyesuaikan Jadwal PL/Choir';
  if ((rule.includes('17.00') || rule.includes('17:00')) && (rule.includes('19.00') || rule.includes('19:00'))) return 'Pukul 17.00 & 19.00';
  if (rule.includes('06.00') || rule.includes('06:00')) return 'Pukul 06.00';
  if (rule.includes('08.00') || rule.includes('08:00')) return 'Pukul 08.00';
  if (rule.includes('10.00') || rule.includes('10:00')) return 'Pukul 10.00';
  if (rule.includes('17.00') || rule.includes('17:00')) return 'Pukul 17.00';
  if (rule.includes('19.00') || rule.includes('19:00')) return 'Pukul 19.00';
  return 'Semua Jam';
};

const SUNDAY_SERVICES = [
  { id: 1, time: '06:00', label: 'Ibadah Hari Minggu', pCount: 6, isIKM: false, isLivestream: false },
  { id: 2, time: '08:00', label: 'Ibadah Hari Minggu', pCount: 6, isIKM: false, isLivestream: false },
  { id: 3, time: '10:00', label: 'Ibadah Hari Minggu', pCount: 8, isIKM: false, isLivestream: true },
  { id: 4, time: '17:00', label: 'Ibadah Hari Minggu', pCount: 8, isIKM: false, isLivestream: true },
  { id: 5, time: '17:00 SP 1', label: 'Ibadah Hari Minggu SP I', pCount: 6, isIKM: false, isLivestream: false },
  { id: 6, time: '19:00', label: 'Ibadah Kaum Muda', pCount: 6, isIKM: true, isLivestream: true },
];

const MULTIMEDIA_ALL_KEYS = ['mm_slide','mm_cam1','mm_cam2','mm_cam3','mm_switch','mm_pic'];
const isTambakService = (svc) => {
  const time = String(svc?.time || '').trim().toLowerCase();
  const label = String(svc?.label || '').trim().toLowerCase();
  return time.includes('17:00') && (time.includes('sp 1') || label.includes('sp 1') || label.includes('sp i'));
};
const isSlideOnlyService = (svc) => {
  const time = String(svc?.time || '').trim();
  return time.startsWith('06:00') || time.startsWith('08:00') || isTambakService(svc);
};
const getMultimediaKeysForService = (svc) => {
  if (svc?.isCustom) return svc.isLivestream ? MULTIMEDIA_ALL_KEYS : ['mm_slide'];
  return isSlideOnlyService(svc) ? ['mm_slide'] : MULTIMEDIA_ALL_KEYS;
};
const isDedicatedTambakMultimedia = (person) => {
  const rule = String(person?.multimediaAssignment || person?.penugasanMultimedia || '').trim().toLowerCase();
  return (rule.includes('khusus tambak') || rule.includes('sp i') || rule.includes('sp 1'));
};


const normalizeRoleToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const MULTIMEDIA_ROLE_ALIASES = {
  [ROLES.MM_SLIDE]: ['Operator Slide', 'Slide', 'Operator Proyektor'],
  [ROLES.MM_CAM]: ['Camera', 'Kamera', 'Kameraman', 'Camera Operator'],
  [ROLES.MM_SWITCH]: ['Switcher', 'Operator Switcher'],
  [ROLES.MM_PIC]: ['PIC Multimedia', 'PIC', 'Koordinator Multimedia'],
};

const multimediaRoleMatches = (roleValue, requiredRole) => {
  const actual = normalizeRoleToken(roleValue);
  const aliases = MULTIMEDIA_ROLE_ALIASES[requiredRole] || [requiredRole];
  return aliases.some(alias => normalizeRoleToken(alias) === actual);
};

const formatPersonnelDisplayName = (person) => {
  if (!person) return '-';

  const cleanName = String(person.name || person.nama || person.displayName || '')
    .replace(/^(Dkn\.|Pnt\.)\s*/i, '')
    .trim();
  if (!cleanName) return '-';

  // Prefix hanya untuk tampilan. Database tidak diubah.
  // Ambil role dari semua struktur yang digunakan pada data Firebase.
  const roleValues = [];
  const roleIds = [];

  const collectRole = value => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(collectRole);
      return;
    }

    if (typeof value === 'string') {
      roleValues.push(value);
      return;
    }

    if (typeof value === 'object') {
      [value.name, value.role, value.roleName, value.nama, value.label, value.code]
        .filter(Boolean)
        .forEach(item => roleValues.push(item));

      [value.id, value.roleId]
        .filter(Boolean)
        .forEach(item => roleIds.push(String(item).trim().toUpperCase()));
    }
  };

  collectRole(person.roles);
  collectRole(person.role);
  collectRole(person.roleName);
  collectRole(person.roleMemberships);
  collectRole(person._originalRoleMemberships);
  collectRole(person.roleIds);
  collectRole(person.roleId);
  collectRole(person.roleCode);
  collectRole(person.idRole);
  collectRole(person.memberships);

  const normalizedRoles = roleValues.map(normalizeRoleToken);
  const normalizedRoleIds = roleIds.map(value => value.replace(/[^A-Z0-9]/g, ''));

  // Master Role Firebase pada aplikasi:
  // RL00001 = Diaken, RL00002 = Penatua.
  const isDiaken =
    normalizedRoles.some(role => role === 'diaken' || role.includes('diaken')) ||
    normalizedRoleIds.includes('RL00001') ||
    hasActiveRole(person, 'Diaken', 'Presbiter');

  const isPenatua =
    normalizedRoles.some(role => role === 'penatua' || role.includes('penatua')) ||
    normalizedRoleIds.includes('RL00002') ||
    hasActiveRole(person, 'Penatua', 'Presbiter');

  if (isDiaken) return `Dkn. ${cleanName}`;
  if (isPenatua) return `Pnt. ${cleanName}`;

  return cleanName;
};


const unitMatches = (actualValue, expectedUnit) => {
  const actual = normalizeRoleToken(actualValue);
  const expected = normalizeRoleToken(expectedUnit);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const aliases = {
    [normalizeRoleToken(UNITS.SOUND)]: ['sound', 'sound system', 'audio', 'operator sound'],
    [normalizeRoleToken(UNITS.MUGER)]: ['muger', 'musik gereja', 'pelayan musik'],
    [normalizeRoleToken(UNITS.PA)]: ['pelayanan anak', 'pa'],
    [normalizeRoleToken(UNITS.PT)]: ['persekutuan teruna', 'pt'],
    [normalizeRoleToken(UNITS.PENDETA)]: ['pendeta', 'phmj'],
    [normalizeRoleToken(UNITS.PRESBITER)]: ['presbiter', 'penatua diaken'],
  };
  return (aliases[expected] || []).includes(actual);
};

const hasActiveUnit = (person, expectedUnit) => {
  const memberships = normalizeMemberships(person).unitMemberships;
  return memberships.some(item =>
    String(item?.status || 'active').toLowerCase() !== 'inactive' &&
    unitMatches(item?.name, expectedUnit)
  );
};

const GENERIC_ROLE_ALIASES = {
  [ROLES.SOUND_OPS]: ['operator sound', 'sound operator', 'operator audio', 'sound', 'audio'],
  [ROLES.PS_PEMANDU]: ['pemandu lagu muger', 'pemandu lagu', 'prokantor', 'pemimpin pujian'],
  [ROLES.PS_ORGANIS]: ['organis pianis', 'organis', 'pianis', 'keyboardist', 'keyboard'],
  [ROLES.PS_PEMUSIK]: ['pemusik', 'musisi', 'instrumentalis'],
  [ROLES.PS_TIM_MUSIK]: ['tim musik', 'music team'],
  [ROLES.PS_CHOIR]: ['paduan suara vg', 'paduan suara', 'choir', 'vocal group', 'vg'],
  [ROLES.PENDETA]: ['pendeta', 'pastor'],
  [ROLES.PENATUA]: ['penatua'],
  [ROLES.DIAKEN]: ['diaken'],
  [ROLES.KAKAK_LAYAN]: ['kakak layan', 'pelayan anak', 'pelayan teruna'],
  [ROLES.PEMBAWA_CERITA]: ['pembawa cerita', 'cerita'],
  [ROLES.PL_PELKAT]: ['pemandu lagu pelkat', 'pemandu lagu'],
};

const genericRoleMatches = (actualValue, expectedRole) => {
  const actual = normalizeRoleToken(actualValue);
  const expected = normalizeRoleToken(expectedRole);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  return (GENERIC_ROLE_ALIASES[expectedRole] || [])
    .map(normalizeRoleToken)
    .some(alias => actual === alias || actual.includes(alias) || alias.includes(actual));
};

const hasActiveRole = (person, expectedRole, expectedUnit = '') => {
  const memberships = normalizeMemberships(person).roleMemberships;
  const active = memberships.some(item =>
    String(item?.status || 'active').toLowerCase() !== 'inactive' &&
    genericRoleMatches(item?.name, expectedRole) &&
    (!expectedUnit || !item?.unit || unitMatches(item.unit, expectedUnit))
  );
  if (active) return true;
  return (person?.roles || []).some(role => genericRoleMatches(role, expectedRole));
};

const PELKAT_CLASS_ROLE_MAP = {
  pa_batita: { unit: UNITS.PA, role: ROLES.PA_BATITA },
  pa_tk: { unit: UNITS.PA, role: ROLES.PA_TK },
  pa_kecil: { unit: UNITS.PA, role: ROLES.PA_KECIL },
  pa_tanggung: { unit: UNITS.PA, role: ROLES.PA_TANGGUNG },
  pt_eka: { unit: UNITS.PT, role: ROLES.PT_EKA },
  pt_dwi: { unit: UNITS.PT, role: ROLES.PT_DWI },
};

const normalizePelkatClassId = (value) => {
  const token = normalizeRoleToken(value);
  const aliases = {
    'pa batita': 'pa_batita', 'pelayanan anak batita': 'pa_batita', 'batita': 'pa_batita', 'kelas batita': 'pa_batita',
    'pa tk': 'pa_tk', 'pelayanan anak tk': 'pa_tk', 'tk': 'pa_tk', 'kelas tk': 'pa_tk',
    'pa kecil': 'pa_kecil', 'pelayanan anak kecil': 'pa_kecil', 'kecil': 'pa_kecil', 'kelas kecil': 'pa_kecil',
    'pa tanggung': 'pa_tanggung', 'pelayanan anak tanggung': 'pa_tanggung', 'tanggung': 'pa_tanggung', 'kelas tanggung': 'pa_tanggung',
    'pt eka': 'pt_eka', 'persekutuan teruna eka': 'pt_eka', 'eka': 'pt_eka', 'kelas eka': 'pt_eka',
    'pt dwi': 'pt_dwi', 'persekutuan teruna dwi': 'pt_dwi', 'dwi': 'pt_dwi', 'kelas dwi': 'pt_dwi',
  };
  return aliases[token] || String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
};

const normalizeLegacyPelkatUnit = (value) => {
  const classId = normalizePelkatClassId(value);
  const config = PELKAT_CLASS_ROLE_MAP[classId];

  if (config) {
    return {
      unitName: config.unit,
      inferredRole: config.role,
      classId,
    };
  }

  return {
    unitName: value,
    inferredRole: '',
    classId: '',
  };
};

const servesPelkatClass = (person, classId) => {
  const config = PELKAT_CLASS_ROLE_MAP[classId];
  if (!config) return false;

  // Struktur baru: kelas disimpan sebagai role aktif di unit PA/PT.
  if (hasActiveUnit(person, config.unit) && hasActiveRole(person, config.role, config.unit)) {
    return true;
  }

  // Kompatibilitas data lama selama migrasi: pelkatClasses atau unit PA-Batita/PT-Eka.
  if ((person?.pelkatClasses || []).some(value => normalizePelkatClassId(value) === classId)) {
    return true;
  }

  return (person?.unitMemberships || []).some(item =>
    String(item?.status || 'active').toLowerCase() !== 'inactive' &&
    normalizePelkatClassId(item?.name) === classId
  );
};

const hasActiveMultimediaRole = (person, requiredRole) => {
  const memberships = Array.isArray(person?.roleMemberships)
    ? person.roleMemberships
    : [];

  const activeMembershipMatch = memberships.some((membership) => {
    const unitName = normalizeRoleToken(membership?.unit);
    const status = String(membership?.status || 'active').toLowerCase();

    return (
      status !== 'inactive' &&
      multimediaRoleMatches(membership?.name, requiredRole) &&
      (!unitName || unitName === normalizeRoleToken(UNITS.MULTIMEDIA))
    );
  });

  if (activeMembershipMatch) return true;

  return (person?.roles || []).some((roleName) =>
    multimediaRoleMatches(roleName, requiredRole)
  );
};

// Ketersediaan petugas Multimedia mengikuti kolom "Penugasan" pada database.
// "Khusus Tambak" = hanya Ibadah 17.00 SP 1.
const getMultimediaRulePriority = (person, svc) => {
  const code = getMultimediaRuleCode(
    person?.multimediaAssignment || person?.penugasanMultimedia
  );
  const time = String(svc?.time || '').trim();
  const tambak = isTambakService(svc);

  if (code === 'TAMBAK_ONLY' && tambak) return 0;
  if (code === 'TIME_0600' && time.startsWith('06:00')) return 0;
  if (code === 'TIME_0800' && time.startsWith('08:00')) return 0;
  if (code === 'TIME_1000' && time.startsWith('10:00')) return 0;
  if (code === 'TIME_1700' && time.startsWith('17:00') && !tambak) return 0;
  if (code === 'TIME_1700_1900' && (time.startsWith('17:00') || time.startsWith('19:00')) && !tambak) return 0;
  if (code === 'TIME_1900' && time.startsWith('19:00')) return 0;
  if (code === 'FOLLOW_MUGER') return 1;
  if (code === 'ALL_TIMES') return 2;
  return 3;
};

const canServeMultimediaService = (person, svc) => {
  const rule = String(person?.multimediaAssignment || person?.penugasanMultimedia || '').trim().toLowerCase();
  if (!rule || rule === '-' || rule.includes('bisa jam berapa aja') || rule.includes('semua jam')) return true;

  const time = String(svc?.time || '').trim().toLowerCase();
  const isTambak = isTambakService(svc);

  if ((rule.includes('khusus tambak') || rule.includes('sp i') || rule.includes('sp 1'))) return isTambak;
  if (rule.includes('08.00') || rule.includes('08:00')) return time.startsWith('08:00');
  if (rule.includes('10.00') || rule.includes('10:00')) return time.startsWith('10:00');
  if ((rule.includes('17.00') || rule.includes('17:00')) && (rule.includes('19.00') || rule.includes('19:00'))) {
    return time.startsWith('17:00') || time.startsWith('19:00');
  }
  if (rule.includes('17.00') || rule.includes('17:00')) return time.startsWith('17:00');
  if (rule.includes('19.00') || rule.includes('19:00')) return time.startsWith('19:00');
  if (rule.includes('06.00') || rule.includes('06:00')) return time.startsWith('06:00');

  // Catatan non-jam seperti "mengikuti jadwal PL/choir" tidak diblokir otomatis.
  return true;
};

const followsMugerSchedule = (person) => {
  const rule = String(person?.multimediaAssignment || person?.penugasanMultimedia || '').trim().toLowerCase();
  return rule.includes('mengikuti jadwal pl/choir') || rule.includes('mengikuti jadwal pl') || rule.includes('menyesuaikan jadwal') || rule.includes('choir');
};

const getMugerServiceIdsForUser = (dayServices = {}, userId) => {
  const serviceIds = [];
  Object.entries(dayServices || {}).forEach(([serviceId, serviceData]) => {
    const isAssignedAsMuger = Object.entries(serviceData || {}).some(([key, value]) => {
      if (!key.startsWith('ps_')) return false;
      return value?.userId === userId;
    });
    if (isAssignedAsMuger) serviceIds.push(String(serviceId));
  });
  return serviceIds;
};

const getAdjacentServiceIds = (svcsToday = [], serviceIds = []) => {
  const result = new Set();
  serviceIds.forEach(serviceId => {
    const index = svcsToday.findIndex(svc => String(svc.id) === String(serviceId));
    if (index > 0) result.add(String(svcsToday[index - 1].id));
    if (index >= 0 && index < svcsToday.length - 1) result.add(String(svcsToday[index + 1].id));
  });
  return result;
};

const getServiceConfig = (svc) => {
  let actualPCount = Number(svc.pCount) || 8;
  let isIKM = svc.isIKM || false;
  const label = svc.label || "";
  const time = svc.time || "";
  if (label.includes('Jumat Agung')) {
    if (time.includes('06:00')) { actualPCount = 8; isIKM = false; }
    else if (time.includes('08:00')) { actualPCount = 14; isIKM = false; }
    else if (time.includes('10:00')) { actualPCount = 29; isIKM = false; }
    else if (time.includes('17:00') && (label.includes('SP') || time.includes('SP'))) {
      actualPCount = 7; isIKM = false; 
    }
    else if (time.includes('17:00')) { actualPCount = 25; isIKM = false; }
    else if (time.includes('19:00')) { actualPCount = 10; isIKM = true; }
  } else if (label.includes('Paskah Subuh')) {
    actualPCount = 20;
  }
  return { actualPCount, isIKM };
};
const PELKAT_BASE_ROLES = [
  {key: 'absensi', label: 'Absensi' },
  {key: 'liturgos', label: 'Liturgos' },
  {key: 'cerita', label: 'Cerita' },
  {key: 'multimedia', label: 'Multimedia' },
  {key: 'pemusik', label: 'Pemusik' }
];
const generateSlots = (total) => {
  const slots = [];
  for (let i = 0; i < total; i++) {
    if (i < PELKAT_BASE_ROLES.length) {
      slots.push(PELKAT_BASE_ROLES[i]);
    } else {
      slots.push({key: `kl_${i - PELKAT_BASE_ROLES.length + 1}`, label: `Kakak Layan ${i - PELKAT_BASE_ROLES.length + 1}`});
    }
  }
  return slots;
};
const PELKAT_CONFIG = {
  PA: [
    { id: 'pa_batita', label: 'Kelas Batita', room: 'Ruang Lantai 2 Sekretariat', slots: generateSlots(4) },
    { id: 'pa_tk', label: 'Kelas TK', room: 'Ruang Pertemuan', slots: [
      {key: 'absensi', label: 'Absensi' },
      {key: 'liturgos', label: 'Liturgos' },
      {key: 'cerita', label: 'Cerita' },
      {key: 'multimedia', label: 'Multimedia' },
      {key: 'usher', label: 'Usher' },
      {key: 'kolekte', label: 'Persembahan/Kolekte' }
    ]},
    { id: 'pa_kecil', label: 'Kelas Kecil', room: 'Ruang Lounge', slots: [
      {key: 'absensi', label: 'Absensi' },
      {key: 'liturgos', label: 'Liturgos' },
      {key: 'cerita', label: 'Cerita' },
      {key: 'multimedia', label: 'Multimedia' },
      {key: 'persembahan', label: 'Persembahan' },
      {key: 'usher', label: 'Usher' }
    ]},
    { id: 'pa_tanggung', label: 'Kelas Tanggung', room: 'Gedung Serbaguna 2B', slots: generateSlots(4) },
  ],
  PT: [
    { id: 'pt_eka', label: 'Kelas Eka', slots: generateSlots(4) },
    { id: 'pt_dwi', label: 'Kelas Dwi', slots: generateSlots(4) }
  ]
};
const PELKAT_CLASS_OPTIONS = {
  [UNITS.PA]: PELKAT_CONFIG.PA,
  [UNITS.PT]: PELKAT_CONFIG.PT
};
const getAllPelkatLabels = (classes = []) => {
  if (classes.length === 0) return '-';
  const allOptions = [...(PELKAT_CONFIG.PA || []), ...(PELKAT_CONFIG.PT || [])];
  return classes.map(id => allOptions.find(c => c.id === id)?.label || id).join(', ');
};
const DATE_SETTING_ID = '__date_service_setting__';
const getDateServiceSetting = (dateString, customServices = {}) =>
  (customServices[dateString] || []).find(item => item?.isDateSetting || item?.id === DATE_SETTING_ID) || null;
const getCustomServicesOnly = (dateString, customServices = {}) =>
  (customServices[dateString] || []).filter(item => !item?.isDateSetting && item?.id !== DATE_SETTING_ID);
const getServicesForDate = (dateString, customServices = {}) => {
  if (!dateString) return [];
  const isSunday = new Date(dateString).getDay() === 0;
  const dateSetting = getDateServiceSetting(dateString, customServices);
  const isCommunion = dateSetting?.serviceMode === 'HOLY_COMMUNION';
  let svcs = isSunday
    ? SUNDAY_SERVICES.map(service => ({
        ...service,
        serviceMode: isCommunion ? 'HOLY_COMMUNION' : 'REGULAR',
        isCommunion,
      }))
    : [];
  const customRows = getCustomServicesOnly(dateString, customServices);
  const hasPaskah = customRows.some(service => String(service.label || '').toLowerCase().includes('paskah'));
  if ((isSunday && dateString.endsWith('-04-05')) || hasPaskah) {
    svcs = svcs.filter(service => service.time !== '06:00' && service.time !== '08:00');
  }
  svcs = [
    ...svcs,
    ...customRows.map(service => ({
      ...service,
      serviceMode: service.serviceMode || (isCommunion ? 'HOLY_COMMUNION' : 'REGULAR'),
      isCommunion: service.isCommunion ?? isCommunion,
    })),
  ];
  svcs.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  return svcs;
};
// ==========================================
// 4. BANTUAN PARSER CSV & UTILITAS UMUM
// ==========================================
const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    
    if (inQuotes) {
      if (char === '"' && next === '"') { 
        field += '"'; 
        i++; 
      } else if (char === '"') { 
        inQuotes = false; 
      } else { 
        field += char; 
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') { 
        row.push(field); 
        field = ""; 
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && next === '\n') i++; 
        row.push(field);
        if (row.some(c => c.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else { 
        field += char; 
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some(c => c.trim() !== "")) rows.push(row);
  }
  return rows;
};
const triggerPushNotification = (title, body) => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/3050/3050525.png' });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/3050/3050525.png' });
      }
    });
  }
};
const DebouncedInput = ({ value, onChange, placeholder, disabled, className }) => {
  const [localVal, setLocalVal] = useState(value || "");
  useEffect(() => { setLocalVal(value || ""); }, [value]);
  return (
    <input
      type="text"
      disabled={disabled}
      className={className}
      value={localVal}
      onChange={e => setLocalVal(e.target.value)}
      onBlur={() => { if(localVal !== value) onChange(localVal); }}
      placeholder={placeholder}
    />
  );
};

const SearchableSelect = ({ value, onChange, options = [], disabled = false, placeholder = '- Pilih -' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const selected = options.find(option => String(option.value) === String(value));
  const filtered = options.filter(option => String(option.label || '').toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return <div ref={ref} className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
      className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm disabled:bg-gray-100">
      <span className={selected ? 'text-gray-800' : 'text-gray-400'}>{selected?.label || placeholder}</span>
      <ChevronDown className="h-4 w-4 text-gray-400" />
    </button>
    {open && !disabled && <div className="absolute left-0 top-full z-[120] mt-1 w-full min-w-[280px] rounded-lg border border-gray-200 bg-white p-2 shadow-2xl">
      <div className="relative mb-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari..."
          className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-500" /></div>
      <div className="max-h-56 overflow-y-auto">
        <button type="button" onClick={()=>{onChange('');setOpen(false);setQuery('');}}
          className="block w-full rounded px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50">{placeholder}</button>
        {filtered.map(option=><button key={option.value} type="button" onClick={()=>{onChange(option.value);setOpen(false);setQuery('');}}
          className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-blue-50 ${String(option.value)===String(value)?'bg-blue-50 font-semibold text-blue-700':''}`}>{option.label}</button>)}
        {!filtered.length && <div className="px-3 py-3 text-sm italic text-gray-400">Data tidak ditemukan.</div>}
      </div>
    </div>}
  </div>;
};
// ==========================================
// 5. DATABASE DUMMY LENGKAP
// ==========================================
const calculateDetailedStats = (personnel, assignments, swapRequests = [], customServices = {}) => {
  const stats = {};
  personnel.forEach(p => {
    stats[p.id] = { total: 0, byMonth: {}, details: [], byPosition: {}, byTime: {}, swapsRequested: 0, swapsAccepted: 0 };
  });
  Object.entries(assignments).forEach(([date, categories]) => {
    const month = date.slice(0, 7);
    const countOne = (uid, label, type, path, time, position, team = null) => {
      if(uid && stats[uid]) {
        stats[uid].total++;
        stats[uid].byMonth[month] = (stats[uid].byMonth[month] || 0) + 1;
        stats[uid].details.push({ date, label, type, status: 'assigned', path, time, position, team });
        if (position) stats[uid].byPosition[position] = (stats[uid].byPosition[position] || 0) + 1;
        if (time) stats[uid].byTime[time] = (stats[uid].byTime[time] || 0) + 1;
      }
    };
    const count = (uid, label, type, path, time, position) => {
      if (!uid) return;

      const assignee = personnel.find(p => String(p.id) === String(uid));

      if (assignee?.isTeam) {
        countOne(uid, label, type, path, time, position, {
          id: assignee.id,
          name: assignee.name,
        });

        (assignee.memberIds || []).forEach(memberId => {
          countOne(
            memberId,
            `${label} — ${assignee.name}`,
            type,
            path,
            time,
            position,
            { id: assignee.id, name: assignee.name }
          );
        });
        return;
      }

      const activeTeamMembers = personnel.filter(person =>
        (person.musicTeams || []).some(team =>
          String(team.id) === String(uid) &&
          String(team.status || 'active').toLowerCase() !== 'inactive'
        )
      );

      if (activeTeamMembers.length > 0) {
        const teamName =
          activeTeamMembers
            .flatMap(person => person.musicTeams || [])
            .find(team => String(team.id) === String(uid))
            ?.name || String(uid);

        activeTeamMembers.forEach(member => {
          countOne(
            member.id,
            `${label} — ${teamName}`,
            type,
            path,
            time,
            position,
            { id: uid, name: teamName }
          );
        });
        return;
      }

      countOne(uid, label, type, path, time, position);
    };
    if(categories.services) {
      Object.entries(categories.services).forEach(([svcId, s]) => {
        let svcDef = SUNDAY_SERVICES.find(x => x.id.toString() === svcId.toString());
        if (!svcDef && customServices[date]) {
          svcDef = customServices[date].find(x => x.id.toString() === svcId.toString());
        }
        if (!svcDef) return;
        
        const svcLabel = svcDef.label;
        const svcTime = svcDef.time;
        
        Object.entries(s).forEach(([k, v]) => {
          if (k.endsWith('_est') || k.endsWith('_soloist') || k.endsWith('_instr')) return;
          
          let displayPos = k.toUpperCase();
          if (k.startsWith('ps_vg')) displayPos = 'PS/VG';
          if (k === 'ps_organis') displayPos = 'ORGANIS (08.00)';
          if (k === 'ps_pemandu') displayPos = 'PEMANDU LAGU';
          if (k === 'ps_pemusik1' || k === 'ps_pemusik2') displayPos = 'PEMUSIK';
          if (k === 'ps_tim_musik') displayPos = 'TIM MUSIK';
          if (k.startsWith('mm_')) displayPos = displayPos.replace('MM_', '');
          if (k.startsWith('sound')) displayPos = displayPos.replace('SOUND', 'SOUND ');
          count(v?.userId, `${svcLabel} - ${displayPos}`, 'Minggu', { category: 'services', catId: svcId, key: k}, svcTime, displayPos);
        });
      });
    }
    if(categories.pa) {
      Object.entries(categories.pa).forEach(([cId, c]) => {
        const classConfig = PELKAT_CONFIG.PA.find(x => x.id === cId);
        const classLabel = classConfig?.label || cId;
        Object.entries(c).forEach(([k, v]) => {
          const slotConfig = classConfig?.slots?.find(s => s.key === k);
          const slotLabel = slotConfig ? slotConfig.label : (k.startsWith('kl_') ? `Kakak Layan ${k.replace('kl_', '')}` : k.charAt(0).toUpperCase() + k.slice(1));
          count(v?.userId, `PA - ${classLabel} (${slotLabel})`, 'PA', { category: 'pa', catId: cId, key: k }, '08:00', `PA ${classLabel} - ${slotLabel}`);
        });
      });
    }
    if(categories.pt) {
      Object.entries(categories.pt).forEach(([cId, c]) => {
        const classConfig = PELKAT_CONFIG.PT.find(x => x.id === cId);
        const classLabel = classConfig?.label || cId;
        Object.entries(c).forEach(([k, v]) => {
          const slotConfig = classConfig?.slots?.find(s => s.key === k);
          const slotLabel = slotConfig ? slotConfig.label : (k.startsWith('kl_') ? `Kakak Layan ${k.replace('kl_', '')}` : k.charAt(0).toUpperCase() + k.slice(1));
          count(v?.userId, `PT - ${classLabel} (${slotLabel})`, 'PT', { category: 'pt', catId: cId, key: k }, '08:00', `PT ${classLabel} - ${slotLabel}`);
        });
      });
    }
    if(categories.presbiterPendamping) {
      Object.entries(categories.presbiterPendamping).forEach(([k, v]) => {
        const isPA = k.startsWith('pa_');
        const clsName = isPA 
          ? PELKAT_CONFIG.PA.find(x=>x.id===k)?.label 
          : PELKAT_CONFIG.PT.find(x=>x.id===k)?.label;
        const label = `Pendamping ${isPA ? 'PA' : 'PT'} - ${clsName || k}`;
        count(v?.userId, label, 'Pelkat', { category: 'presbiterPendamping', catId: k, key: 'pendamping' }, '08:00', 'PENDAMPING PELKAT');
      });
    }
    if(categories.pendetaPendamping) {
      Object.entries(categories.pendetaPendamping).forEach(([k, v]) => {
        count(v?.userId, `Pendeta Pendamping ${k.toUpperCase()}`, 'Pelkat', { category: 'pendetaPendamping', catId: k, key: 'pendamping' }, '08:00', 'PENDETA PENDAMPING');
      });
    }
    if(categories.pemimpinPersiapan) {
      if(categories.pemimpinPersiapan.pa) count(categories.pemimpinPersiapan.pa?.userId, 'Pemimpin Persiapan PA (Jumat)', 'Pelkat', { category: 'pemimpinPersiapan', catId: 'pa', key: 'pemimpin' }, 'Jumat', 'PEMIMPIN PERSIAPAN PA');
      if(categories.pemimpinPersiapan.pt) count(categories.pemimpinPersiapan.pt?.userId, 'Pemimpin Persiapan PT (Jumat)', 'Pelkat', { category: 'pemimpinPersiapan', catId: 'pt', key: 'pemimpin' }, 'Jumat', 'PEMIMPIN PERSIAPAN PT');
    }
  });
  swapRequests.forEach(req => {
    if (req.status === 'accepted') {
      if (stats[req.requesterId]) stats[req.requesterId].swapsRequested++;
      if (stats[req.targetUserId]) stats[req.targetUserId].swapsAccepted++;
    }
  });
  return stats;
};
const isAdminPersonnelRecord = (person) => {
  const roles = [
    ...(person?.roles || []),
    person?.appRole,
    person?.systemRole,
    person?.profileRole,
  ]
    .filter(Boolean)
    .map(value => String(value).toUpperCase());

  const name = String(person?.name || '').trim();
  const id = String(person?.id || '').trim();
  const loginEmail = String(person?.loginEmail || person?.email || '').toLowerCase();

  return (
    roles.includes(String(ROLES.SUPERADMIN).toUpperCase()) ||
    roles.includes(String(ROLES.ADMIN_UNIT).toUpperCase()) ||
    roles.includes('SUPERADMIN') ||
    roles.includes('ADMIN_UNIT') ||
    person?.isAdmin === true ||
    /^admin\b/i.test(name) ||
    /^ADM/i.test(id) ||
    /admin.*@/i.test(loginEmail)
  );
};

const checkPermission = (user, section) => {
  if (!user) return false;
  const roles = user.roles || [];
  const units = user.units || [];
  const userName = String(user.name || '').trim();
  const isSuperAdmin =
    roles.includes(ROLES.SUPERADMIN) ||
    /admin\s+phmj|super\s*admin/i.test(userName) ||
    String(user.appRole || '').toUpperCase() === 'SUPERADMIN';
  const isUnitAdmin =
    roles.includes(ROLES.ADMIN_UNIT) ||
    (/^admin\b/i.test(userName) && !isSuperAdmin) ||
    String(user.appRole || '').toUpperCase() === 'ADMIN_UNIT';
  if (isSuperAdmin) return true;
  if (!isUnitAdmin) return false;
  const hasUnit = target => units.some(unit => unitMatches(unit?.name || unit, target));
  switch(section) {
    case 'presbiter': return hasUnit(UNITS.PRESBITER) || hasUnit(UNITS.GP);
    case 'multimedia': return hasUnit(UNITS.MULTIMEDIA);
    case 'sound': return hasUnit(UNITS.SOUND);
    case 'muger': return hasUnit(UNITS.MUGER) || hasUnit(UNITS.PS) || hasUnit(UNITS.GP);
    case 'pelkat': return hasUnit(UNITS.PA) || hasUnit(UNITS.PT);
    default: return false;
  }
};
// ==========================================
// 6. KOMPONEN-KOMPONEN APLIKASI
// ==========================================
const Login = ({ onLogin, users }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    return users.filter(u =>
      (u.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.units || []).join(', ').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, users]);
  const handleSelectUser = (user) => {
    setSelectedUserId(user.id);
    setSearchTerm(user.name);
    setShowDropdown(false);
    setError("");
  };
  const handleLogin = async (e) => {
    e.preventDefault();
    let finalUserId = selectedUserId;
    if (!finalUserId && searchTerm) {
      const exactMatch = users.find(u => (u.name || "").toLowerCase() === searchTerm.toLowerCase());
      if (exactMatch) finalUserId = exactMatch.id;
    }
    if (!finalUserId) { setError('Silakan cari dan pilih nama pengguna dari daftar.'); return; }
    const loginUser = users.find(u => u.id === finalUserId);
    if (!loginUser) { setError('Pengguna tidak ditemukan.'); return; }
    try {
      setError('');
      await onLogin(loginUser, password, rememberMe);
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
        setError('Nama atau password salah.');
      } else {
        setError(err?.message || 'Login gagal.');
      }
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4" style={{
      backgroundImage: `url('https://images.unsplash.com/photo-1548625361-ec20ce745c11?q=80&w=1400&auto=format&fit=crop')`, 
      backgroundSize: 'cover'
    }}>
      <div className="bg-white/95 p-6 sm:p-8 rounded-lg shadow-xl w-full max-w-md border-t-4 border-blue-600 relative">
        <div className="text-center mb-6">
          <ShieldCheck className="w-10 h-10 sm:w-12 sm:h-12 text-blue-600 mx-auto mb-2" />
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Sistem Penugasan</h1>
          <h2 className="text-base sm:text-lg text-gray-600">GPIB Jemaat Paulus Jakarta</h2>
        </div>
        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</div>}
        
        <form onSubmit={handleLogin} className="space-y-5">
          <div className="relative" ref={dropdownRef}>
            <label className="block text-sm font-medium mb-1 text-gray-700">Cari Nama Anda</label>
            <div className="relative">
              <Search className="w-5 h-5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                className="w-full border border-gray-300 rounded pl-10 pr-4 py-2 text-sm sm:text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
                placeholder="Ketik nama atau unit..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setSelectedUserId("");
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
              />
            </div>
            {showDropdown && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500 italic text-center">Nama tidak ditemukan</div>
                ) : (
                  filteredUsers.map(u => (
                    <div
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition flex flex-col"
                    >
                      <span className="font-semibold text-gray-800 text-sm">{u.name}</span>
                      <span className="text-xs text-gray-500">
                        {u.loginRoleLabel ||
                          ((u.units || []).length
                            ? (u.units || []).join(', ')
                            : 'Unit belum disinkronkan')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded px-4 py-2 text-sm sm:text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition"
              placeholder="Masukkan password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="rememberMe"
              className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
            />
            <label htmlFor="rememberMe" className="text-sm text-gray-600 cursor-pointer select-none">Ingat Saya</label>
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2.5 rounded font-bold text-sm sm:text-base hover:bg-blue-700 transition mt-2">Masuk Aplikasi</button>
        </form>
      </div>
    </div>
  );
};
const Dashboard = ({ user, assignments, publishedSchedules, swapRequests, customServices }) => {
  const stats = calculateDetailedStats([user], assignments, swapRequests, customServices);
  const myStats = stats[user?.id] || { total: 0, byMonth: {}, details: [], byPosition: {}, byTime: {}, swapsRequested: 0, swapsAccepted: 0 };
  const myFutureTasks = myStats.details.filter(d => new Date(d.date) >= new Date());
  
  const [sortOrder, setSortOrder] = useState('asc');
  const sortedTasks = useMemo(() => {
    return [...myFutureTasks].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      
      const timeA = a.time || "";
      const timeB = b.time || "";
      return sortOrder === 'asc' ? timeA.localeCompare(timeB) : timeB.localeCompare(timeA);
    });
  }, [myFutureTasks, sortOrder]);
  const positionStats = useMemo(() => {
    return Object.entries(myStats.byPosition).sort((a,b)=>b[1]-a[1]);
  }, [myStats.byPosition]);
  return (
    <div className="p-4 sm:p-6 relative">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6">Halo, {user?.name}</h2>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <div className="p-3 bg-blue-100 rounded-full text-blue-600 mr-4"><Calendar className="w-5 h-5 sm:w-6 sm:h-6" /></div>
          <div><p className="text-xs sm:text-sm text-gray-500">Tanggal Hari Ini</p><p className="text-lg sm:text-xl font-bold">{formatDateIndo(getTodayString())}</p></div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <div className="p-3 bg-green-100 rounded-full text-green-600 mr-4"><BarChart3 className="w-5 h-5 sm:w-6 sm:h-6" /></div>
          <div><p className="text-xs sm:text-sm text-gray-500">Total Tugas Saya</p><p className="text-lg sm:text-xl font-bold">{myStats.total} Kali</p></div>
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-sm border border-gray-200 flex items-center">
          <div className="p-3 bg-purple-100 rounded-full text-purple-600 mr-4"><Users className="w-5 h-5 sm:w-6 sm:h-6" /></div>
          <div><p className="text-xs sm:text-sm text-gray-500">Unit Pelayanan</p><p className="text-lg sm:text-xl font-bold truncate max-w-[150px]">{user?.roles?.includes(ROLES.SUPERADMIN) ? "PHMJ" : (user?.units || []).join(', ')}</p></div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow border border-gray-200 lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-700 text-sm sm:text-base">Jadwal Saya Mendatang</h3>
            {myFutureTasks.length > 1 && (
              <button onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="flex items-center text-[10px] sm:text-xs text-blue-600 font-semibold hover:text-blue-800 bg-blue-50 px-2 py-1.5 sm:px-3 rounded transition">
                <ArrowUpDown className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5" />
                {sortOrder === 'asc' ? 'Terdekat' : 'Terjauh'}
              </button>
            )}
          </div>
          {sortedTasks.length > 0 ? (
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
              {sortedTasks.map((task, idx) => (
                <div key={idx} className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2"><span className="bg-blue-100 text-blue-800 text-[10px] sm:text-xs font-bold px-2 py-1 rounded">{formatDateIndo(task.date)}</span></div>
                    <h4 className="font-bold text-gray-800 mb-1 text-sm sm:text-base">{task.label}</h4>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 flex items-center"><Clock className="w-3 h-3 mr-1"/> {task.time} WIB</div>
                </div>
              ))}
            </div>
          ) : <p className="text-gray-500 italic text-sm">Belum ada jadwal tugas.</p>}
        </div>
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow border border-gray-200 lg:col-span-1">
          <h3 className="font-bold text-gray-700 text-sm sm:text-base mb-1 flex items-center"><PieChart className="w-4 h-4 mr-2 text-blue-600"/> Statistik Pelayanan</h3>
          <p className="text-[10px] sm:text-xs text-gray-500 mb-4 pb-2 border-b">Akumulasi seluruh waktu</p>
          {positionStats.length > 0 ? (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {positionStats.map(([pos, count]) => (
                <div key={pos} className="flex justify-between items-center border-b border-gray-50 pb-2 last:border-0">
                  <span className="text-gray-700 text-xs sm:text-sm font-medium">{pos}</span>
                  <span className="bg-blue-50 border border-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-md text-xs">{count}x</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic text-xs">Belum ada riwayat penugasan.</p>
          )}
        </div>
      </div>
    </div>
  );
};
const UserPerformance = ({ user, assignments, personnel, swapRequests, customServices }) => {
  const stats = calculateDetailedStats(personnel, assignments, swapRequests, customServices);
  const myStats = stats[user?.id] || { total: 0, byMonth: {}, details: [], byPosition: {}, byTime: {}, swapsRequested: 0, swapsAccepted: 0 };
  
  const [selectedMonth, setSelectedMonth] = useState(getTodayString().slice(0, 7));
  const monthlyDetails = myStats.details.filter(d => d.date.startsWith(selectedMonth)) || [];
  const monthData = monthlyDetails.length;
  const monthByPos = {};
  const monthByTime = {};
  monthlyDetails.forEach(d => {
    if(d.position) monthByPos[d.position] = (monthByPos[d.position] || 0) + 1;
    if(d.time) monthByTime[d.time] = (monthByTime[d.time] || 0) + 1;
  });
  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Kinerja Pelayanan Saya</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-blue-50/50 p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h4 className="font-bold text-gray-800 text-base sm:text-lg">Statistik Bulanan</h4>
            <p className="text-xs text-gray-500 mt-1">Rincian penugasan Anda untuk bulan terpilih.</p>
          </div>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="border border-gray-300 rounded-lg p-2 text-sm w-full sm:w-auto shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"/>
        </div>
        
        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col items-center justify-center text-center">
            <span className="text-4xl font-black text-blue-600 mb-1">{monthData}</span>
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Total Tugas</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col">
            <h6 className="font-bold text-gray-700 text-xs mb-3 border-b border-gray-100 pb-2 flex items-center"><Layers className="w-4 h-4 mr-1.5 text-gray-400"/> Posisi</h6>
            <div className="space-y-2 flex-1 overflow-y-auto max-h-32 pr-1">
              {Object.keys(monthByPos).length === 0 ? <p className="text-xs text-gray-400 italic">Belum ada data</p> :
                Object.entries(monthByPos).map(([pos, count]) => (
                  <div key={pos} className="flex justify-between items-center text-sm">
                    <span className="text-gray-600 truncate mr-2" title={pos}>{pos}</span>
                    <span className="font-bold bg-gray-100 px-2 py-0.5 rounded-md text-gray-700">{count}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col">
            <h6 className="font-bold text-gray-700 text-xs mb-3 border-b border-gray-100 pb-2 flex items-center"><Clock className="w-4 h-4 mr-1.5 text-gray-400"/> Jam Ibadah</h6>
            <div className="space-y-2 flex-1 overflow-y-auto max-h-32 pr-1">
              {Object.keys(monthByTime).length === 0 ? <p className="text-xs text-gray-400 italic">Belum ada data</p> :
                Object.entries(monthByTime).map(([time, count]) => (
                  <div key={time} className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">{time} WIB</span>
                    <span className="font-bold bg-gray-100 px-2 py-0.5 rounded-md text-gray-700">{count}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col">
            <h6 className="font-bold text-gray-700 text-xs mb-3 border-b border-gray-100 pb-2 flex items-center"><RefreshCw className="w-4 h-4 mr-1.5 text-gray-400"/> Tukar Jadwal</h6>
            <div className="space-y-3 flex-1 mt-1">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Mengajukan</span>
                <span className="font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">{myStats.swapsRequested || 0}</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-gray-600">Menggantikan</span>
                <span className="font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-md">{myStats.swapsAccepted || 0}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <h6 className="font-bold text-gray-800 mb-3 text-sm sm:text-base">Daftar Penugasan</h6>
          <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
            {monthlyDetails.length === 0 ? (
              <div className="p-6 text-sm text-gray-500 italic text-center">Tidak ada jadwal tugas di bulan ini.</div>
            ) : (
              <div className="divide-y divide-gray-200 max-h-[300px] overflow-y-auto">
                {monthlyDetails.map((d, i) => (
                  <div key={i} className="p-3 sm:p-4 hover:bg-white transition flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                      <div className="bg-blue-100 text-blue-700 font-bold text-xs sm:text-sm px-3 py-1.5 rounded-lg whitespace-nowrap text-center min-w-[50px]">
                        {formatDateShort(d.date)}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-800 text-sm sm:text-base">{d.label}</div>
                        <div className="text-xs text-gray-500 flex items-center mt-1"><Clock className="w-3 h-3 mr-1"/> {d.time} WIB</div>
                      </div>
                    </div>
                    <div className="text-[10px] sm:text-xs font-bold text-blue-800 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full whitespace-nowrap self-start sm:self-auto mt-2 sm:mt-0">
                      {d.position}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
const AdminStats = ({ personnel, assignments, swapRequests, customServices }) => {
  const servicePersonnel = personnel.filter(person => !isAdminPersonnelRecord(person));
  const stats = calculateDetailedStats(servicePersonnel, assignments, swapRequests, customServices);
  const sorted = [...servicePersonnel].sort((a,b) => (stats[b.id]?.total || 0) - (stats[a.id]?.total || 0));
  const [expandedUser, setExpandedUser] = useState(null);
  return (
    <div className="p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">Rincian Statistik Pelayanan</h2>
      <div className="bg-white p-4 sm:p-6 rounded shadow border">
        <h3 className="font-bold text-gray-700 mb-4 text-sm sm:text-base">Detail per Petugas</h3>
        <div className="space-y-2">
          {sorted.map(p => (
            <div key={p.id} className="border rounded overflow-hidden">
              <div
                className="bg-gray-50 p-3 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition pr-4"
                onClick={() => setExpandedUser(expandedUser === p.id ? null : p.id)}
              >
                <div className="font-bold text-xs sm:text-sm text-blue-800 truncate">
                  {p.name} <span className="text-gray-500 font-normal ml-1">({(p.units || []).join(', ')})</span>
                </div>
                <div className="flex items-center text-xs sm:text-sm font-bold text-gray-700 whitespace-nowrap">
                  <span className="mr-3">Total: {stats[p.id]?.total || 0}</span>
                  {expandedUser === p.id ? <ChevronDown className="w-4 h-4 text-blue-600"/> : <ChevronRight className="w-4 h-4 text-gray-400"/>}
                </div>
              </div>
              {expandedUser === p.id && (
                <div className="p-4 bg-white grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-gray-200">
                  <div>
                    <h6 className="text-[10px] font-bold text-gray-400 uppercase mb-2">Posisi Penugasan</h6>
                    {Object.entries(stats[p.id]?.byPosition || {}).map(([pos, count]) => (
                      <div key={pos} className="flex justify-between text-xs py-1 border-b border-gray-50"><span className="text-gray-700">{pos}</span><span className="font-semibold text-gray-800">{count}</span></div>
                    ))}
                    {Object.keys(stats[p.id]?.byPosition || {}).length === 0 && <span className="text-[10px] text-gray-400 italic">Belum ada data</span>}
                  </div>
                  <div>
                    <h6 className="text-[10px] font-bold text-gray-400 uppercase mb-2">Waktu Ibadah</h6>
                    {Object.entries(stats[p.id]?.byTime || {}).map(([time, count]) => (
                      <div key={time} className="flex justify-between text-xs py-1 border-b border-gray-50"><span className="text-gray-700">{time} WIB</span><span className="font-semibold text-gray-800">{count}</span></div>
                    ))}
                    {Object.keys(stats[p.id]?.byTime || {}).length === 0 && <span className="text-[10px] text-gray-400 italic">Belum ada data</span>}
                  </div>
                  <div>
                    <h6 className="text-[10px] font-bold text-gray-400 uppercase mb-2">Riwayat Tukar Jadwal</h6>
                    <div className="flex justify-between text-xs py-1 border-b border-gray-50"><span className="text-gray-700">Minta Digantikan (Sukses)</span><span className="font-bold text-orange-600">{stats[p.id]?.swapsRequested || 0}</span></div>
                    <div className="flex justify-between text-xs py-1 border-b border-gray-50"><span className="text-gray-700">Menggantikan Rekan</span><span className="font-bold text-green-600">{stats[p.id]?.swapsAccepted || 0}</span></div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
const UserSettings = ({ user, setUser, personnel, setPersonnel }) => {
  const [profileForm, setProfileForm] = useState({
    name: user?.name || '',
    email: user?.email || user?.contactEmail || '',
    phone: user?.phone || '',
    telephone: user?.telephone || user?.landline || '',
    wargaJemaat:
      user?.wargaJemaat === true
        ? 'yes'
        : user?.wargaJemaat === false
          ? 'no'
          : '',
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const { showAlert } = useDialog();

  useEffect(() => {
    setProfileForm({
      name: user?.name || '',
      email: user?.email || user?.contactEmail || '',
      phone: user?.phone || '',
      telephone: user?.telephone || user?.landline || '',
      wargaJemaat:
        user?.wargaJemaat === true
          ? 'yes'
          : user?.wargaJemaat === false
            ? 'no'
            : '',
    });
  }, [user?.id]);

  const handleSaveProfile = async event => {
    event.preventDefault();

    if (!profileForm.name.trim()) {
      await showAlert('Nama wajib diisi.');
      return;
    }

    if (profileForm.email.trim() && !isValidEmail(profileForm.email)) {
      await showAlert('Format email tidak valid.');
      return;
    }

    setSavingProfile(true);

    try {
      const updated = {
        ...user,
        name: profileForm.name.trim(),
        email: profileForm.email.trim().toLowerCase(),
        contactEmail: profileForm.email.trim().toLowerCase(),
        phone: normalizePhone(profileForm.phone),
        telephone: normalizePhone(profileForm.telephone),
        landline: normalizePhone(profileForm.telephone),
        wargaJemaat:
          profileForm.wargaJemaat === 'yes'
            ? true
            : profileForm.wargaJemaat === 'no'
              ? false
              : null,
      };

      await Promise.all([
        safeSetDoc(
          doc(db, 'users', user.id),
          {
            name: updated.name,
            normalizedName: updated.name.toLowerCase(),
            email: updated.email,
            phone: updated.phone,
            telephone: updated.telephone,
            wargaJemaat: updated.wargaJemaat,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        safeSetDoc(
          doc(db, 'loginDirectory', user.id),
          {
            name: updated.name,
            contactEmail: updated.email,
            phone: updated.phone,
            telephone: updated.telephone,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
      ]);

      setPersonnel(current =>
        current.map(person =>
          person.id === user.id
            ? { ...person, ...updated }
            : person
        )
      );

      setUser(updated);
      setMessage({ type: 'success', text: 'Data diri berhasil diperbarui.' });
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: `Gagal memperbarui data diri: ${error.message}` });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async event => {
    event.preventDefault();

    if (!newPassword || !confirmPassword) {
      setMessage({ type: 'error', text: 'Password tidak boleh kosong.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Konfirmasi password tidak cocok.' });
      return;
    }

    setSavingPassword(true);

    try {
      if (!auth.currentUser) throw new Error('Sesi login tidak ditemukan.');

      await updatePassword(auth.currentUser, pinToFirebasePassword(newPassword));

      if (user?.profileUid) {
        await safeSetDoc(
          doc(db, 'profiles', user.profileUid),
          {
            mustChangePassword: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setMessage({ type: 'success', text: 'Password berhasil diperbarui.' });
      setNewPassword("");
      setConfirmPassword("");
      triggerPushNotification("Password Disimpan", "Password akun Anda berhasil diubah.");
    } catch (error) {
      console.error(error);
      setMessage({
        type: 'error',
        text:
          error?.code === 'auth/requires-recent-login'
            ? 'Silakan logout dan login kembali sebelum mengganti password.'
            : `Gagal mengganti password: ${error.message}`,
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <h2 className="mb-4 flex items-center text-xl font-bold sm:mb-6 sm:text-2xl">
        <Settings className="mr-2 h-5 w-5 text-gray-700 sm:h-6 sm:w-6" />
        Pengaturan Akun
      </h2>

      {message.text && (
        <div className={`mb-4 max-w-3xl rounded p-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        <form
          onSubmit={handleSaveProfile}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <h3 className="mb-4 border-b pb-2 text-base font-bold text-gray-800 sm:text-lg">
            Data Diri
          </h3>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Nama</span>
              <input
                value={profileForm.name}
                onChange={event => setProfileForm(current => ({ ...current, name: event.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Warga Jemaat</span>
              <select
                value={profileForm.wargaJemaat}
                onChange={event => setProfileForm(current => ({ ...current, wargaJemaat: event.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">- Pilih -</option>
                <option value="yes">Ya</option>
                <option value="no">Tidak</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
              <input
                type="email"
                value={profileForm.email}
                onChange={event => setProfileForm(current => ({ ...current, email: event.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">No. HP</span>
              <input
                value={profileForm.phone}
                onChange={event => setProfileForm(current => ({ ...current, phone: event.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">No. Telepon</span>
              <input
                value={profileForm.telephone}
                onChange={event => setProfileForm(current => ({ ...current, telephone: event.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <button
              disabled={savingProfile}
              className="flex w-full items-center justify-center rounded bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="mr-2 h-4 w-4" />
              {savingProfile ? 'Menyimpan...' : 'Simpan Data Diri'}
            </button>
          </div>
        </form>

        <form
          onSubmit={handleSavePassword}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <h3 className="mb-4 border-b pb-2 text-base font-bold text-gray-800 sm:text-lg">
            Ganti Password
          </h3>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Password Baru</span>
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                placeholder="Masukkan password baru"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Konfirmasi Password Baru
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="Ulangi password baru"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <button
              disabled={savingPassword}
              className="flex w-full items-center justify-center rounded bg-blue-600 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="mr-2 h-4 w-4" />
              {savingPassword ? 'Menyimpan...' : 'Simpan Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
const AdminDatabase = ({ personnel, setPersonnel, currentUser }) => {
  const [psvgGroups, setPsvgGroups] = useState([]);

  useEffect(() => {
    return onSnapshot(collection(db, 'groups'), snapshot => {
      const rows = snapshot.docs
        .map(row => {
          const data = row.data() || {};
          return {
            id: row.id,
            name: data.timName || data.groupName || data.name || row.id,
            type: String(data.type || '').toUpperCase(),
            status: data.status || 'active',
          };
        })
        .filter(row =>
          row.status !== 'inactive' &&
          ['CHOIR', 'PS', 'VG', 'VOCAL_GROUP', 'PADUAN_SUARA', 'PS_VG'].includes(row.type)
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'id'));
      setPsvgGroups(rows);
    }, error => console.error('Gagal memuat PS/VG dari database:', error));
  }, []);
  const emptyForm = {
    name: '', email: '', phone: '', wargaJemaat: '', status: 'active',
    unit: '', role: '', pelkatClass: '', multimediaAssignment: 'Semua Jam', password: '1234'
  };
  const [addForm, setAddForm] = useState(emptyForm);
  const [editingUser, setEditingUser] = useState(null);
  const [detailUser, setDetailUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSection, setActiveSection] = useState('ALL');
  const [multimediaRuleFilter, setMultimediaRuleFilter] = useState('ALL');
  const [showAddForm, setShowAddForm] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [masterUnits, setMasterUnits] = useState([]);
  const [masterRoles, setMasterRoles] = useState([]);
  const { showAlert, showConfirm } = useDialog();
  useEffect(() => {
    const unsubscribeUnits = onSnapshot(collection(db, 'units'), snapshot => {
      const rows = snapshot.docs
        .map(row => {
          const data = row.data() || {};
          const name = data.name || data.unitName || data.label || '';
          const legacy = normalizeLegacyPelkatUnit(name);

          // Unit kelas lama seperti PA-Batita/PT-Eka tidak ditampilkan.
          if (!name || legacy.inferredRole) return null;

          return {
            id: row.id,
            name,
            code: data.code || data.unitCode || row.id,
            status: data.status || 'active',
          };
        })
        .filter(Boolean)
        .filter(row => row.status !== 'inactive')
        .sort((a, b) => a.name.localeCompare(b.name, 'id'));

      setMasterUnits(rows);
    });

    const unsubscribeRoles = onSnapshot(collection(db, 'roles'), snapshot => {
      setMasterRoles(
        snapshot.docs
          .map(row => {
            const data = row.data() || {};
            return {
              id: row.id,
              name: data.name || data.roleName || data.label || '',
              unitId: data.unitId || '',
              unitName: data.unitName || data.unit || data.namaUnit || '',
              status: data.status || 'active',
            };
          })
          .filter(row => row.name && row.status !== 'inactive')
      );
    });

    return () => {
      unsubscribeUnits();
      unsubscribeRoles();
    };
  }, []);

  const isSuperAdmin = currentUser?.roles?.includes(ROLES.SUPERADMIN);
  const allMasterUnitNames = useMemo(() => {
    const firestoreNames = masterUnits.map(unit => unit.name);
    return Array.from(new Set([...firestoreNames, ...Object.values(UNITS)]))
      .filter(Boolean)
      .filter(name => !normalizeLegacyPelkatUnit(name).inferredRole)
      .sort((a, b) => a.localeCompare(b, 'id'));
  }, [masterUnits]);

  const adminUnitNames = isSuperAdmin
    ? allMasterUnitNames
    : [...new Set(currentUser?.units || [])];

  const canManageUnit = (unitName) =>
    isSuperAdmin || adminUnitNames.some(name => unitMatches(name, unitName));
  const isSystemAdminAccount = (person) => isAdminPersonnelRecord(person);

  const availableUnits = adminUnitNames;

  const rolesByUnit = useMemo(() => {
    const unitNameById = new Map(masterUnits.map(unit => [String(unit.id), unit.name]));
    const map = {};

    // Firestore menjadi sumber utama.
    masterRoles.forEach(role => {
      const parentUnit =
        role.unitName ||
        unitNameById.get(String(role.unitId || '')) ||
        '';

      if (!parentUnit) return;
      if (!map[parentUnit]) map[parentUnit] = [];
      if (!map[parentUnit].includes(role.name)) map[parentUnit].push(role.name);
    });

    // Fallback untuk data lama sebelum master selesai dimuat.
    Object.entries(UNIT_ROLE_OPTIONS).forEach(([unit, roles]) => {
      if (!map[unit]) map[unit] = [];
      (roles || []).forEach(role => {
        if (!map[unit].includes(role)) map[unit].push(role);
      });
    });

    Object.values(map).forEach(roles => roles.sort((a, b) => a.localeCompare(b, 'id')));
    return map;
  }, [masterUnits, masterRoles]);

  const roleUnitMap = useMemo(() => {
    const map = {};
    Object.entries(rolesByUnit).forEach(([unit, roles]) => {
      (roles || []).forEach(role => {
        if (!map[role]) map[role] = unit;
      });
    });
    return map;
  }, [rolesByUnit]);

  const prepareForSave = (person) => {
    const { unitMemberships, roleMemberships } = normalizeMemberships(person);
    const normalizedRoles = roleMemberships.map(role => {
      const parentUnit = role.unit || roleUnitMap[role.name] || '';
      const unit = unitMemberships.find(x => x.name === parentUnit);
      return { ...role, unit: parentUnit, status: unit?.status === 'inactive' ? 'inactive' : (role.status || 'active') };
    });
    return {
      ...person,
      unitMemberships,
      roleMemberships: normalizedRoles,
      units: unitMemberships.filter(x => x.status === 'active').map(x => x.name),
      roles: normalizedRoles.filter(x => x.status === 'active').map(x => x.name),
      unitStatuses: Object.fromEntries(unitMemberships.map(x => [x.name, x.status])),
      roleStatuses: Object.fromEntries(normalizedRoles.map(x => [x.name, x.status])),
    };
  };

  const deletePersonnel = async person => {
    if (!isSuperAdmin || !person?.id) return;

    const confirmed = await showConfirm(
      `Hapus petugas "${person.name}"?\n\nData user, unit, role, eligibility, relasi tim, dan login directory akan dihapus. Riwayat jadwal lama tetap disimpan.`
    );
    if (!confirmed) return;

    try {
      const collectionNames = [
        'userUnits',
        'userRoles',
        'eligibilities',
        'groupMembers',
      ];

      const snapshots = await Promise.all(
        collectionNames.map(name => getDocs(collection(db, name)))
      );

      const refsToDelete = [];

      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(row => {
          if (String(row.data()?.userId || '') === String(person.id)) {
            refsToDelete.push(row.ref);
          }
        });
      });

      refsToDelete.push(
        doc(db, 'users', person.id),
        doc(db, 'loginDirectory', person.id)
      );

      for (let index = 0; index < refsToDelete.length; index += 300) {
        const batch = writeBatch(db);
        refsToDelete.slice(index, index + 300).forEach(ref => batch.delete(ref));
        await batch.commit();
      }

      setPersonnel(current => current.filter(row => row.id !== person.id));
      sessionStorage.removeItem('gpibPersonnelCacheV9MasterRoleExact');
      await showAlert(`Petugas "${person.name}" berhasil dihapus.`);
    } catch (error) {
      console.error(error);
      await showAlert(`Gagal menghapus petugas: ${error.message}`);
    }
  };

  const beginEdit = (person) => {
    const prepared = prepareForSave(person);
    setEditingUser({
      ...prepared,
      wargaJemaat: prepared.wargaJemaat === true ? 'yes' : prepared.wargaJemaat === false ? 'no' : '',
      pendingUnit: '',
      pendingRoleByUnit: {},
      _originalStatus: prepared.status || 'active',
      _originalMultimediaAssignment: normalizeMultimediaAssignmentLabel(prepared.multimediaAssignment),
      _originalUnitMemberships: prepared.unitMemberships.map(item => ({ ...item })),
      _originalRoleMemberships: prepared.roleMemberships.map(item => ({ ...item })),
    });
  };

  const updateEdit = (patch) => setEditingUser(prev => ({ ...prev, ...patch }));

  const addUnitToEdit = () => {
    const unit = editingUser.pendingUnit;
    if (!unit || !canManageUnit(unit)) return;
    if ((editingUser.unitMemberships || []).some(x => x.name === unit)) return;
    updateEdit({
      unitMemberships: [...(editingUser.unitMemberships || []), { name: unit, status: 'active' }],
      pendingUnit: ''
    });
  };

  const toggleUnitStatus = (unitName) => {
    if (!canManageUnit(unitName)) return;
    const current = (editingUser.unitMemberships || []).find(x => x.name === unitName)?.status || 'active';
    const next = current === 'active' ? 'inactive' : 'active';
    updateEdit({
      unitMemberships: (editingUser.unitMemberships || []).map(x => x.name === unitName ? { ...x, status: next } : x),
      roleMemberships: (editingUser.roleMemberships || []).map(role => role.unit === unitName
        ? { ...role, status: next === 'inactive' ? 'inactive' : role.status }
        : role)
    });
  };

  const addRoleToEdit = (unitName) => {
    if (!canManageUnit(unitName)) return;
    const role = editingUser.pendingRoleByUnit?.[unitName];
    if (!role) return;
    if ((editingUser.roleMemberships || []).some(x => x.name === role && x.unit === unitName)) return;
    updateEdit({
      roleMemberships: [...(editingUser.roleMemberships || []), { name: role, unit: unitName, status: 'active' }],
      pendingRoleByUnit: { ...(editingUser.pendingRoleByUnit || {}), [unitName]: '' }
    });
  };

  const toggleRoleStatus = (roleName, unitName) => {
    if (!canManageUnit(unitName)) return;
    const unitIsActive = (editingUser.unitMemberships || []).find(x => x.name === unitName)?.status !== 'inactive';
    if (!unitIsActive) return;
    updateEdit({
      roleMemberships: (editingUser.roleMemberships || []).map(x => x.name === roleName && x.unit === unitName
        ? { ...x, status: x.status === 'active' ? 'inactive' : 'active' }
        : x)
    });
  };

  const removeMembershipUnit = async (unitName) => {
    if (!canManageUnit(unitName)) return;
    if (!await showConfirm(`Hapus unit ${unitName} beserta seluruh role di unit tersebut dari petugas ini?`)) return;
    updateEdit({
      unitMemberships: (editingUser.unitMemberships || []).filter(x => x.name !== unitName),
      roleMemberships: (editingUser.roleMemberships || []).filter(x => x.unit !== unitName),
    });
  };

  const removeMembershipRole = (roleName, unitName) => {
    if (!canManageUnit(unitName)) return;
    updateEdit({
    roleMemberships: (editingUser.roleMemberships || []).filter(x => !(x.name === roleName && x.unit === unitName))
    });
  };

  const saveEditedUser = async () => {
    const memberships = normalizeMemberships(editingUser);
    if (!memberships.unitMemberships.length) { await showAlert('Petugas minimal memiliki satu unit.'); return; }
    if (!memberships.roleMemberships.length) { await showAlert('Petugas minimal memiliki satu role.'); return; }

    // Edit dari menu Petugas hanya mengubah data penugasan.
    // Data pribadi (nama, email, nomor handphone, warga jemaat, dan password)
    // tetap dipertahankan dan nantinya dikelola oleh user melalui interface akun.
    let draft = { ...editingUser };
    if (!isSuperAdmin) {
      const allowed = new Set(adminUnitNames);
      const originalUnits = editingUser._originalUnitMemberships || [];
      const originalRoles = editingUser._originalRoleMemberships || [];
      draft = {
        ...draft,
        status: editingUser._originalStatus || 'active',
        multimediaAssignment: allowed.has(UNITS.MULTIMEDIA)
          ? editingUser.multimediaAssignment
          : editingUser._originalMultimediaAssignment,
        unitMemberships: [
          ...originalUnits.filter(item => !allowed.has(item.name)),
          ...(editingUser.unitMemberships || []).filter(item => allowed.has(item.name)),
        ],
        roleMemberships: [
          ...originalRoles.filter(item => !allowed.has(item.unit)),
          ...(editingUser.roleMemberships || []).filter(item => allowed.has(item.unit)),
        ],
      };
    }
    const saved = prepareForSave(draft);
    ['pendingUnit','pendingRoleByUnit','_originalStatus','_originalMultimediaAssignment','_originalUnitMemberships','_originalRoleMemberships'].forEach(key => delete saved[key]);

    setPersonnel(prev => prev.map(p => p.id === saved.id ? saved : p));
    setEditingUser(null);
    await showAlert('Data penugasan petugas berhasil diperbarui.');
  };

  const removeUser = async (id) => {
    if (await showConfirm('Hapus pengguna ini dari database?')) setPersonnel(prev => prev.filter(p => p.id !== id));
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    const { name, email, phone, unit, role, multimediaAssignment, password, wargaJemaat } = addForm;
    if (!name || !unit || !role || wargaJemaat === '') {
      await showAlert('Mohon lengkapi Nama, Warga Jemaat, Unit, dan Role.'); return;
    }
    if (!isValidEmail(email)) { await showAlert('Format email belum valid.'); return; }
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.replace(/\D/g, '').length < 9) { await showAlert('Nomor handphone minimal 9 digit.'); return; }
    const similarUsers = personnel.filter(p => !p.isTeam && isSimilarPersonnelName(p.name, name));
    if (similarUsers.length) {
      const names = similarUsers.slice(0, 5).map(p => `• ${p.name}`).join('\n');
      if (!await showConfirm(`Ditemukan nama yang sama atau mirip:\n${names}\n\nTetap tambah petugas baru?`)) return;
    }
    const duplicateContact = personnel.find(p => String(p.email || '').toLowerCase() === email.trim().toLowerCase() || normalizePhone(p.phone || '') === normalizedPhone);
    if (duplicateContact && !await showConfirm(`Email atau nomor handphone sudah dipakai oleh ${duplicateContact.name}. Tetap lanjut?`)) return;

    setIsCreatingUser(true);
    const personId = await getNextSequentialId('users', 'US', 4);
    const loginEmail = `${personId.toLowerCase()}@login.gpib.local`;
    let secondaryApp;
    try {
      secondaryApp = initializeApp(firebaseConfig, `create-user-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, loginEmail, pinToFirebasePassword(password || '1234'));
      await safeSetDoc(doc(db, 'profiles', credential.user.uid), {
        personId, displayName: name.trim(), loginEmail, contactEmail: email.trim().toLowerCase(), phone: normalizedPhone,
        appRole: 'USER', unitIds: [unit], mustChangePassword: true, status: 'active', wargaJemaat: wargaJemaat === 'yes'
      }, { merge: true });
      await safeSetDoc(doc(db, 'loginDirectory', personId), {
        name: name.trim(), loginEmail, contactEmail: email.trim().toLowerCase(), phone: normalizedPhone,
        units: [unit], unitNames: [unit],
        status: 'active', wargaJemaat: wargaJemaat === 'yes'
      }, { merge: true });
      const newUser = prepareForSave({
        id: personId, name: name.trim(), email: email.trim().toLowerCase(), phone: normalizedPhone, loginEmail,
        wargaJemaat: wargaJemaat === 'yes', status: 'active',
        unitMemberships: [{ name: unit, status: 'active' }],
        roleMemberships: [{ name: role, unit, status: 'active' }],
        ...(unit === UNITS.MULTIMEDIA ? { multimediaAssignment } : {}),
        password: password || '1234', assignments: 0
      });
      setPersonnel(prev => [...prev, newUser]);
      await signOut(secondaryAuth).catch(() => {});
      setAddForm(emptyForm); setShowAddForm(false);
      await showAlert('Petugas berhasil ditambahkan.');
    } catch (error) {
      console.error(error); await showAlert(`Gagal menambahkan petugas: ${error?.message || error}`);
    } finally {
      setIsCreatingUser(false); if (secondaryApp) await deleteApp(secondaryApp).catch(() => {});
    }
  };

  const databaseSections = [
    { id: 'ALL', label: 'All Petugas', unit: null },
    { id: 'PRESBITER', label: 'Presbiter', unit: UNITS.PRESBITER }, { id: 'MUGER', label: 'Muger', unit: UNITS.MUGER },
    { id: 'MULTIMEDIA', label: 'Multimedia', unit: UNITS.MULTIMEDIA }, { id: 'GP', label: 'GP', unit: UNITS.GP },
    { id: 'PA', label: 'PA', unit: UNITS.PA }, { id: 'PT', label: 'PT', unit: UNITS.PT },
    { id: 'SOUND', label: 'Sound', unit: UNITS.SOUND }, { id: 'PENDETA', label: 'Pendeta', unit: UNITS.PENDETA },
    { id: 'CHOIR', label: 'PS / Choir', unit: UNITS.PS },
  ];
  const selectedSection = databaseSections.find(section => section.id === activeSection);
  const filteredPersonnel = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return personnel
      .filter(p => !isSystemAdminAccount(p))
      .filter(p => {
        const { unitMemberships, roleMemberships } = normalizeMemberships(p);

        const sectionMatch =
          activeSection === 'ALL' ||

          (
            activeSection === 'CHOIR' &&
            roleMemberships.some(role =>
              String(role?.status || 'active').toLowerCase() !== 'inactive' &&
              genericRoleMatches(role?.name, ROLES.PS_CHOIR)
            )
          ) ||

          (
            activeSection !== 'CHOIR' &&
            unitMemberships.some(unit =>
              String(unit?.status || 'active').toLowerCase() !== 'inactive' &&
              unitMatches(unit?.name, selectedSection?.unit)
            )
          );

        const multimediaRuleMatch =
          activeSection !== 'MULTIMEDIA' ||
          multimediaRuleFilter === 'ALL' ||
          getMultimediaRuleCode(p.multimediaAssignment) === multimediaRuleFilter;

        return sectionMatch && multimediaRuleMatch;
      })
      .filter(p =>
        !q ||
        [
          p.name,
          p.email,
          p.phone,
          ...normalizeMemberships(p).unitMemberships.map(x => x.name),
          ...normalizeMemberships(p).roleMemberships.map(x => x.name),
          getMultimediaRuleLabel(p.multimediaAssignment),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'id')
      );
  }, [
    personnel,
    activeSection,
    selectedSection?.unit,
    searchTerm,
    multimediaRuleFilter,
  ]);

  const similarNameMatches = useMemo(() =>
    addForm.name.trim()
      ? personnel
          .filter(p => !p.isTeam && !isSystemAdminAccount(p) && isSimilarPersonnelName(p.name, addForm.name))
          .slice(0,5)
      : [],
    [personnel, addForm.name]
  );

  const StatusBadge = ({ status }) => <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${status === 'inactive' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>{status === 'inactive' ? 'Nonaktif' : 'Aktif'}</span>;

  return <div className="p-4 sm:p-6 relative">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
      <div><h2 className="text-xl sm:text-2xl font-bold">Petugas</h2><p className="text-sm text-gray-500 mt-1">Kelola data, unit, role, dan status pelayanan petugas.</p></div>
      <button onClick={()=>setShowAddForm(true)} className="inline-flex items-center justify-center bg-blue-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-blue-700 shadow-sm"><Plus className="w-4 h-4 mr-2"/> Add Petugas</button>
    </div>

    {detailUser && (() => { const m = normalizeMemberships(detailUser); return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"><div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
      <div className="flex justify-between border-b pb-3 mb-4"><div><h3 className="font-bold text-xl">{detailUser.name}</h3><p className="text-xs text-gray-500">Detail Petugas</p></div><button onClick={()=>setDetailUser(null)}><X className="w-6 h-6"/></button></div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm mb-5"><div><span className="text-xs text-gray-400">Email</span><div className="font-medium">{detailUser.email || '-'}</div></div><div><span className="text-xs text-gray-400">No. Handphone</span><div className="font-medium">{detailUser.phone || '-'}</div></div><div><span className="text-xs text-gray-400">Warga Jemaat</span><div className="font-medium">{detailUser.wargaJemaat === true ? 'Ya' : detailUser.wargaJemaat === false ? 'Tidak' : '-'}</div></div><div><span className="text-xs text-gray-400">Status Akun</span><div><StatusBadge status={detailUser.status}/></div></div></div>
      <div className="space-y-4">{m.unitMemberships.map(unit => <div key={unit.name} className="border rounded-lg p-3"><div className="flex justify-between"><strong>{unit.name}</strong><StatusBadge status={unit.status}/></div><div className="mt-2 flex flex-wrap gap-2">{m.roleMemberships.filter(r=>r.unit===unit.name).map((r, roleIndex)=><span key={`${unit.name}-${r.name}-${roleIndex}`} className="px-2 py-1 bg-blue-50 rounded text-xs">{r.name} · {r.status === 'inactive' ? 'Nonaktif' : 'Aktif'}</span>)}</div></div>)}</div>
      {(detailUser.unitMemberships || detailUser.units || []).some(x => (x.name || x) === UNITS.MULTIMEDIA) && <div className="mt-4 p-3 bg-cyan-50 rounded text-sm"><strong>Penugasan Multimedia:</strong> {normalizeMultimediaAssignmentLabel(detailUser.multimediaAssignment)}</div>}
      {(() => {
        const classLabels = Object.entries(PELKAT_CLASS_ROLE_MAP)
          .filter(([classId]) => servesPelkatClass(detailUser, classId))
          .map(([, config]) => config.role);

        return classLabels.length > 0 ? (
          <div className="mt-4 rounded bg-amber-50 p-3 text-sm">
            <strong>Role Pelkat:</strong> {classLabels.join(', ')}
          </div>
        ) : null;
      })()}
      <div className="mt-4 grid sm:grid-cols-2 gap-3"><div className="border rounded-lg p-3"><div className="text-xs text-gray-400 mb-2">Tim Musik</div><div className="flex flex-wrap gap-2">{(detailUser.musicTeams || []).length ? detailUser.musicTeams.map(team=><span key={team.id || team.name} className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs">{team.name}</span>) : <span className="text-sm text-gray-400">-</span>}</div></div><div className="border rounded-lg p-3"><div className="text-xs text-gray-400 mb-2">Kolaborasi / Tandeman</div><div className="flex flex-wrap gap-2">{(detailUser.collaborations || []).length ? detailUser.collaborations.map(item=><span key={item.id || item.name} className="px-2 py-1 bg-pink-50 text-pink-700 rounded text-xs">{item.name}</span>) : <span className="text-sm text-gray-400">-</span>}</div></div></div>
    </div></div>; })()}

    {editingUser && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3"><div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[94vh] overflow-y-auto p-5 sm:p-6">
      <div className="flex justify-between border-b pb-3 mb-5"><div><h3 className="font-bold text-xl">Edit Penugasan</h3><p className="text-xs text-gray-500">Kelola status petugas, unit pelayanan, role, dan ketentuan penugasan.</p></div><button onClick={()=>setEditingUser(null)}><X className="w-6 h-6"/></button></div>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border bg-gray-50 p-3"><div className="text-xs text-gray-500">Petugas</div><div className="font-semibold text-gray-900">{editingUser.name}</div><div className="text-xs text-gray-500 mt-1">Data pribadi dikelola oleh user melalui Pengaturan Akun.</div></div>
        <div><label className="text-xs font-medium">Status Petugas</label><select disabled={!isSuperAdmin} value={editingUser.status || 'active'} onChange={e=>updateEdit({status:e.target.value})} className="w-full border rounded p-2 text-sm mt-1 disabled:bg-gray-100 disabled:text-gray-500"><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select><p className="text-[11px] text-gray-500 mt-1">Jika nonaktif, petugas tidak digunakan dalam penjadwalan.</p></div>
        {(editingUser.unitMemberships || []).some(x=>x.name===UNITS.MULTIMEDIA) && <div className="sm:col-span-2"><label className="text-xs font-medium">Ketentuan Penugasan Multimedia</label><select disabled={!canManageUnit(UNITS.MULTIMEDIA)} value={normalizeMultimediaAssignmentLabel(editingUser.multimediaAssignment)} onChange={e=>updateEdit({multimediaAssignment:e.target.value})} className="w-full border rounded p-2 text-sm mt-1 disabled:bg-gray-100 disabled:text-gray-500">{MULTIMEDIA_ASSIGNMENT_OPTIONS.map(x=><option key={x}>{x}</option>)}</select></div>}
      </div>
      <div className="border rounded-xl overflow-hidden mb-5"><div className="bg-gray-50 p-4 border-b flex flex-col sm:flex-row gap-2"><select value={editingUser.pendingUnit || ''} onChange={e=>updateEdit({pendingUnit:e.target.value})} className="flex-1 border rounded p-2 text-sm"><option value="">- Tambah Unit -</option>{availableUnits.filter(u=>!(editingUser.unitMemberships||[]).some(x=>x.name===u)).map(u=><option key={u}>{u}</option>)}</select><button onClick={addUnitToEdit} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-bold"><Plus className="inline w-4 h-4 mr-1"/> Tambah Unit</button></div>
        <div className="divide-y">{(editingUser.unitMemberships || []).map(unit => <div key={unit.name} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div className="flex items-center gap-2"><strong>{unit.name}</strong><StatusBadge status={unit.status}/></div><div className="flex gap-2"><button disabled={!canManageUnit(unit.name)} onClick={()=>toggleUnitStatus(unit.name)} className={`px-3 py-1 rounded text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed ${unit.status==='active'?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}`}>{unit.status==='active'?'Nonaktifkan Unit':'Aktifkan Unit'}</button><button disabled={!canManageUnit(unit.name)} onClick={()=>removeMembershipUnit(unit.name)} className="text-red-500 p-1 disabled:text-gray-300 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4"/></button></div></div>
          {unit.status==='inactive' && <div className="mb-3 text-xs text-amber-700 bg-amber-50 p-2 rounded">Unit nonaktif: seluruh role di unit ini otomatis nonaktif.</div>}
          <div className="space-y-2">{(editingUser.roleMemberships || []).filter(r=>r.unit===unit.name).map((role, roleIndex)=><div key={`${unit.name}-${role.name}-${roleIndex}`} className="flex items-center justify-between border rounded p-2"><div className="flex items-center gap-2 text-sm"><span>{role.name}</span><StatusBadge status={role.status}/></div><div className="flex gap-2"><button disabled={unit.status==='inactive' || !canManageUnit(unit.name)} onClick={()=>toggleRoleStatus(role.name, unit.name)} className="text-xs px-2 py-1 border rounded disabled:opacity-40">{role.status==='active'?'Nonaktifkan':'Aktifkan'}</button><button disabled={!canManageUnit(unit.name)} onClick={()=>removeMembershipRole(role.name,unit.name)} className="text-red-500 disabled:text-gray-300 disabled:cursor-not-allowed"><X className="w-4 h-4"/></button></div></div>)}</div>
          {canManageUnit(unit.name) && <div className="flex gap-2 mt-3"><select value={editingUser.pendingRoleByUnit?.[unit.name] || ''} onChange={e=>updateEdit({pendingRoleByUnit:{...(editingUser.pendingRoleByUnit||{}),[unit.name]:e.target.value}})} className="flex-1 border rounded p-2 text-sm"><option value="">- Tambah Role {unit.name} -</option>{(rolesByUnit[unit.name] || []).filter(r=>!(editingUser.roleMemberships||[]).some(x=>x.name===r&&x.unit===unit.name)).map(r=><option key={r}>{r}</option>)}</select><button onClick={()=>addRoleToEdit(unit.name)} className="px-3 py-2 border border-blue-600 text-blue-600 rounded text-sm"><Plus className="w-4 h-4"/></button></div>}
        </div>)}</div>
      </div>
      <div className="flex justify-end gap-3"><button onClick={()=>setEditingUser(null)} className="px-5 py-2 border rounded">Batal</button><button onClick={saveEditedUser} className="px-5 py-2 bg-blue-600 text-white rounded font-bold"><Save className="inline w-4 h-4 mr-2"/>Simpan Perubahan</button></div>
    </div></div>}

    {showAddForm && <div className="bg-white p-4 sm:p-6 rounded-xl shadow border border-blue-200 mb-6"><div className="flex justify-between mb-4"><div><h3 className="font-bold">Tambah Petugas Baru</h3><p className="text-xs text-gray-500">Data kontak dan informasi pelayanan.</p></div><button onClick={()=>setShowAddForm(false)}><X className="w-5 h-5"/></button></div>
      <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
        <div><label className="text-xs font-medium">Nama Lengkap</label><input value={addForm.name} onChange={e=>setAddForm({...addForm,name:e.target.value})} className={`w-full border rounded p-2 text-sm ${similarNameMatches.length?'border-amber-400':''}`}/>{similarNameMatches.length>0&&<div className="text-[11px] text-amber-700 mt-1">Nama serupa: {similarNameMatches.map(x=>x.name).join(', ')}</div>}</div>
        <div><label className="text-xs font-medium">Email</label><input type="email" value={addForm.email} onChange={e=>setAddForm({...addForm,email:e.target.value})} className="w-full border rounded p-2 text-sm"/></div>
        <div><label className="text-xs font-medium">No. Handphone</label><input value={addForm.phone} onChange={e=>setAddForm({...addForm,phone:e.target.value})} className="w-full border rounded p-2 text-sm"/></div>
        <div><label className="text-xs font-medium">Warga Jemaat</label><select value={addForm.wargaJemaat} onChange={e=>setAddForm({...addForm,wargaJemaat:e.target.value})} className="w-full border rounded p-2 text-sm"><option value="">- Pilih -</option><option value="yes">Ya</option><option value="no">Tidak</option></select></div>
        <div><label className="text-xs font-medium">Unit Pelayanan</label><select value={addForm.unit} onChange={e=>setAddForm({...addForm,unit:e.target.value,role:'',multimediaAssignment:'Semua Jam'})} className="w-full border rounded p-2 text-sm"><option value="">- Pilih Unit -</option>{availableUnits.map(u=><option key={u}>{u}</option>)}</select></div>
        {addForm.unit===UNITS.MULTIMEDIA&&<div><label className="text-xs font-medium">Ketentuan Penugasan Multimedia</label><select value={addForm.multimediaAssignment} onChange={e=>setAddForm({...addForm,multimediaAssignment:e.target.value})} className="w-full border rounded p-2 text-sm">{MULTIMEDIA_ASSIGNMENT_OPTIONS.map(x=><option key={x}>{x}</option>)}</select></div>}
        <div><label className="text-xs font-medium">Role</label><select value={addForm.role} onChange={e=>setAddForm({...addForm,role:e.target.value})} className="w-full border rounded p-2 text-sm"><option value="">- Pilih Role -</option>{(rolesByUnit[addForm.unit] || []).map(r=><option key={r}>{r}</option>)}</select></div>
        <div><label className="text-xs font-medium">Password Awal</label><input value={addForm.password} onChange={e=>setAddForm({...addForm,password:e.target.value})} className="w-full border rounded p-2 text-sm"/></div>
        <button disabled={isCreatingUser} className="bg-blue-600 text-white rounded p-2 text-sm font-bold disabled:bg-blue-300"><Plus className="inline w-4 h-4 mr-1"/>{isCreatingUser?'Menyimpan...':'Tambah Petugas'}</button>
      </form></div>}

    <div className="bg-white rounded-xl shadow border mb-4 overflow-hidden"><div className="p-4 border-b bg-gray-50 flex flex-col lg:flex-row gap-3 justify-between"><div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center"><div className="relative w-full lg:max-w-md"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari nama, unit, role..."/></div>{activeSection === 'MULTIMEDIA' && <select value={multimediaRuleFilter} onChange={e=>setMultimediaRuleFilter(e.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 text-sm lg:w-auto"><option value="ALL">Semua Ketentuan</option>{Object.entries(MULTIMEDIA_RULE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</div><div className="text-xs text-gray-500">
  <strong>{filteredPersonnel.length}</strong>
  {activeSection === 'CHOIR' ? ' PS/VG' : ' petugas'}
</div></div><div className="flex gap-2 overflow-x-auto p-3 border-b">{databaseSections.map(section=>{
  const count = personnel
    .filter(p => !isSystemAdminAccount(p))
    .filter(p => {
      const { unitMemberships, roleMemberships } = normalizeMemberships(p); 

      if (section.id === 'ALL') return true;  

      if (section.id === 'CHOIR') {
        return roleMemberships.some(role =>
          String(role?.status || 'active').toLowerCase() !== 'inactive' &&
          genericRoleMatches(role?.name, ROLES.PS_CHOIR)
        );
      } 

      return unitMemberships.some(unit =>
        String(unit?.status || 'active').toLowerCase() !== 'inactive' &&
        unitMatches(unit?.name, section.unit)
      );
    })
    .length;

  return <button
    key={section.id}
    onClick={()=>setActiveSection(section.id)}
    className={`whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold border ${activeSection===section.id?'bg-blue-600 text-white':'bg-white text-gray-600'}`}
  >
    {section.label} ({count})
  </button>;
})}</div></div>

    {(
      <div className="overflow-x-auto rounded bg-white shadow">
        <table className="min-w-full divide-y text-xs sm:text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left uppercase">Nama</th>
              {activeSection === 'MUGER' && (
                <th className="px-4 py-3 text-left uppercase">Warga Jemaat</th>
              )}
              <th className="px-4 py-3 text-left uppercase">Unit</th>
              <th className="px-4 py-3 text-left uppercase">Role</th>
              <th className="px-4 py-3 text-left uppercase">Status</th>
              {activeSection === 'MULTIMEDIA' && (
                <th className="px-4 py-3 text-left uppercase">Ketentuan</th>
              )}
              <th className="px-4 py-3 text-right uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredPersonnel.map(p => {
              const m = normalizeMemberships(p);
              const canManage =
                isSuperAdmin ||
                (
                  currentUser?.roles?.includes(ROLES.ADMIN_UNIT) &&
                  m.unitMemberships.some(x =>
                    (currentUser.units || []).some(unit => unitMatches(unit, x.name))
                  )
                );

              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{p.name}</td>
                  {activeSection === 'MUGER' && (
                    <td className="px-4 py-3">
                      {p.wargaJemaat === true
                        ? 'Ya'
                        : p.wargaJemaat === false
                          ? 'Tidak'
                          : '-'}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.unitMemberships.map(x => (
                        <span
                          key={x.name}
                          className={`rounded px-2 py-0.5 text-[10px] ${
                            x.status === 'inactive'
                              ? 'bg-gray-100 text-gray-400 line-through'
                              : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {x.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.roleMemberships.map((x, roleIndex) => (
                        <span
                          key={`${x.unit}-${x.name}-${roleIndex}`}
                          className={`rounded px-2 py-0.5 text-[10px] ${
                            x.status === 'inactive'
                              ? 'bg-gray-100 text-gray-400 line-through'
                              : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {x.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status}/></td>
                  {activeSection === 'MULTIMEDIA' && (
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                        {getMultimediaRuleLabel(p.multimediaAssignment)}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => setDetailUser(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                        title="Lihat seluruh detail petugas"
                      >
                        <Eye className="h-4 w-4" /> View
                      </button>
                      {canManage ? (
                        <button
                          onClick={() => beginEdit(p)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-blue-600 hover:bg-blue-50"
                          title="Edit penugasan"
                        >
                          <Edit3 className="h-4 w-4" /> Edit
                        </button>
                      ) : (
                        <Lock className="h-4 w-4 text-gray-300" />
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => deletePersonnel(p)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50"
                          title="Hapus petugas"
                        >
                          <Trash2 className="h-4 w-4" /> Hapus
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filteredPersonnel.length && (
              <tr>
                <td
                  colSpan={activeSection === 'MUGER' || activeSection === 'MULTIMEDIA' ? 6 : 5}
                  className="p-12 text-center text-gray-400"
                >
                  Tidak ada petugas yang cocok dengan filter atau pencarian.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )}
  </div>;
};

const MugerTeamDirectory = ({ personnel, setPersonnel, currentUser }) => {
  const { showAlert, showConfirm } = useDialog();
  return <MugerManager db={db} personnel={personnel} currentUser={currentUser} normalizeMemberships={normalizeMemberships} mugerUnitName={UNITS.MUGER} showAlert={showAlert} showConfirm={showConfirm} />;
};

const StatusPill = ({ status }) => <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${status==='inactive'?'bg-gray-100 text-gray-500':'bg-green-100 text-green-700'}`}>{status==='inactive'?'Nonaktif':'Aktif'}</span>;

const isPastCutoff = (dateStr, units = []) => {
  const taskDate = new Date(dateStr);
  const cutoffDate = new Date(taskDate);
  const isPelkat = units.includes(UNITS.PA) || units.includes(UNITS.PT);
  const daysToSubtract = isPelkat ? 4 : 2;
  cutoffDate.setDate(cutoffDate.getDate() - daysToSubtract);
  cutoffDate.setHours(23, 59, 59, 999);
  const today = new Date();
  return today > cutoffDate;
};

const getSwapTaskRequirement = (task) => {
  const path = task?.path || {};
  const category = String(path.category || '');
  const key = String(path.key || '');
  const catId = String(path.catId || '');

  if (category === 'services') {
    if (/^mm_slide$/i.test(key)) return { unit: UNITS.MULTIMEDIA, roles: [ROLES.MM_SLIDE], label: ROLES.MM_SLIDE };
    if (/^mm_cam\d*$/i.test(key)) return { unit: UNITS.MULTIMEDIA, roles: [ROLES.MM_CAM], label: ROLES.MM_CAM };
    if (/^mm_switch$/i.test(key)) return { unit: UNITS.MULTIMEDIA, roles: [ROLES.MM_SWITCH], label: ROLES.MM_SWITCH };
    if (/^mm_pic$/i.test(key)) return { unit: UNITS.MULTIMEDIA, roles: [ROLES.MM_PIC], label: ROLES.MM_PIC };
    if (/^sound\d*$/i.test(key)) return { unit: UNITS.SOUND, roles: [ROLES.SOUND_OPS], label: ROLES.SOUND_OPS };
    if (/^ps_pemandu\d*$/i.test(key)) return { unit: UNITS.MUGER, roles: [ROLES.PS_PEMANDU], label: ROLES.PS_PEMANDU };
    if (/^ps_organis$/i.test(key)) return { unit: UNITS.MUGER, roles: [ROLES.PS_ORGANIS, ROLES.PS_PEMUSIK], label: ROLES.PS_ORGANIS };
    if (/^ps_pemusik\d*$/i.test(key)) return { unit: UNITS.MUGER, roles: [ROLES.PS_PEMUSIK], label: ROLES.PS_PEMUSIK };
    if (/^ps_tim_musik$/i.test(key)) return { unit: UNITS.MUGER, roles: [ROLES.PS_TIM_MUSIK], label: ROLES.PS_TIM_MUSIK, teamOnly: true };
    if (/^ps_vg\d+_name$/i.test(key)) return { unit: UNITS.PS, roles: [ROLES.PS_CHOIR], label: ROLES.PS_CHOIR, teamOnly: true };
    if (/^p1$/i.test(key)) return { unit: UNITS.PRESBITER, roles: [ROLES.PENATUA, ROLES.DIAKEN], label: 'Presbiter/PIC' };
    if (/^p[23]$/i.test(key)) return { unit: UNITS.PRESBITER, roles: [ROLES.PENATUA], label: ROLES.PENATUA };
    if (/^p4$/i.test(key)) return { unit: UNITS.PRESBITER, roles: [ROLES.PENATUA, ROLES.DIAKEN], label: 'Presbiter' };
    if (/^p5$/i.test(key)) return { unit: UNITS.PRESBITER, roles: [ROLES.DIAKEN], label: ROLES.DIAKEN };
  }

  if (category === 'pa' || category === 'pt') {
    const classRequirement = PELKAT_CLASS_ROLE_MAP[normalizePelkatClassId(catId)];
    const unit = classRequirement?.unit || (category === 'pa' ? UNITS.PA : UNITS.PT);
    if (/cerita/i.test(key)) return { unit, roles: [ROLES.PEMBAWA_CERITA], label: ROLES.PEMBAWA_CERITA };
    if (/pemandu/i.test(key)) return { unit, roles: [ROLES.PL_PELKAT], label: ROLES.PL_PELKAT };
    if (/^kl_/i.test(key)) return { unit, roles: [ROLES.KAKAK_LAYAN], label: ROLES.KAKAK_LAYAN };
    return { unit, roles: classRequirement?.role ? [classRequirement.role] : [], label: classRequirement?.role || unit };
  }

  if (category === 'presbiterPendamping') return { unit: UNITS.PRESBITER, roles: [ROLES.PENATUA, ROLES.DIAKEN], label: 'Presbiter Pendamping' };
  if (category === 'pendetaPendamping') return { unit: UNITS.PENDETA, roles: [ROLES.PENDETA], label: ROLES.PENDETA };
  if (category === 'pemimpinPersiapan') {
    const unit = catId === 'pt' ? UNITS.PT : UNITS.PA;
    return { unit, roles: [ROLES.KAKAK_LAYAN], label: 'Pemimpin Persiapan' };
  }

  return { unit: '', roles: [], label: task?.position || 'role yang sama' };
};

const isEligibleSwapReplacement = (person, requirement) => {
  if (!person || !requirement) return false;
  if (requirement.teamOnly) return Boolean(person.isTeam);
  if (person.isTeam) return false;
  const unitOk = !requirement.unit || hasActiveUnit(person, requirement.unit);
  const roleOk = !requirement.roles?.length || requirement.roles.some(role => hasActiveRole(person, role, requirement.unit));
  return unitOk && roleOk;
};

const ShiftSwap = ({ user, assignments, setAssignments, personnel, swapRequests, setSwapRequests, customServices }) => {
  const stats = calculateDetailedStats(personnel, assignments, swapRequests, customServices);
  const myStats = stats[user?.id] || { details: [], byPosition: {}, byTime: {}, swapsRequested: 0, swapsAccepted: 0 };
  const myFutureTasks = myStats.details.filter(d => new Date(d.date) >= new Date());
  const incomingRequests = swapRequests.filter(req => req.targetUserId === user?.id && req.status === 'pending');
  const [selectedTask, setSelectedTask] = useState(null);
  const [targetUser, setTargetUser] = useState("");
  const [activeTab, setActiveTab] = useState('cari');
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const [sortOrder, setSortOrder] = useState('asc'); 
  const { showAlert, showPrompt } = useDialog();
  const sortedTasks = useMemo(() => {
    return [...myFutureTasks].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      const timeA = a.time || "";
      const timeB = b.time || "";
      return sortOrder === 'asc' ? timeA.localeCompare(timeB) : timeB.localeCompare(timeA);
    });
  }, [myFutureTasks, sortOrder]);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });
  const selectedRequirement = useMemo(
    () => getSwapTaskRequirement(selectedTask),
    [selectedTask]
  );
  const teamCandidates = useMemo(() => {
    const teams = new Map();
    personnel.filter(person => !person.isTeam).forEach(person => {
      (person.musicTeams || []).forEach(team => {
        if (String(team.status || 'active').toLowerCase() === 'inactive') return;
        const id = String(team.id || '');
        if (!id) return;
        if (!teams.has(id)) teams.set(id, {
          id,
          name: team.name || id,
          isTeam: true,
          leaderId: String(team.leaderId || ''),
          memberIds: [],
          units: [UNITS.MUGER],
          roles: [ROLES.PS_TIM_MUSIK],
        });
        teams.get(id).memberIds.push(String(person.id));
        if (!teams.get(id).leaderId && normalizeRoleToken(team.memberRole) === normalizeRoleToken('Koordinator')) {
          teams.get(id).leaderId = String(person.id);
        }
      });
    });
    return [...teams.values()].map(team => ({ ...team, memberIds: [...new Set(team.memberIds)] }));
  }, [personnel]);

  const selectedTeamId = selectedTask?.team?.id ? String(selectedTask.team.id) : '';
  const selectedTeam = useMemo(
    () => teamCandidates.find(team => String(team.id) === selectedTeamId) || null,
    [teamCandidates, selectedTeamId]
  );
  const canRequestSelectedTask = !selectedTeam || String(selectedTeam.leaderId || '') === String(user?.id || '');

  const availableReplacements = useMemo(() => {
    if (!selectedTask || !canRequestSelectedTask) return [];

    const taskDate = String(selectedTask.date || '');
    const taskTime = String(selectedTask.time || '');

    const source = selectedRequirement?.teamOnly ? teamCandidates : personnel;

    return source
      .filter(person => String(person.id) !== String(user?.id))
      .filter(person => !selectedTeamId || String(person.id) !== selectedTeamId)
      .filter(person => isEligibleSwapReplacement(person, selectedRequirement))
      .filter(person => !person.isTeam || Boolean(person.leaderId))
      .filter(person => {
        const memberIds = person.isTeam ? (person.memberIds || []).map(String) : [String(person.id)];
        return !memberIds.some(memberId =>
          (stats[memberId]?.details || []).some(detail =>
            String(detail.date || '') === taskDate &&
            (!taskTime || !detail.time || String(detail.time) === taskTime)
          )
        );
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'));
  }, [personnel, teamCandidates, user?.id, selectedTask, selectedRequirement, stats, canRequestSelectedTask, selectedTeamId]);
  const filteredReplacements = useMemo(() => {
    if (!searchTerm) return availableReplacements;
    return availableReplacements.filter(p => (p.name || "").toLowerCase().includes(searchTerm.toLowerCase()));
  }, [searchTerm, availableReplacements]);
  const handleSelectReplacement = (p) => {
    setTargetUser(p.id);
    setSearchTerm(p.name);
    setShowDropdown(false);
  };
  const getCutoffDayName = (dateStr) => {
    const cDate = new Date(dateStr);
    const isPelkat = (user.units || []).includes(UNITS.PA) || (user.units || []).includes(UNITS.PT);
    const daysToSubtract = isPelkat ? 4 : 2;
    cDate.setDate(cDate.getDate() - daysToSubtract);
    return cDate.toLocaleDateString('id-ID', { weekday: 'long' });
  };
  const handleRequestSwap = async () => {
    if (!selectedTask || !targetUser) return await showAlert("Pilih tugas dan nama pengganti.");
    if (!canRequestSelectedTask) return await showAlert('Hanya Koordinator Tim Musik yang dapat menukar jadwal satu tim.');
    if (isPastCutoff(selectedTask.date, user.units || [])) {
      const isPelkat = (user.units || []).includes(UNITS.PA) || (user.units || []).includes(UNITS.PT);
      await showAlert(`Batas waktu pertukaran (H-${isPelkat ? '4' : '2'}) telah lewat. Anda tidak bisa lagi bertukar jadwal ini.`);
      return;
    }
    const targetPerson = personnel.find(p => p.id === targetUser);
    const extraMsg = await showPrompt(`Anda akan meminta ${targetPerson?.name || 'Rekan'} untuk menggantikan tugas Anda.\nBeri pesan tambahan untuk dikirim via WhatsApp (opsional):`);
    if (extraMsg === null) return; 
    setSwapRequests([...swapRequests, {
      id: Date.now().toString(),
      requesterId: user.id,
      targetUserId: targetPerson?.isTeam ? (targetPerson.leaderId || '') : targetUser,
      requesterTeamId: selectedTask.team?.id || null,
      targetTeamId: targetPerson?.isTeam ? targetPerson.id : null,
      swapType: targetPerson?.isTeam ? 'TEAM' : 'PERSON',
      date: selectedTask.date,
      label: selectedTask.label,
      path: selectedTask.path,
      status: 'pending'
    }]);
    triggerPushNotification("Permintaan Terkirim", "Permintaan tukar jadwal Anda telah dikirimkan ke rekan.");
    const dateStr = formatDateIndo(selectedTask.date);
    let waText = `Halo ${targetPerson?.name || 'Rekan'}, \n\nBolehkah saya minta tolong untuk menggantikan tugas saya sebagai *${selectedTask.label}* pada hari/tanggal *${dateStr}*?`;
    if (extraMsg.trim() !== "") waText += `\n\nCatatan: ${extraMsg}`;
    waText += `\n\nMohon konfirmasinya melalui aplikasi. Terima kasih sebelumnya.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
    
    setSelectedTask(null);
    setTargetUser("");
    setSearchTerm("");
  };
  const handleAccept = async (req) => {
    const requester = personnel.find(p => p.id === req.requesterId);
    const extraMsg = await showPrompt(`Anda akan MENERIMA permintaan dari ${requester?.name || 'Rekan'}.\nBeri pesan tambahan untuk dikirim via WhatsApp (opsional):`);
    if (extraMsg === null) return;
    try {
      await setAssignments(prev => {
        const next = structuredClone(prev || {});
        const { category, catId, key } = req.path || {};
        const slot = next?.[req.date]?.[category]?.[catId]?.[key];

        if (!slot) {
          throw new Error('Data penugasan tidak ditemukan. Muat ulang halaman lalu coba kembali.');
        }

        slot.userId = req.targetTeamId || user.id;
        return next;
      });

      // Status baru diubah setelah assignment benar-benar tersimpan.
      await setSwapRequests(prev => prev.map(r =>
        r.id === req.id ? { ...r, status: 'accepted' } : r
      ));
      triggerPushNotification("Tugas Diterima", "Anda telah menerima tugas pengganti jadwal.");
    } catch (error) {
      console.error('Gagal menerima tukar jadwal:', error);
      await showAlert(error?.message || 'Perubahan jadwal gagal disimpan.');
      return;
    }
    const dateStr = formatDateIndo(req.date);
    let waText = `Halo ${requester?.name || 'Rekan'}, \n\nSaya *bersedia menggantikan tugas *${req.label}* pada tanggal *${dateStr}*.`;
    if (extraMsg.trim() !== "") waText += `\n\nCatatan: ${extraMsg}`;
    waText += `\n\nTerima kasih.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
  };
  const handleReject = async (req) => {
    const requester = personnel.find(p => p.id === req.requesterId);
    const reason = await showPrompt(`Anda akan menolak permintaan dari ${requester?.name || 'Rekan'}.\nBeri pesan/alasan penolakan (opsional):`);
    if (reason === null) return;
    
    setSwapRequests(prev => prev.map(r => r.id === req.id ? {...r, status: 'rejected'} : r));
    
    const dateStr = formatDateIndo(req.date);
    let waText = `Halo ${requester?.name || 'Rekan'},\n\nMaaf saya tidak bisa menggantikan tugas *${req.label}* pada tanggal *${dateStr}*.`;
    if (reason.trim() !== "") waText += `\nAlasan: ${reason}`;
    waText += `\n\nTerima kasih.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank');
    await showAlert("Permintaan pertukaran jadwal telah ditolak.");
  };
  return (
    <div className="p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 flex items-center"><RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-purple-600"/> Tukar Jadwal</h2>
      
      <div className="flex gap-4 mb-4 sm:mb-6 border-b pb-2 overflow-x-auto text-sm sm:text-base">
        <button onClick={() => setActiveTab('cari')} className={`font-bold pb-2 whitespace-nowrap ${activeTab === 'cari' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}>Cari Pengganti</button>
        <button onClick={() => setActiveTab('masuk')} className={`font-bold pb-2 flex items-center whitespace-nowrap ${activeTab === 'masuk' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-500'}`}>
          Permintaan Masuk
          {incomingRequests.length > 0 && <span className="ml-2 bg-red-500 text-white text-[10px] sm:text-xs px-2 py-0.5 rounded-full">{incomingRequests.length}</span>}
        </button>
      </div>
      {activeTab === 'cari' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-white p-3 sm:p-4 rounded shadow border border-gray-200">
            <div className="flex justify-between items-center mb-3 sm:mb-4">
              <h3 className="font-bold text-gray-700 text-sm sm:text-base">Tugas Saya Mendatang</h3>
              {myFutureTasks.length > 1 && (
                <button onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="flex items-center text-[10px] sm:text-xs text-purple-600 font-semibold hover:text-purple-800 bg-purple-50 px-2 py-1.5 sm:px-3 rounded transition">
                  <ArrowUpDown className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5" /> {sortOrder === 'asc' ? 'Terdekat' : 'Terjauh'}
                </button>
              )}
            </div>
            {myFutureTasks.length === 0 ? <p className="text-xs sm:text-sm text-gray-500 italic">Tidak ada tugas mendatang.</p> : (
              <div className="space-y-2 sm:space-y-3 max-h-60 overflow-y-auto pr-1">
                {sortedTasks.map((t, i) => {
                  const pastCutoff = isPastCutoff(t.date, user.units || []);
                  const dynamicCutoffName = getCutoffDayName(t.date);
                  return (
                    <div key={i} onClick={() => {
                      if (pastCutoff) return;
                      const taskTeam = t.team?.id ? teamCandidates.find(team => String(team.id) === String(t.team.id)) : null;
                      if (taskTeam && String(taskTeam.leaderId || '') !== String(user?.id || '')) {
                        showAlert(`Jadwal ${taskTeam.name} hanya dapat ditukar oleh Koordinator Tim.`);
                        return;
                      }
                      setSelectedTask(t);
                    }} className={`p-2 sm:p-3 border rounded transition ${pastCutoff ? 'bg-gray-50 opacity-60 cursor-not-allowed border-gray-200' : selectedTask?.path === t.path ? 'bg-purple-50 border-purple-400 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}`}>
                      <div className="flex justify-between items-start">
                        <div className={`font-bold text-xs sm:text-sm ${pastCutoff ? 'text-gray-500' : 'text-purple-800'}`}>{formatDateIndo(t.date)}</div>
                        {pastCutoff && <span className="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase">Batas Lewat</span>}
                      </div>
                      <div className={`text-xs sm:text-sm mt-1 ${pastCutoff ? 'text-gray-400' : 'text-gray-600'}`}>{t.label}</div>
                      {t.team?.id && (() => { const taskTeam = teamCandidates.find(team => String(team.id) === String(t.team.id)); return taskTeam && String(taskTeam.leaderId || '') !== String(user?.id || '') ? <div className="text-[10px] text-gray-500 mt-1 italic">Tukar satu tim hanya oleh Koordinator Tim.</div> : null; })()}
                      {pastCutoff && <div className="text-[10px] text-red-500 mt-1 italic">Tukar jadwal ditutup (maksimal {dynamicCutoffName}).</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {selectedTask && !isPastCutoff(selectedTask.date, user.units || []) && (
            <div className="bg-white p-3 sm:p-4 rounded shadow border border-purple-200">
              <h3 className="font-bold mb-3 sm:mb-4 text-gray-700 text-sm sm:text-base">Minta Tolong Gantikan</h3>
              <div className="mb-4 relative" ref={dropdownRef}>
                <label className="text-xs sm:text-sm text-gray-600 block mb-1">Pilih Rekan Pengganti yang Eligible</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                  <input type="text" className="w-full border border-gray-300 rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" placeholder="Ketik nama rekan..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setTargetUser(""); setShowDropdown(true); }} onFocus={() => setShowDropdown(true)} />
                </div>
                {showDropdown && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                    {filteredReplacements.length === 0 ? (
                      <div className="p-2 text-xs text-gray-500 italic text-center">
                        Tidak ada petugas eligible yang tersedia pada jadwal ini
                      </div>
                    ) : (
                      filteredReplacements.map(p => (
                        <div key={p.id} onClick={() => handleSelectReplacement(p)} className="p-2 hover:bg-purple-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition text-sm text-gray-800">
                          {formatPersonnelDisplayName(p)}
                          <span className="text-[10px] text-gray-500 block">
                            {selectedRequirement?.label || (p.units || []).join(', ')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button onClick={handleRequestSwap} className="w-full bg-purple-600 text-white py-2 rounded font-bold hover:bg-purple-700 flex justify-center items-center text-sm sm:text-base"><Send className="w-4 h-4 mr-2"/> Kirim Permintaan</button>
            </div>
          )}
        </div>
      )}
      {activeTab === 'masuk' && (
        <div className="space-y-4">
          {incomingRequests.length === 0 ? <p className="text-sm text-gray-500 italic">Belum ada permintaan dari rekan.</p> : (
            incomingRequests.map(req => {
              const requester = personnel.find(p => p.id === req.requesterId);
              return (
                <div key={req.id} className="bg-white p-3 sm:p-4 rounded shadow border border-yellow-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="w-full sm:w-auto">
                    <div className="text-[10px] sm:text-xs font-bold text-yellow-600 mb-1">PERMINTAAN PENGGANTI</div>
                    <div className="font-bold text-sm sm:text-base text-gray-800">{req.swapType === 'TEAM' ? `${requester?.name || 'Koordinator tim'} meminta tim Anda menggantikan:` : `${requester?.name || 'Rekan'} meminta Anda menggantikan tugasnya:`}</div>
                    <div className="text-xs sm:text-sm text-gray-600 mt-1">Hari/Tanggal: <b>{formatDateIndo(req.date)}</b></div>
                    <div className="text-xs sm:text-sm text-gray-600">Tugas: <b>{req.label}</b></div>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                    <button onClick={() => handleReject(req)} className="flex-1 sm:flex-none bg-red-100 text-red-700 px-4 py-2 rounded font-bold hover:bg-red-200 text-sm">Tolak</button>
                    <button onClick={() => handleAccept(req)} className="flex-1 sm:flex-none bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700 text-sm">{req.swapType === 'TEAM' ? 'Terima untuk Tim' : 'Terima Tugas'}</button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  );
};
const ScheduleManager = ({ personnel, assignments, setAssignments, user, publishedSchedules, onPublish, swapRequests, customServices, setCustomServices }) => {
  const [presbiterCount, setPresbiterCount] = useState(8);
  const { showAlert, showConfirm } = useDialog();
  const availableTabs = useMemo(() => {
    const tabs = [{ id: 'ibadah', label: 'Ibadah' }, { id: 'all_petugas', label: 'All Petugas' }];
    if (checkPermission(user, 'presbiter')) tabs.push({ id: 'presbiter', label: 'Presbiter' });
    if (checkPermission(user, 'multimedia')) tabs.push({ id: 'multimedia', label: 'Multimedia' });
    if (checkPermission(user, 'sound')) tabs.push({ id: 'sound', label: 'Sound' });
    if (checkPermission(user, 'muger')) tabs.push({ id: 'muger', label: 'Muger' });
    if (checkPermission(user, 'pelkat')) tabs.push({ id: 'pelkat', label: 'Pelkat' });
    return tabs;
  }, [user]);
  const [selectedMonth, setSelectedMonth] = useState(getTodayString().slice(0, 7));
  const [activeUnitTab, setActiveUnitTab] = useState(availableTabs.length > 0 ? availableTabs[0].id : "");
  const [unlockEdit, setUnlockEdit] = useState(false);
  
  // Custom Service state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingCustomService, setEditingCustomService] = useState(null);
  const [showDateSettingModal, setShowDateSettingModal] = useState(false);
  const [editingDateSetting, setEditingDateSetting] = useState('');
  const [dateServiceMode, setDateServiceMode] = useState('REGULAR');
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState('18:00');
  const [customTimeSuffix, setCustomTimeSuffix] = useState("");
  const [customLabel, setCustomLabel] = useState('Ibadah Keluarga');
  const [customPCount, setCustomPCount] = useState(8);
  const [customLivestream, setCustomLivestream] = useState(false);
  const [customLocation, setCustomLocation] = useState('Gedung Gereja');
  const [customNotes, setCustomNotes] = useState('');
  const [mugerSingerCounts, setMugerSingerCounts] = useState({});
  const [mugerChoirCounts, setMugerChoirCounts] = useState({});
  const [mugerGroups, setMugerGroups] = useState([]);
  const [mugerCollaborations, setMugerCollaborations] = useState([]);
  const [masterServiceTypes, setMasterServiceTypes] = useState([]);
  const [expandedDates, setExpandedDates] = useState(() => new Set());
  const [expandedServices, setExpandedServices] = useState(() => new Set());

  const DEFAULT_SERVICE_TYPES = [
    'Ibadah Keluarga',
    'Ibadah Sektor',
    'Ibadah Syukur',
    'Ibadah Kedukaan',
    'Ibadah Penglepasan',
    'Ibadah Pemberkatan Perkawinan',
    'Ibadah Perjamuan Kudus',
    'Ibadah Kaum Muda',
    'Malam Natal',
    'Natal',
    'Jumat Agung',
    'Paskah',
    'Kenaikan Yesus Kristus',
    'Lainnya',
  ];

  useEffect(() => {
    return onSnapshot(collection(db, 'services'), snapshot => {
      const rows = snapshot.docs
        .map(row => {
          const data = row.data() || {};
          return {
            id: row.id,
            name: data.name || data.serviceName || data.label || data.title || data.typeName || '',
            status: data.status || 'active',
          };
        })
        .filter(row => {
          const raw = snapshot.docs.find(docRow => docRow.id === row.id)?.data() || {};
          const isMasterType =
            raw.recordType === 'SERVICE_TYPE' ||
            raw.masterType === true ||
            Boolean(raw.typeName);
          return isMasterType && row.status !== 'inactive' && row.name;
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'id'));

      const mergedNames = [
        ...rows.map(row => row.name),
        ...DEFAULT_SERVICE_TYPES,
      ].filter((name, index, all) =>
        all.findIndex(other =>
          normalizePersonnelName(other) === normalizePersonnelName(name)
        ) === index
      );

      setMasterServiceTypes(mergedNames);

      if (
        mergedNames.length &&
        !mergedNames.some(name =>
          normalizePersonnelName(name) === normalizePersonnelName(customLabel)
        )
      ) {
        setCustomLabel(mergedNames[0]);
      }
    });
  }, []);

  useEffect(() => {
    if (activeUnitTab !== 'muger') return;
    let cancelled = false;
    const loadMugerReferenceData = async () => {
      try {
        const [groupSnap, collaborationSnap] = await Promise.all([
          getDocs(collection(db, 'groups')),
          getDocs(collection(db, 'musicCollaborations')),
        ]);
        if (cancelled) return;
        setMugerGroups(groupSnap.docs.map(row => {
          const data = row.data();
          return {
            id: row.id,
            name: data.timName || data.groupName || data.name || row.id,
            type: String(data.type || 'MUSIC_TEAM').toUpperCase(),
            status: data.status || 'active',
          };
        }).filter(row => row.status !== 'inactive'));
        setMugerCollaborations(collaborationSnap.docs.map(row => ({
          id: row.id,
          ...row.data(),
        })).filter(row => (row.status || 'active') !== 'inactive'));
      } catch (error) {
        console.error('Gagal memuat referensi Muger:', error);
      }
    };
    loadMugerReferenceData();
    return () => { cancelled = true; };
  }, [activeUnitTab]);

  // Import state additions
  const importInputRef = useRef(null);
  const [importReport, setImportReport] = useState(null); // { success, errors, fileName }
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.find(t => t.id === activeUnitTab)) {
      setActiveUnitTab(availableTabs[0].id);
    }
    setUnlockEdit(false);
  }, [availableTabs, activeUnitTab, selectedMonth]);
  const isPublished = publishedSchedules.includes(`${selectedMonth}-${activeUnitTab}`);
  const baseCanEdit = (!isPublished || unlockEdit);

  const isSuperScheduleAdmin = checkPermission(user, 'multimedia') && (user?.roles?.includes(ROLES.SUPERADMIN) || /admin\s+phmj|super\s*admin/i.test(String(user?.name || '')));
  const isUnitScheduleAdmin = !isSuperScheduleAdmin && (user?.roles?.includes(ROLES.ADMIN_UNIT) || /^admin\b/i.test(String(user?.name || '')) || String(user?.appRole || '').toUpperCase() === 'ADMIN_UNIT');
  const isGpScheduleAdmin =
    isUnitScheduleAdmin &&
    (user?.units || []).some(unit => unitMatches(unit, UNITS.GP));

  const hasFullTabAccess = (tabId) => {
    if (isSuperScheduleAdmin) return true;
    if (!isUnitScheduleAdmin) return false;

    switch (tabId) {
      case 'multimedia':
        return (user?.units || []).some(unit => unitMatches(unit, UNITS.MULTIMEDIA));
      case 'sound':
        return (user?.units || []).some(unit => unitMatches(unit, UNITS.SOUND));
      case 'muger':
        return (user?.units || []).some(unit =>
          unitMatches(unit, UNITS.MUGER) || unitMatches(unit, UNITS.PS)
        );
      case 'pelkat':
        return (user?.units || []).some(unit =>
          unitMatches(unit, UNITS.PA) || unitMatches(unit, UNITS.PT)
        );
      case 'presbiter':
        return false;
      case 'ibadah':
        return true;
      default:
        return false;
    }
  };

  const isIkmServiceDefinition = (svc) =>
    Boolean(
      svc?.isIKM ||
      svc?.time === '19:00' ||
      /ibadah kaum muda|\bikm\b/i.test(String(svc?.label || ''))
    );

  const isGpEditableMugerKey = (key) =>
    /^ps_pemandu\d*$/.test(String(key || ''));

  const canEditSlot = (date, svc, key, tabId = activeUnitTab) => {
    if (!baseCanEdit) return false;
    if (hasFullTabAccess(tabId)) return true;

    if (isGpScheduleAdmin && tabId === 'presbiter') {
      return (
        isIkmServiceDefinition(svc) &&
        !svc?.isCommunion &&
        ['p2', 'p3', 'p4'].includes(String(key || ''))
      );
    }

    if (isGpScheduleAdmin && tabId === 'muger') {
      return isGpEditableMugerKey(key);
    }

    return false;
  };

  const canEditTab = baseCanEdit && (
    hasFullTabAccess(activeUnitTab) ||
    (isGpScheduleAdmin && ['presbiter', 'muger'].includes(activeUnitTab))
  );

  const canUseBulkActions =
    baseCanEdit &&
    hasFullTabAccess(activeUnitTab);

  const canPublishActiveTab =
    hasFullTabAccess(activeUnitTab);

  const canEdit = canEditTab;
  const getVal = (date, cat, catId, key) => assignments[date]?.[cat]?.[catId]?.[key]?.userId || "";

  const getGroupMemberIds = groupId => personnel.filter(person =>
    (person.musicTeams || []).some(team => String(team.id) === String(groupId))
  ).map(person => person.id);
  const getAssignedUserIdsForService = (date, serviceId, ignoredSlotKey = '') => {
    const ids = new Set();
    Object.entries(assignments[date]?.services?.[serviceId] || {}).forEach(([slotKey,item]) => {
      if (slotKey === ignoredSlotKey || !item?.userId) return;
      if (mugerGroups.some(group => String(group.id) === String(item.userId))) getGroupMemberIds(item.userId).forEach(id=>ids.add(id));
      else if (personnel.some(person=>String(person.id)===String(item.userId))) ids.add(item.userId);
    });
    return ids;
  };
  const isAvailableForService = (person,date,serviceId,ignoredSlotKey='') =>
    !getAssignedUserIdsForService(date,serviceId,ignoredSlotKey).has(person.id);
  const canUseGroupForService = (groupId,date,serviceId,ignoredSlotKey='') => {
    const assigned = getAssignedUserIdsForService(date,serviceId,ignoredSlotKey);
    return getGroupMemberIds(groupId).every(id=>!assigned.has(id));
  };
  const getStats = () => {
    const stats = {};
    personnel.forEach(p => stats[p.id] = { total: 0, monthTotal: 0, positions: {}, times: {} });
    Object.entries(assignments).forEach(([d, cats]) => {
      const isCurrentMonth = d.startsWith(selectedMonth);
      const count = (uid, posKey, timeVal) => {
        if(uid && stats[uid]) {
          stats[uid].total++;
          if (isCurrentMonth) stats[uid].monthTotal++;
          if (posKey) stats[uid].positions[posKey] = (stats[uid].positions[posKey] || 0) + 1;
          if (timeVal) stats[uid].times[timeVal] = (stats[uid].times[timeVal] || 0) + 1;
        }
      }
      if(cats.services) {
        Object.entries(cats.services).forEach(([svcId, s]) => {
          let timeVal = "";
          let svcDef = SUNDAY_SERVICES.find(x => x.id.toString() === svcId.toString());
          if (!svcDef && customServices[d]) {
            svcDef = customServices[d].find(x => x.id.toString() === svcId.toString());
          }
          if (svcDef) timeVal = svcDef.time;
          Object.entries(s).forEach(([k, v]) => count(v?.userId, k, timeVal));
        });
      }
      if(cats.pa) Object.entries(cats.pa).forEach(([cId, c]) => Object.entries(c).forEach(([k, v]) => count(v?.userId, `${cId}_${k}`, '08:00')));
      if(cats.pt) Object.entries(cats.pt).forEach(([cId, c]) => Object.entries(c).forEach(([k, v]) => count(v?.userId, `${cId}_${k}`, '08:00')));
      if(cats.presbiterPendamping) Object.entries(cats.presbiterPendamping).forEach(([k, v]) => count(v?.userId, `pendamping_${k}`, '08:00'));
      if(cats.pendetaPendamping) Object.entries(cats.pendetaPendamping).forEach(([k, v]) => count(v?.userId, `pendeta_${k}`, '08:00'));
      if(cats.pemimpinPersiapan) {
        if(cats.pemimpinPersiapan.pa) count(cats.pemimpinPersiapan.pa?.userId, 'pemimpin_pa', 'Jumat');
        if(cats.pemimpinPersiapan.pt) count(cats.pemimpinPersiapan.pt?.userId, 'pemimpin_pt', 'Jumat');
      }
    });
    return stats;
  };
  const updateAssignment = (date, category, catId, key, val) => {
    const svc =
      category === 'services'
        ? getServicesForDate(date, customServices).find(item => String(item.id) === String(catId))
        : null;

    const allowed =
      category === 'services'
        ? canEditSlot(date, svc, key, activeUnitTab)
        : canEditTab;

    if (!allowed) return;

    setAssignments(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if(!next[date]) next[date] = {};
      if(!next[date][category]) next[date][category] = {};
      if(!next[date][category][catId]) next[date][category][catId] = {};
      next[date][category][catId][key] = { userId: val, status: 'assigned' };
      return next;
    });
  };
  const openAddCustomService = (date = '') => {
    setEditingCustomService(null);
    setCustomDate(date || '');
    setCustomTime('18:00');
    setCustomLabel(masterServiceTypes[0] || 'Ibadah Keluarga');
    setCustomPCount(8);
    setCustomLivestream(false);
    setCustomLocation('Gedung Gereja');
    setCustomNotes('');
    setShowCustomModal(true);
  };
  const openEditCustomService = (date, service) => {
    setEditingCustomService({ date, id: service.id });
    setCustomDate(date);
    setCustomTime(String(service.time || '18:00').split(' ')[0]);
    setCustomLabel(service.label || masterServiceTypes[0] || 'Ibadah Keluarga');
    setCustomPCount(Number(service.pCount || 8));
    setCustomLivestream(Boolean(service.isLivestream));
    setCustomLocation(service.location || 'Gedung Gereja');
    setCustomNotes(service.notes || '');
    setShowCustomModal(true);
  };
  const closeCustomServiceModal = () => {
    setShowCustomModal(false);
    setEditingCustomService(null);
  };
  const handleAddCustomService = async (e) => {
    e.preventDefault();
    if (!customDate || !customTime || !customLabel) return await showAlert('Lengkapi data ibadah terlebih dahulu.');
    const existingId = editingCustomService?.id;
    const service = {
      id: existingId || `custom_${Date.now()}`,
      time: customTime,
      label: customLabel,
      pCount: Number(customPCount || 8),
      isIKM: /kaum muda|ikm/i.test(customLabel),
      isCustom: true,
      isLivestream: customLivestream,
      location: customLocation,
      notes: customNotes.trim(),
    };
    setCustomServices(prev => {
      const next = { ...prev };
      if (editingCustomService) {
        const oldDate = editingCustomService.date;
        next[oldDate] = (next[oldDate] || []).filter(item => item.id !== existingId);
        if (!next[oldDate].length) delete next[oldDate];
      }
      next[customDate] = [...(next[customDate] || []).filter(item => item.id !== service.id), service]
        .sort((a,b) => String(a.time || '').localeCompare(String(b.time || '')));
      return next;
    });
    if (editingCustomService && editingCustomService.date !== customDate) {
      setAssignments(prev => {
        const next = JSON.parse(JSON.stringify(prev));
        const oldAssignment = next[editingCustomService.date]?.services?.[existingId];
        if (oldAssignment) {
          if (!next[customDate]) next[customDate] = {};
          if (!next[customDate].services) next[customDate].services = {};
          next[customDate].services[existingId] = oldAssignment;
          delete next[editingCustomService.date].services[existingId];
        }
        return next;
      });
    }
    setPresbiterCount(prev => Math.max(prev, Number(customPCount || 8)));
    closeCustomServiceModal();
    setCustomNotes('');
    await showAlert(editingCustomService ? 'Ibadah berhasil diperbarui.' : 'Ibadah berhasil ditambahkan.');
  };
  const openDateSetting = date => {
    const setting = getDateServiceSetting(date, customServices);
    setEditingDateSetting(date);
    setDateServiceMode(setting?.serviceMode || 'REGULAR');
    setShowDateSettingModal(true);
  };
  const handleSaveDateSetting = async e => {
    e.preventDefault();
    if (!editingDateSetting) return;
    const isCommunion = dateServiceMode === 'HOLY_COMMUNION';
    setCustomServices(prev => {
      const rows = (prev[editingDateSetting] || []).filter(item => !item?.isDateSetting && item?.id !== DATE_SETTING_ID);
      return {
        ...prev,
        [editingDateSetting]: [
          ...rows,
          {
            id: DATE_SETTING_ID,
            isDateSetting: true,
            serviceMode: dateServiceMode,
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    });
    setAssignments(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const services = next[editingDateSetting]?.services || {};
      Object.entries(services).forEach(([serviceId, slots]) => {
        const svc = SUNDAY_SERVICES.find(item => String(item.id) === String(serviceId));
        if (!svc) return;
        Object.keys(slots || {}).forEach(key => {
          if (/^ps_vg\d+_/.test(key)) delete slots[key];
        });
        if (svc.isIKM) {
          ['p2', 'p3', 'p4'].forEach(key => {
            if (slots[key]) slots[key] = { userId: '', status: '' };
          });
        }
      });
      return next;
    });
    setShowDateSettingModal(false);
    await showAlert(isCommunion ? 'Tanggal ditetapkan sebagai Sakramen Perjamuan Kudus.' : 'Tanggal dikembalikan menjadi ibadah reguler.');
  };
  const handleDeleteCustomService = async (dateStr, svcId, label) => {
    if (!await showConfirm(`Apakah Anda yakin ingin menghapus ibadah khusus "${label}" pada tanggal ${formatDateIndo(dateStr)}?`)) return;
    setCustomServices(prev => {
      const next = { ...prev };
      if (next[dateStr]) {
        next[dateStr] = next[dateStr].filter(s => s.id !== svcId);
        if (next[dateStr].length === 0) delete next[dateStr];
      }
      return next;
    });
    setAssignments(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next[dateStr] && next[dateStr].services && next[dateStr].services[svcId]) {
        delete next[dateStr].services[svcId];
      }
      return next;
    });
  };
  const resetAssignments = async (unit) => {
    if(!canEdit) return;
    if(!await showConfirm(`PERINGATAN!\n\nApakah Anda yakin ingin MENGHAPUS SEMUA jadwal ${unit.toUpperCase()} untuk bulan ${selectedMonth}?\n\nTindakan ini tidak dapat dibatalkan.`)) return;
    const dates = getServiceDatesInMonth(selectedMonth, customServices);
    setAssignments(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      dates.forEach(date => {
        if(!next[date]) return;
        if (unit === 'presbiter' || unit === 'multimedia' || unit === 'sound' || unit === 'muger') {
          if(!next[date].services) return;
          Object.keys(next[date].services).forEach(svcId => {
            if (unit === 'presbiter') {
              for(let i=1; i<=30; i++) {
                if (next[date].services[svcId][`p${i}`]) {
                  next[date].services[svcId][`p${i}`] = { userId: "", status: "" };
                }
              }
            } else if (unit === 'multimedia') {
              ['mm_slide', 'mm_cam1', 'mm_cam2', 'mm_cam3', 'mm_switch', 'mm_pic'].forEach(k => {
                if (next[date].services[svcId][k]) next[date].services[svcId][k] = { userId: "", status: "" };
              });
            } else if (unit === 'sound') {
              ['sound1', 'sound2'].forEach(k => {
                if (next[date].services[svcId][k]) next[date].services[svcId][k] = { userId: "", status: "" };
              });
            } else if (unit === 'muger') {
              ['ps_organis', 'ps_pemandu', 'ps_pemandu1', 'ps_pemandu2', 'ps_pemandu3', 'ps_pemandu4',
              'ps_pemusik1', 'ps_pemusik2', 'ps_tim_musik',
              'ps_vg1_name', 'ps_vg2_name', 'ps_vg3_name', 'ps_vg1_est', 'ps_vg1_soloist',
              'ps_vg1_instr', 'ps_vg2_est', 'ps_vg2_soloist', 'ps_vg2_instr', 'ps_vg3_est', 'ps_vg3_soloist',
              'ps_vg3_instr'].forEach(k => {
                if (next[date].services[svcId][k]) next[date].services[svcId][k] = { userId: "", status: "" };
              });
            }
          });
        } else if (unit === 'pelkat') {
          ['presbiterPendamping', 'pendetaPendamping', 'pemimpinPersiapan'].forEach(cat => {
            if (next[date][cat]) {
              Object.keys(next[date][cat]).forEach(catId => {
                next[date][cat][catId] = { userId: "", status: "" };
              });
            }
          });
          ['pa', 'pt'].forEach(cat => {
            if (next[date][cat]) {
              Object.keys(next[date][cat]).forEach(catId => {
                Object.keys(next[date][cat][catId]).forEach(key => {
                  next[date][cat][catId][key] = { userId: "", status: "" };
                });
              });
            }
          });
        }
      });
      return next;
    });
    await showAlert(`Jadwal ${unit.toUpperCase()} bulan ${selectedMonth} berhasil dikosongkan.`);
  };
  const getAssignedUserIdsForServiceFrom = (source,date,serviceId,ignoredSlotKey='') => {
    const ids = new Set();
    Object.entries(source?.[date]?.services?.[serviceId] || {}).forEach(([slotKey,item]) => {
      if (slotKey === ignoredSlotKey || !item?.userId) return;
      if (mugerGroups.some(group => String(group.id) === String(item.userId))) {
        personnel.filter(person => (person.musicTeams || []).some(team => String(team.id) === String(item.userId))).forEach(person=>ids.add(person.id));
      } else if (personnel.some(person=>String(person.id)===String(item.userId))) ids.add(item.userId);
    });
    return ids;
  };

  const autoGenerate = async (unit) => {
    if(!canEdit) return;
    if(!await showConfirm(`Auto-Isi jadwal ${unit} untuk bulan ${selectedMonth} dengan rotasi merata?`)) return;

    // Tandem/kolaborasi Muger menjadi sumber utama untuk auto-fill.
    // Hanya petugas aktif yang masih memiliki unit Muger aktif yang dipakai.
    let dbMugerTandems = [];
    if (unit === 'muger') {
      try {
        const snap = await getDocs(collection(db, 'musicCollaborations'));
        const normalize = (value='') => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/^(pnt|penatua|dkn|diaken)\.?\s+/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
        const activeMuger = personnel.filter(p => {
          const memberships = normalizeMemberships(p);
          return p.status !== 'inactive' && memberships.unitMemberships.some(u => u.name === UNITS.MUGER && u.status !== 'inactive');
        });
        const byId = new Map(activeMuger.map(p => [String(p.id), p]));
        const byName = new Map(activeMuger.map(p => [normalize(p.name), p]));
        snap.docs.forEach(row => {
          const data = row.data() || {};
          if ((data.status || 'active') === 'inactive' || String(data.type || '').toUpperCase() !== 'DUET') return;

          const duetGroup = (Array.isArray(data.groups) ? data.groups : []).find(group => (
            String(group.entityType || 'PERSON').toUpperCase() === 'PERSON' &&
            Array.isArray(group.memberIds)
          ));
          if (!duetGroup) return;

          const memberIds = [...new Set(duetGroup.memberIds.map(String))]
            .filter(memberId => byId.has(memberId));

          // Satu konfigurasi duet boleh berisi lebih dari dua petugas.
          // Scheduler membuat seluruh kombinasi pasangan dari grup tersebut.
          for (let first = 0; first < memberIds.length; first += 1) {
            for (let second = first + 1; second < memberIds.length; second += 1) {
              dbMugerTandems.push([memberIds[first], memberIds[second]]);
            }
          }
        });
      } catch (error) {
        console.error('Gagal membaca tandem Muger untuk auto-fill:', error);
      }
    }

    const dates = getServiceDatesInMonth(selectedMonth, customServices);
    const dynamicStats = getStats();
    const pickBestCandidate = (pool, posKey, timeVal) => {
      if(pool.length === 0) return null;
      pool.sort((a,b) => {
        const statA = dynamicStats[a.id];
        const statB = dynamicStats[b.id];
        if (statA.monthTotal !== statB.monthTotal) return statA.monthTotal - statB.monthTotal;
        if (statA.total !== statB.total) return statA.total - statB.total;
        if (timeVal) {
          const timeA = statA.times[timeVal] || 0;
          const timeB = statB.times[timeVal] || 0;
          if (timeA !== timeB) return timeA - timeB;
        }
        const posA = statA.positions[posKey] || 0;
        const posB = statB.positions[posKey] || 0;
        if (posA !== posB) return posA - posB;
        return 0.5 - Math.random();
      });
      const chosen = pool[0];
      dynamicStats[chosen.id].total++;
      dynamicStats[chosen.id].monthTotal++;
      dynamicStats[chosen.id].positions[posKey] = (dynamicStats[chosen.id].positions[posKey] || 0) + 1;
      if (timeVal) dynamicStats[chosen.id].times[timeVal] = (dynamicStats[chosen.id].times[timeVal] || 0) + 1;
      return chosen.id;
    };
    let hadToDoubleAssign = false;
    setAssignments(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      dates.forEach(date => {
        if(!next[date]) next[date] = {};
        if(!next[date].services) next[date].services = {};
        const svcsToday = getServicesForDate(date, customServices);
        
        if (unit === 'presbiter' || unit === 'multimedia' || unit === 'sound' || unit === 'muger') {
          const assignedToday = new Set();
          Object.keys(next[date].services).forEach(svcId => {
            const sDef = svcsToday.find(s => s.id.toString() === svcId.toString());
            const limit = sDef ? getServiceConfig(sDef).actualPCount : 30;
            const svcData = next[date].services[svcId];
            Object.entries(svcData).forEach(([key, val]) => {
              if (val && val.userId) {
                const match = key.match(/^p(\d+)$/);
                if (match) {
                  if (parseInt(match[1]) <= limit) assignedToday.add(val.userId);
                } else {
                  assignedToday.add(val.userId);
                }
              }
            });
          });
          if (unit === 'presbiter') {
            svcsToday.forEach(svc => { if(!next[date].services[svc.id]) next[date].services[svc.id] = {}; });
            const svcsMeta = svcsToday.map(svc => {
              const config = getServiceConfig(svc);
              return { svc, actualPCount: config.actualPCount, isIKM: config.isIKM, isCommunion: Boolean(svc.isCommunion) };
            });
            svcsMeta.forEach(({ svc, actualPCount, isIKM, isCommunion }) => {
              const strictSlots = isIKM ? [1, 2, 3, 4] : [1, 2, 4];
              strictSlots.forEach(i => {
                if (i <= actualPCount && !next[date].services[svc.id][`p${i}`]?.userId) {
                  let pool = personnel.filter(p => {
                    if (assignedToday.has(p.id)) return false;
                    if (isIKM && !isCommunion && (i >= 2 && i <= 4)) return (p.units || []).includes(UNITS.GP);
                    if ((p.units || []).includes(UNITS.PRESBITER)) {
                      if (i === 1) return (p.roles || []).includes(ROLES.PENATUA);
                      if ((!isIKM || isCommunion) && i === 2) return (p.roles || []).includes(ROLES.PENATUA);
                      if ((!isIKM || isCommunion) && i === 4) return (p.roles || []).includes(ROLES.DIAKEN);
                    }
                    return false;
                  });
                  if (pool.length === 0) {
                    pool = personnel.filter(p => {
                      if (isIKM && !isCommunion && (i >= 2 && i <= 4)) return (p.units || []).includes(UNITS.GP);
                      if ((p.units || []).includes(UNITS.PRESBITER)) {
                        if (i === 1) return (p.roles || []).includes(ROLES.PENATUA);
                        if ((!isIKM || isCommunion) && i === 2) return (p.roles || []).includes(ROLES.PENATUA);
                        if ((!isIKM || isCommunion) && i === 4) return (p.roles || []).includes(ROLES.DIAKEN);
                      }
                      return false;
                    });
                    if (pool.length > 0) hadToDoubleAssign = true;
                  }
                  const id = pickBestCandidate(pool, `p${i}`, svc.time);
                  if(id) {
                    next[date].services[svc.id][`p${i}`] = { userId: id, status:'assigned' };
                    assignedToday.add(id);
                  }
                }
              });
            });
            svcsMeta.forEach(({ svc, actualPCount, isIKM }) => {
              const strictSlots = isIKM ? [1, 2, 3, 4] : [1, 2, 4];
              for(let i = 1; i <= actualPCount; i++) {
                if (strictSlots.includes(i)) continue;
                if(!next[date].services[svc.id][`p${i}`]?.userId) {
                  let pool = personnel.filter(p => {
                    if (assignedToday.has(p.id)) return false;
                    if ((p.units || []).includes(UNITS.PRESBITER)) return true;
                    return false;
                  });
                  if (pool.length === 0) {
                    pool = personnel.filter(p => (p.units || []).includes(UNITS.PRESBITER));
                    if (pool.length > 0) hadToDoubleAssign = true;
                  }
                  const id = pickBestCandidate(pool, `p${i}`, svc.time);
                  if(id) {
                    next[date].services[svc.id][`p${i}`] = { userId: id, status:'assigned' };
                    assignedToday.add(id);
                  }
                }
              }
            });
          } else {
            svcsToday.forEach(svc => {
              if(!next[date].services[svc.id]) next[date].services[svc.id] = {};
              
              if (unit === 'multimedia') {
                const slideCreatorNames = ['Samuel Hetarie', 'Anathadya Sompotan', 'Tasya Samallo', 'Louise Anugrahani'];
                const slideCreatorPool = personnel.filter(person => slideCreatorNames.some(name => normalizePersonnelName(name) === normalizePersonnelName(person.name)));
                if (!next[date].multimediaDaily) next[date].multimediaDaily = { daily: {} };
                if (!next[date].multimediaDaily.daily) next[date].multimediaDaily.daily = {};
                if (!next[date].multimediaDaily.daily.slide_creator?.userId) {
                  const creatorId = pickBestCandidate([...slideCreatorPool], 'slide_creator', 'daily');
                  if (creatorId) next[date].multimediaDaily.daily.slide_creator = { userId: creatorId, status: 'assigned' };
                }
                if (svc.isCustom && !next[date].services[svc.id].slide_creator?.userId) {
                  const creatorId = pickBestCandidate([...slideCreatorPool], 'slide_creator_custom', svc.time);
                  if (creatorId) next[date].services[svc.id].slide_creator = { userId: creatorId, status: 'assigned' };
                }
                // Multimedia boleh bertugas lebih dari satu kali dalam hari yang sama.
                // Kandidat hanya dibatasi oleh role dan ketentuan jam penugasannya.
                const activeKeys = getMultimediaKeysForService(svc);

                MULTIMEDIA_ALL_KEYS.forEach(k => {
                  if (!activeKeys.includes(k)) {
                    next[date].services[svc.id][k] = { userId: '', status: '' };
                    return;
                  }

                  if (!next[date].services[svc.id][k]?.userId) {
                    let reqRole = '';
                    if (k === 'mm_slide') reqRole = ROLES.MM_SLIDE;
                    else if (k.startsWith('mm_cam')) reqRole = ROLES.MM_CAM;
                    else if (k === 'mm_switch') reqRole = ROLES.MM_SWITCH;
                    else if (k === 'mm_pic') reqRole = ROLES.MM_PIC;

                    let eligible = personnel.filter(person => {
                      const memberships = normalizeMemberships(person);
                      const hasActiveMultimediaUnit = memberships.unitMemberships.some(
                        membership =>
                          normalizeRoleToken(membership.name) === normalizeRoleToken(UNITS.MULTIMEDIA) &&
                          String(membership.status || 'active').toLowerCase() !== 'inactive'
                      );

                      return (
                        hasActiveMultimediaUnit &&
                        hasActiveMultimediaRole(
                          { ...person, roleMemberships: memberships.roleMemberships },
                          reqRole
                        ) &&
                        canServeMultimediaService(person, svc) &&
                        !getAssignedUserIdsForServiceFrom(next,date,svc.id,k).has(person.id)
                      );
                    });

                    // Petugas dengan rule "Mengikuti jadwal PL/Choir":
                    // - tidak ditempatkan pada ibadah yang sama dengan tugas Muger;
                    // - diprioritaskan pada ibadah tepat sebelum atau sesudah tugas Muger.
                    eligible = eligible.filter(person => {
                      if (!followsMugerSchedule(person)) return true;
                      const mugerServiceIds = getMugerServiceIdsForUser(next[date].services, person.id);
                      return !mugerServiceIds.includes(String(svc.id));
                    });

                    const adjacentFollowers = eligible.filter(person => {
                      if (!followsMugerSchedule(person)) return false;
                      const mugerServiceIds = getMugerServiceIdsForUser(next[date].services, person.id);
                      if (mugerServiceIds.length === 0) return false;
                      const adjacentIds = getAdjacentServiceIds(svcsToday, mugerServiceIds);
                      return adjacentIds.has(String(svc.id));
                    });

                    const dedicatedTambak = isTambakService(svc)
                      ? eligible.filter(isDedicatedTambakMultimedia)
                      : [];

                    // Prioritas:
                    // 1. Ketentuan yang spesifik sesuai jam/layanan;
                    // 2. Menyesuaikan jadwal PL/Choir;
                    // 3. Semua Jam sebagai fallback.
                    // Di dalam kelompok prioritas yang sama tetap dipilih
                    // berdasarkan jumlah tugas paling sedikit agar merata.
                    let basePool = dedicatedTambak.length > 0
                      ? dedicatedTambak
                      : adjacentFollowers.length > 0
                        ? adjacentFollowers
                        : eligible;

                    const bestPriority = Math.min(
                      ...basePool.map(person => getMultimediaRulePriority(person, svc))
                    );

                    const pool = basePool.filter(person =>
                      getMultimediaRulePriority(person, svc) === bestPriority
                    );

                    const id = pickBestCandidate(pool, k, svc.time);
                    if (id) {
                      next[date].services[svc.id][k] = { userId: id, status: 'assigned' };
                      // Sengaja tidak dimasukkan ke assignedToday agar orang yang sama
                      // tetap boleh mengisi lebih dari satu jadwal Multimedia pada hari itu.
                    }
                  }
                });
              } else if (unit === 'sound') {
                ['sound1', 'sound2'].forEach(k => {
                  if(!next[date].services[svc.id][k]?.userId) {
                    const pool = personnel.filter(p => hasActiveUnit(p,UNITS.SOUND)&&hasActiveRole(p,ROLES.SOUND_OPS,UNITS.SOUND)&&!getAssignedUserIdsForServiceFrom(next,date,svc.id,k).has(p.id));
                    const id = pickBestCandidate(pool, k, svc.time);
                    if(id) { next[date].services[svc.id][k] = { userId: id, status:'assigned' }; }
                  }
                });
              } else if (unit === 'muger') {
                const choirGroups = [
                  ...personnel
                    .filter(person =>
                      String(person.status || 'active').toLowerCase() !== 'inactive' &&
                      hasActiveRole(person, ROLES.PS_CHOIR)
                    )
                    .map(person => ({
                      id: person.id,
                      name: person.name,
                      source: 'PERSONNEL',
                    })),
                  
                  ...mugerGroups
                    .filter(group =>
                      group.status !== 'inactive' &&
                      [
                        'CHOIR',
                        'PS',
                        'VG',
                        'VOCAL_GROUP',
                        'PADUAN_SUARA',
                        'PS_VG',
                      ].includes(String(group.type || '').toUpperCase())
                    )
                    .map(group => ({
                      id: group.id,
                      name: group.name,
                      source: 'GROUP',
                    })),
                  
                  ...mugerCollaborations
                    .filter(item =>
                      [
                        'CHOIR',
                        'PS',
                        'VG',
                        'PS_VG',
                        'VOCAL_GROUP',
                        'PADUAN_SUARA',
                      ].includes(String(item.type || '').toUpperCase())
                    )
                    .map(item => ({
                      id: item.groupId || item.choirId || item.id,
                      name:
                        item.groupName ||
                        item.choirName ||
                        item.name ||
                        item.title ||
                        item.id,
                      source: 'COLLABORATION',
                    })),
                ].filter(
                  (item, index, rows) =>
                    item.name &&
                    rows.findIndex(
                      other =>
                        normalizePersonnelName(other.name) ===
                        normalizePersonnelName(item.name)
                    ) === index
                );
                // Pilih PS/VG lebih dulu supaya prokantor/pemusik dapat mengikuti tandeman PS/VG.
                if (!next[date].services[svc.id]['ps_vg1_name']?.userId && choirGroups.length > 0) {
                  const choirUsage = {};
                  Object.values(next).forEach(day => {
                    Object.values(day?.services || {}).forEach(service => {
                      const choirId = service?.ps_vg1_name?.userId;
                      if (choirId) choirUsage[choirId] = (choirUsage[choirId] || 0) + 1;
                    });
                  });
                  const isIkmService =
                    svc.time === '19:00' ||
                    /ibadah kaum muda|\bikm\b/i.test(String(svc.label || ''));

                  const gpPaulusChoir = choirGroups.find(group =>
                    normalizePersonnelName(group.name) === normalizePersonnelName('GP Paulus Choir')
                  );

                  let selected = null;

                  // GP Paulus Choir diprioritaskan untuk IKM.
                  if (isIkmService && gpPaulusChoir) {
                    selected = gpPaulusChoir;
                  } else {
                    // Untuk ibadah lain, keluarkan GP Paulus Choir dari prioritas utama
                    // agar rotasi PS/VG lain tetap merata.
                    const regularPool = choirGroups.filter(group =>
                      normalizePersonnelName(group.name) !== normalizePersonnelName('GP Paulus Choir')
                    );
                    const selectionPool = regularPool.length ? regularPool : choirGroups;
                    const minUsage = Math.min(...selectionPool.map(group => choirUsage[group.id] || 0));
                    const leastUsed = selectionPool.filter(group => (choirUsage[group.id] || 0) === minUsage);
                    selected = leastUsed[Math.floor(Math.random() * leastUsed.length)];
                  }

                  next[date].services[svc.id]['ps_vg1_name'] = {
                    userId: selected.id,
                    status: 'assigned',
                    assignmentType: 'GROUP',
                  };
                }

                const selectedChoirId = next[date].services[svc.id]['ps_vg1_name']?.userId;
                const selectedChoirName =
                  choirGroups.find(group => String(group.id) === String(selectedChoirId))?.name ||
                  personnel.find(person => String(person.id) === String(selectedChoirId))?.name || '';
                const selectedChoirTandem = mugerCollaborations.find(item => {
                  const linkedId = item.groupId || item.choirId || item.psVgId || item.sourceGroupId;
                  const linkedName = item.groupName || item.choirName || item.psVgName || item.name || item.title;
                  return (
                    (linkedId && String(linkedId) === String(selectedChoirId)) ||
                    (linkedName && normalizePersonnelName(linkedName) === normalizePersonnelName(selectedChoirName))
                  );
                }) || null;
                const forcedProkantor = selectedChoirTandem?.prokantorName || selectedChoirTandem?.prokantor || selectedChoirTandem?.singerName || null;
                const forcedPemusikPoolRaw = selectedChoirTandem?.pemusikNames || selectedChoirTandem?.pemusik || selectedChoirTandem?.musicians || [];
                const forcedPemusikPool = Array.isArray(forcedPemusikPoolRaw)
                  ? forcedPemusikPoolRaw
                  : String(forcedPemusikPoolRaw || '').split(',').map(value => value.trim()).filter(Boolean);

                const is06_17SP1 = svc.time === '06:00' || (svc.time.includes('17:00') && svc.label.includes('SP 1'));
                const is08 = svc.time === '08:00';
                const is10_17TSK = svc.time === '10:00' || (svc.time.includes('17:00') && !svc.label.includes('SP 1'));
                const is19 = svc.time === '19:00';
                const singerSlots = ['ps_pemandu1'];

                if (
                  next[date].services[svc.id]['ps_pemandu']?.userId &&
                  !next[date].services[svc.id]['ps_pemandu1']?.userId
                ) {
                  next[date].services[svc.id]['ps_pemandu1'] = next[date].services[svc.id]['ps_pemandu'];
                }

                singerSlots.forEach(slotKey => {
                  if (next[date].services[svc.id][slotKey]?.userId) return;

                  // Khusus IKM tetap memakai GP Singer. Selain IKM, prioritaskan prokantor tandeman PS/VG.
                  if (!is19 && forcedProkantor) {
                    const prokantor = personnel.find(person =>
                      normalizePersonnelName(person.name) === normalizePersonnelName(forcedProkantor) &&
                      !getAssignedUserIdsForServiceFrom(next,date,svc.id,slotKey).has(person.id)
                    );
                    if (prokantor) {
                      next[date].services[svc.id][slotKey] = { userId: prokantor.id, status: 'assigned' };
                      assignedToday.add(prokantor.id);
                      return;
                    }
                  }

                  const pool = personnel.filter(person =>
                    (
                      is19
                        ? hasActiveUnit(person, UNITS.GP) && (
                            hasActiveRole(person, 'GP Singer', UNITS.GP) ||
                            hasActiveRole(person, 'Singer', UNITS.GP)
                          )
                        : hasActiveUnit(person, UNITS.MUGER) && (
                            hasActiveRole(person, ROLES.PS_PEMANDU, UNITS.MUGER) ||
                            hasActiveRole(person, 'Pemandu Lagu', UNITS.MUGER)
                          )
                    ) && !getAssignedUserIdsForServiceFrom(next,date,svc.id,slotKey).has(person.id)
                  );
                  const id = pickBestCandidate(pool, slotKey, svc.time);
                  if (id) {
                    next[date].services[svc.id][slotKey] = { userId: id, status: 'assigned' };
                    assignedToday.add(id);
                  }
                });

                if (is19) {
                  if (!next[date].services[svc.id]['ps_tim_musik']?.userId) {
                    const musicTeams=mugerGroups.filter(group=>group.status!=='inactive'&&['MUSIC_TEAM','TIM_MUSIK','MUGER_TEAM'].includes(group.type)&&personnel.filter(person=>(person.musicTeams||[]).some(team=>String(team.id)===String(group.id))).every(person=>!getAssignedUserIdsForServiceFrom(next,date,svc.id,'ps_tim_musik').has(person.id)));
                    if (musicTeams.length > 0) {
                      const existingTeamUsage = {};
                      Object.values(next).forEach(day => {
                        Object.values(day?.services || {}).forEach(service => {
                          const teamId = service?.ps_tim_musik?.userId;
                          if (teamId) existingTeamUsage[teamId] = (existingTeamUsage[teamId] || 0) + 1;
                        });
                      });
                      musicTeams.sort((a, b) =>
                        (existingTeamUsage[a.id] || 0) - (existingTeamUsage[b.id] || 0) ||
                        a.name.localeCompare(b.name, 'id')
                      );
                      next[date].services[svc.id]['ps_tim_musik'] = {
                        userId: musicTeams[0].id,
                        status: 'assigned',
                        assignmentType: 'GROUP',
                      };
                    }
                  }
                } else if (is08) {
                  if (!next[date].services[svc.id]['ps_organis']?.userId) {
                    const orgelNames = ['Jonathan Wibowo', 'Geraldine Supit', 'Ozzy Marpaung', 'Rillo Purba', 'Vicky Andreany', 'Dimu Boeky', 'Michael Loukassy'];
                    let pool = personnel.filter(p => orgelNames.includes(p.name) && !assignedToday.has(p.id));
                    if (forcedPemusikPool.length > 0) {
                      const fp = personnel.filter(p => forcedPemusikPool.includes(p.name) && !assignedToday.has(p.id));
                      if (fp.length > 0) pool = fp;
                    }
                    const id = pickBestCandidate(pool, 'ps_organis', svc.time);
                    if(id) { next[date].services[svc.id]['ps_organis'] = { userId: id, status: 'assigned' }; assignedToday.add(id); }
                  }
                } else if (is06_17SP1) {
                  if (!next[date].services[svc.id]['ps_pemusik1']?.userId) {
                    const specialNames = ['Adelaide Simbolon', 'Mario Hetharia'];
                    let pool = personnel.filter(p => specialNames.includes(p.name) && !assignedToday.has(p.id));
                    if (pool.length === 0) pool = personnel.filter(p => hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER) && !assignedToday.has(p.id));
                    if (forcedPemusikPool.length > 0) {
                      const fp = personnel.filter(p => forcedPemusikPool.includes(p.name) && !assignedToday.has(p.id));
                      if (fp.length > 0) pool = fp;
                    }
                    const id = pickBestCandidate(pool, 'ps_pemusik1', svc.time);
                    if(id) { next[date].services[svc.id]['ps_pemusik1'] = { userId: id, status: 'assigned' }; assignedToday.add(id); }
                  }
                } else if (is10_17TSK) {
                  if (!next[date].services[svc.id]['ps_pemusik1']?.userId && !next[date].services[svc.id]['ps_pemusik2']?.userId) {
                    // Pasangan diambil dari Kelola Muger > Kolaborasi / Tandeman.
                    // Tidak lagi menggunakan daftar nama hardcoded.
                    const TANDEMS = dbMugerTandems;
                    let assignedTandem = false;
                    
                    if (forcedPemusikPool.length > 0) {
                      const p1 = personnel.find(p => forcedPemusikPool.includes(p.name) && !assignedToday.has(p.id));
                      if (p1) {
                        next[date].services[svc.id]['ps_pemusik1'] = { userId: p1.id, status: 'assigned' }; assignedToday.add(p1.id);
                        const pool2 = personnel.filter(p => hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER) && !assignedToday.has(p.id));
                        const p2Id = pickBestCandidate(pool2, 'ps_pemusik2', svc.time);
                        if(p2Id) { next[date].services[svc.id]['ps_pemusik2'] = { userId: p2Id, status: 'assigned' }; assignedToday.add(p2Id); }
                        assignedTandem = true;
                      }
                    }
                    if (!assignedTandem) {
                      const availablePairs = TANDEMS
                        .map(([p1Id, p2Id]) => [personnel.find(p => p.id === p1Id), personnel.find(p => p.id === p2Id)])
                        .filter(([p1, p2]) => p1 && p2 && !assignedToday.has(p1.id) && !assignedToday.has(p2.id))
                        .sort(([a1,a2],[b1,b2]) => {
                          const aScore = (dynamicStats[a1.id]?.monthTotal || 0) + (dynamicStats[a2.id]?.monthTotal || 0);
                          const bScore = (dynamicStats[b1.id]?.monthTotal || 0) + (dynamicStats[b2.id]?.monthTotal || 0);
                          return aScore - bScore || Math.random() - 0.5;
                        });
                      const selectedPair = availablePairs[0];
                      if (selectedPair) {
                        const [p1, p2] = selectedPair;
                        next[date].services[svc.id]['ps_pemusik1'] = { userId: p1.id, status: 'assigned' }; assignedToday.add(p1.id);
                        next[date].services[svc.id]['ps_pemusik2'] = { userId: p2.id, status: 'assigned' }; assignedToday.add(p2.id);
                        [p1,p2].forEach((person,index) => {
                          if (dynamicStats[person.id]) {
                            dynamicStats[person.id].total++;
                            dynamicStats[person.id].monthTotal++;
                            const key = index === 0 ? 'ps_pemusik1' : 'ps_pemusik2';
                            dynamicStats[person.id].positions[key] = (dynamicStats[person.id].positions[key] || 0) + 1;
                            dynamicStats[person.id].times[svc.time] = (dynamicStats[person.id].times[svc.time] || 0) + 1;
                          }
                        });
                        assignedTandem = true;
                      }
                    }
                    if (!assignedTandem) {
                      const pool = personnel.filter(p => hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER) && !assignedToday.has(p.id));
                      const id1 = pickBestCandidate(pool, 'ps_pemusik1', svc.time);
                      if (id1) {
                        next[date].services[svc.id]['ps_pemusik1'] = { userId: id1, status: 'assigned' }; assignedToday.add(id1);
                        const pool2 = personnel.filter(p => hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER) && !assignedToday.has(p.id));
                        const id2 = pickBestCandidate(pool2, 'ps_pemusik2', svc.time);
                        if (id2) {
                          next[date].services[svc.id]['ps_pemusik2'] = { userId: id2, status: 'assigned' }; assignedToday.add(id2);
                        }
                      }
                    }
                  }
                }

              }
            });
          }
        }
        if(unit === 'pelkat' && new Date(date).getDay() === 0) {
          if(!next[date].presbiterPendamping) next[date].presbiterPendamping = {};
          if(!next[date].pendetaPendamping) next[date].pendetaPendamping = {};
          if(!next[date].pemimpinPersiapan) next[date].pemimpinPersiapan = {};
          
          const assignedPelkatToday = new Set();
          
          if(next[date].presbiterPendamping) Object.values(next[date].presbiterPendamping).forEach(slot => { if(slot.userId) assignedPelkatToday.add(slot.userId); });
          if(next[date].pendetaPendamping) Object.values(next[date].pendetaPendamping).forEach(slot => { if(slot.userId) assignedPelkatToday.add(slot.userId); });
          if(next[date].pemimpinPersiapan) Object.values(next[date].pemimpinPersiapan).forEach(slot => { if(slot.userId) assignedPelkatToday.add(slot.userId); });
          if(next[date].pa) Object.values(next[date].pa).forEach(cls => Object.values(cls).forEach(slot => { if(slot.userId) assignedPelkatToday.add(slot.userId); }));
          if(next[date].pt) Object.values(next[date].pt).forEach(cls => Object.values(cls).forEach(slot => { if(slot.userId) assignedPelkatToday.add(slot.userId); }));
          ['pa', 'pt'].forEach(p => {
            if(!next[date].pendetaPendamping[p]?.userId) {
              const pool = personnel.filter(u => hasActiveUnit(u, UNITS.PENDETA) && hasActiveRole(u, ROLES.PENDETA, UNITS.PENDETA) && !assignedPelkatToday.has(u.id));
              const id = pickBestCandidate(pool, `pendeta_${p}`, '08:00');
              if(id) { next[date].pendetaPendamping[p] = { userId: id, status: 'assigned' }; assignedPelkatToday.add(id); }
            }
          });
          ['pa', 'pt'].forEach(p => {
            if(!next[date].pemimpinPersiapan[p]?.userId) {
              const targetUnit = p === 'pa' ? UNITS.PA : UNITS.PT;
              const pool = personnel.filter(u => hasActiveUnit(u, targetUnit) && !assignedPelkatToday.has(u.id));
              const id = pickBestCandidate(pool, `pemimpin_${p}`, 'Jumat');
              if(id) { next[date].pemimpinPersiapan[p] = { userId: id, status: 'assigned'}; assignedPelkatToday.add(id); }
            }
          });
          if(!next[date].pa) next[date].pa = {};
          PELKAT_CONFIG.PA.forEach(c => {
            if(!next[date].presbiterPendamping[c.id]?.userId) {
              const pool = personnel.filter(u => hasActiveUnit(u, UNITS.PRESBITER) && !assignedPelkatToday.has(u.id));
              const id = pickBestCandidate(pool, `pendamping_${c.id}`, '08:00');
              if(id) { next[date].presbiterPendamping[c.id] = { userId: id, status: 'assigned' }; assignedPelkatToday.add(id); }
            }
            if(!next[date].pa[c.id]) next[date].pa[c.id] = {};
            c.slots.forEach(slot => {
              if(!next[date].pa[c.id][slot.key]?.userId) {
                const pool = personnel.filter(u => hasActiveUnit(u, UNITS.PA) && servesPelkatClass(u, c.id) && !assignedPelkatToday.has(u.id));
                const id = pickBestCandidate(pool, `${c.id}_${slot.key}`, '08:00');
                if(id) { next[date].pa[c.id][slot.key] = { userId: id, status: 'assigned'}; assignedPelkatToday.add(id); }
              }
            });
          });
          if(!next[date].pt) next[date].pt = {};
          PELKAT_CONFIG.PT.forEach(c => {
            if(!next[date].presbiterPendamping[c.id]?.userId) {
              const pool = personnel.filter(u => hasActiveUnit(u, UNITS.PRESBITER) && !assignedPelkatToday.has(u.id));
              const id = pickBestCandidate(pool, `pendamping_${c.id}`, '08:00');
              if(id) { next[date].presbiterPendamping[c.id] = { userId: id, status: 'assigned' }; assignedPelkatToday.add(id); }
            }
            if(!next[date].pt[c.id]) next[date].pt[c.id] = {};
            c.slots.forEach(slot => {
              if(!next[date].pt[c.id][slot.key]?.userId) {
                const pool = personnel.filter(u => hasActiveUnit(u, UNITS.PT) && servesPelkatClass(u, c.id) && !assignedPelkatToday.has(u.id));
                const id = pickBestCandidate(pool, `${c.id}_${slot.key}`, '08:00');
                if(id) { next[date].pt[c.id][slot.key] = { userId: id, status: 'assigned'}; assignedPelkatToday.add(id); }
              }
            });
          });
        }
      });
      return next;
    });
    if (hadToDoubleAssign) {
      await showAlert("Tugas berhasil disebar!\n\nPERHATIAN: Karena masalah stok otomatis, ada beberapa petugas yang ditugaskan 2x pada hari ini untuk mencegah slot kosong.");
    } else {
      await showAlert("Sukses! Tugas berhasil disebar dan dirotasi merata tanpa ada yang bertugas ganda di hari yang sama.");
    }
  };
  const handleExport = () => {
    const rows = [["Tanggal", "Jam", "Layanan", "Posisi", "Nama"]];
    const dates = getServiceDatesInMonth(selectedMonth, customServices);
    dates.forEach(d => {
      const svcData = assignments[d]?.services || {};
      const svcsToday = getServicesForDate(d, customServices);
      svcsToday.forEach(s => {
        const sData = svcData[s.id] || {};
        const limit = getServiceConfig(s).actualPCount;
        for(let i=1; i<=limit; i++) if(sData[`p${i}`]) rows.push([d, s.time, s.label, `P${i}`, personnel.find(p=>p.id===sData[`p${i}`]?.userId)?.name]);
      });
    });
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `jadwal_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  // --- IMPORT FILE CSV LOGIC ---
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canEdit) {
      await showAlert('Jadwal ini terkunci (sudah dipublikasikan). Buka kunci edit terlebih dahulu sebelum mengimpor.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const rows = parseCSV(text);
        if (rows.length === 0) {
          setImportReport({ success: 0, errors: ['File kosong atau tidak terbaca.'], fileName: file.name });
          e.target.value = '';
          return;
        }
        const header = rows[0].map(h => h.trim().toLowerCase());
        const dataRows = rows.slice(1);
        const idxTanggal = header.indexOf('tanggal');
        const idxPosisi = header.indexOf('posisi');
        const idxNama = header.indexOf('nama');
        if (idxTanggal === -1 || idxPosisi === -1 || idxNama === -1) {
          setImportReport({
            success: 0,
            errors: ['Format header tidak dikenali. Kolom wajib: Tanggal, Posisi, Nama.'],
            fileName: file.name
          });
          e.target.value = '';
          return;
        }
        const nameToPerson = new Map();
        personnel.forEach(p => {
          const key = (p.name || '').trim().toLowerCase();
          if (key) {
            nameToPerson.set(key, nameToPerson.has(key) ? null : p);
          }
        });
        const updates = [];
        const errors = [];
        dataRows.forEach((cols, i) => {
          const lineNum = i + 2; 
          const date = (cols[idxTanggal] || '').trim();
          const posisi = (cols[idxPosisi] || '').trim();
          const nama = (cols[idxNama] || '').trim();
          if (!date || !posisi || !nama) return; 
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            errors.push(`Baris ${lineNum}: format tanggal "${date}" tidak valid (harus YYYY-MM-DD).`);
            return;
          }
          const posMatch = posisi.match(/^P(\d+)$/i);
          if (!posMatch) {
            errors.push(`Baris ${lineNum}: kolom Posisi "${posisi}" tidak didukung (hanya format P1, P2, dst).`);
            return;
          }
          const slotKey = `p${posMatch[1]}`;
          const svcsOnDate = getServicesForDate(date, customServices);
          if (svcsOnDate.length === 0) {
            errors.push(`Baris ${lineNum}: tidak ada ibadah terjadwal pada tanggal ${date}.`);
            return;
          }
          const idxJam = header.indexOf('jam');
          const idxLayanan = header.indexOf('layanan');
          const jam = idxJam !== -1 ? (cols[idxJam] || '').trim() : '';
          const layanan = idxLayanan !== -1 ? (cols[idxLayanan] || '').trim() : '';
          let svcDef = svcsOnDate.find(s => (jam && s.time === jam) || (layanan && s.label === layanan));
          if (!svcDef) {
            if (svcsOnDate.length === 1) {
              svcDef = svcsOnDate[0];
            } else {
              errors.push(`Baris ${lineNum}: ada ${svcsOnDate.length} ibadah pada ${date}, tidak bisa menentukan mana yang dimaksud tanpa kolom Jam/Layanan yang cocok.`);
              return;
            }
          }
          const { actualPCount } = getServiceConfig(svcDef);
          const slotNum = parseInt(posMatch[1]);
          if (slotNum > actualPCount) {
            errors.push(`Baris ${lineNum}: slot P${slotNum} melebihi kapasitas (${actualPCount}) untuk "${svcDef.label}" pada ${date}.`);
            return;
          }
          const matched = nameToPerson.get(nama.toLowerCase());
          if (matched === undefined) {
            errors.push(`Baris ${lineNum}: nama "${nama}" tidak ditemukan di database petugas.`);
            return;
          }
          if (matched === null) {
            errors.push(`Baris ${lineNum}: nama "${nama}" ambigu (lebih dari satu petugas memiliki nama yang sama). Lewati baris ini.`);
            return;
          }
          updates.push({ date, catId: svcDef.id, key: slotKey, userId: matched.id, rawName: nama, rawPos: posisi });
        });
        if (updates.length === 0) {
          setImportReport({ success: 0, errors: errors.length ? errors : ['Tidak ada baris valid untuk diimpor.'], fileName: file.name });
          e.target.value = '';
          return;
        }
        const confirmMsg = `Ditemukan ${updates.length} penugasan valid untuk diimpor` +
          (errors.length ? `, dan ${errors.length} baris bermasalah (akan dilewati).` : '.') +
          `\n\n! Penugasan yang sudah ada pada slot yang sama akan DITIMPA. Lanjutkan?`;
        if (!await showConfirm(confirmMsg)) {
          e.target.value = '';
          return;
        }
        setAssignments(prev => {
          const next = JSON.parse(JSON.stringify(prev));
          updates.forEach(({ date, catId, key, userId }) => {
            if (!next[date]) next[date] = {};
            if (!next[date].services) next[date].services = {};
            if (!next[date].services[catId]) next[date].services[catId] = {};
            next[date].services[catId][key] = { userId, status: 'assigned' };
          });
          return next;
        });
        setImportReport({ success: updates.length, errors, fileName: file.name });
        triggerPushNotification('Import Selesai', `${updates.length} penugasan berhasil diimpor dari ${file.name}.`);
      } catch (err) {
        setImportReport({ success: 0, errors: [`Gagal membaca file: ${err.message}`], fileName: file.name });
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  };
  const assignmentCounts = useMemo(() => calculateDetailedStats(personnel, assignments, swapRequests, customServices), [assignments, selectedMonth, personnel, swapRequests, customServices]);
  const renderOptions = (filterFn, sortFn = null) => {
    const rows = personnel.filter(filterFn);
    if (sortFn) rows.sort(sortFn);
    return rows.map(p => <option key={p.id} value={p.id}>{formatPersonnelDisplayName(p)} ({assignmentCounts[p.id]?.byMonth[selectedMonth] || 0})</option>);
  };
  const renderMugerDailyView = () => {
    const dates = getServiceDatesInMonth(selectedMonth, customServices);
    const musicTeams = mugerGroups.filter(group =>
      group.status !== 'inactive' &&
      ['MUSIC_TEAM', 'TIM_MUSIK', 'MUGER_TEAM'].includes(group.type)
    );
    const personnelChoirGroups = personnel
      .filter(person =>
        String(person.status || 'active').toLowerCase() !== 'inactive' &&
        hasActiveRole(person, ROLES.PS_CHOIR)
      )
      .map(person => ({
        id: person.id,
        name: person.name,
        source: 'PERSONNEL',
      }));
    const choirChoices = [
      // PS/VG yang dimasukkan melalui Master Petugas
      ...personnelChoirGroups,
    
      // PS/VG dari groups
      ...mugerGroups
        .filter(group =>
          group.status !== 'inactive' &&
          [
            'CHOIR',
            'PS',
            'VG',
            'VOCAL_GROUP',
            'PADUAN_SUARA',
            'PS_VG',
          ].includes(String(group.type || '').toUpperCase())
        )
        .map(group => ({
          id: group.id,
          name: group.name,
          source: 'GROUP',
        })),
      
      // PS/VG dari collaboration
      ...mugerCollaborations
        .filter(item =>
          [
            'CHOIR',
            'PS',
            'VG',
            'PS_VG',
            'VOCAL_GROUP',
            'PADUAN_SUARA',
          ].includes(String(item.type || '').toUpperCase())
        )
        .map(item => ({
          id: item.groupId || item.choirId || item.id,
          name:
            item.groupName ||
            item.choirName ||
            item.name ||
            item.title ||
            item.id,
          source: 'COLLABORATION',
        })),
    ].filter(
      (item, index, rows) =>
        item.name &&
        rows.findIndex(
          other =>
            normalizePersonnelName(other.name) ===
            normalizePersonnelName(item.name)
        ) === index
    );
    const toggleDate = date => {
      setExpandedDates(current => {
        const next = new Set(current);
        if (next.has(date)) next.delete(date);
        else next.add(date);
        return next;
      });
    };

    const toggleService = key => {
      setExpandedServices(current => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    const personSelect = (date,svc,slotKey,label,filterFn) => {
      const selectedId=getVal(date,'services',svc.id,slotKey);
      const options=personnel.filter(person=>filterFn(person)&&(String(person.id)===String(selectedId)||isAvailableForService(person,date,svc.id,slotKey)))
        .sort((a,b)=>a.name.localeCompare(b.name,'id')).map(person=>({value:person.id,label:`${formatPersonnelDisplayName(person)} (${assignmentCounts[person.id]?.byMonth[selectedMonth]||0})`}));
      const editable = canEditSlot(date, svc, slotKey, 'muger');
      return <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
        <SearchableSelect disabled={!editable} value={selectedId} options={options} onChange={value=>updateAssignment(date,'services',svc.id,slotKey,value)}/></label>;
    };
    const groupSelect = (date,svc,slotKey,label,rows) => {
      const selectedId=getVal(date,'services',svc.id,slotKey);
      const options=rows.filter(row=>String(row.id)===String(selectedId)||!mugerGroups.some(group=>String(group.id)===String(row.id))||canUseGroupForService(row.id,date,svc.id,slotKey)).map(row=>({value:row.id,label:row.name}));
      const editable = canEditSlot(date, svc, slotKey, 'muger');
      return <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">{label}</span>
        <SearchableSelect disabled={!editable} value={selectedId} options={options} onChange={value=>updateAssignment(date,'services',svc.id,slotKey,value)}/></label>;
    };

    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          Jadwal ditampilkan per hari dan per jenis ibadah. Tim Musik serta PS/VG
          dipilih sebagai grup, sedangkan Pemandu Lagu diambil dari GP Singer aktif.
        </div>

        {dates.map((date, dateIndex) => {
          const services = getServicesForDate(date, customServices);
          const isOpen = expandedDates.has(date) || (expandedDates.size === 0 && dateIndex === 0);

          return (
            <section key={date} className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => toggleDate(date)}
                className="flex w-full items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
              >
                <div>
                  <div className="font-bold text-gray-800">{formatDateIndo(date)}</div>
                  <div className="text-xs text-gray-500">{services.length} jenis ibadah</div>
                </div>
                <ChevronDown className={`h-5 w-5 transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="space-y-3 p-3 sm:p-4">
                  {services.map(svc => {
                    const serviceKey = `${date}__${svc.id}`;
                    const serviceOpen =
                      expandedServices.has(serviceKey) ||
                      (expandedServices.size === 0 && services[0]?.id === svc.id);
                    const is19 = String(svc.time).startsWith('19:');
                    const is08 = String(svc.time).startsWith('08:');
                    const is10 = String(svc.time).startsWith('10:');
                    const is17 = String(svc.time).startsWith('17:');
                    const isSP1 = /sp\s*1|tambak/i.test(String(svc.label || ''));
                    const countKey = `${date}__${svc.id}`;
                    const existingSingerCount = [1,2,3,4].filter(i => getVal(date, 'services', svc.id, `ps_pemandu${i}`)).length;
                    const singerCount = Math.max(1, mugerSingerCounts[countKey] || existingSingerCount || 1);
                    const singerSlots = Array.from({ length: Math.min(4, singerCount) }, (_, i) => `ps_pemandu${i + 1}`);
                    const existingChoirCount = [1,2,3].filter(i => getVal(date, 'services', svc.id, `ps_vg${i}_name`)).length;
                    const choirCount = Math.max(1, mugerChoirCounts[countKey] || existingChoirCount || 1);

                    return (
                      <div key={serviceKey} className="overflow-visible rounded-xl border border-gray-200">
                        <button
                          type="button"
                          onClick={() => toggleService(serviceKey)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-blue-50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-blue-100 px-3 py-2 text-sm font-bold text-blue-700">
                              {svc.time}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-800">{svc.label}</div>
                              <div className="text-xs text-gray-500">
                                {is19 ? 'Pemandu Lagu GP Singer · Tim Musik' : 'Pemandu Lagu Muger'}{svc.isCommunion ? ' · Perjamuan Kudus' : ''}
                              </div>
                            </div>
                          </div>
                          <ChevronDown className={`h-5 w-5 transition ${serviceOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {serviceOpen && (
                          <div className="border-t border-gray-200 bg-gray-50/50 p-4">
                            <div className="grid gap-5 xl:grid-cols-2">
                              <div className="rounded-xl border border-purple-100 bg-white p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <h4 className="font-bold text-purple-800">Pemandu Lagu</h4>
                                  {canEditSlot(date, svc, 'ps_pemandu1', 'muger') && singerCount < 4 && <button type="button" onClick={() => setMugerSingerCounts(v => ({...v, [countKey]: singerCount + 1}))} className="inline-flex items-center gap-1 rounded-lg border border-purple-200 px-2 py-1 text-xs font-bold text-purple-700 hover:bg-purple-50"><Plus className="h-3.5 w-3.5"/> Tambah</button>}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {singerSlots.map((slotKey, index) => personSelect(
                                    date, svc, slotKey, `Pemandu Lagu ${index + 1}`,
                                    person => is19
                                      ? hasActiveUnit(person, UNITS.GP) && (hasActiveRole(person, 'GP Singer', UNITS.GP) || hasActiveRole(person, 'Singer', UNITS.GP))
                                      : hasActiveUnit(person, UNITS.MUGER) && (hasActiveRole(person, ROLES.PS_PEMANDU, UNITS.MUGER) || hasActiveRole(person, 'Pemandu Lagu', UNITS.MUGER))
                                  ))}
                                </div>
                              </div>

                              <div className="rounded-xl border border-emerald-100 bg-white p-4">
                                <h4 className="mb-3 font-bold text-emerald-800">Musik</h4>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {is08 && personSelect(
                                    date, svc, 'ps_organis', 'Organis',
                                    person =>
                                      hasActiveUnit(person, UNITS.MUGER) &&
                                      (
                                        hasActiveRole(person, ROLES.PS_ORGANIS, UNITS.MUGER) ||
                                        hasActiveRole(person, ROLES.PS_PEMUSIK, UNITS.MUGER)
                                      )
                                  )}
                                  {!is19 && personSelect(
                                    date, svc, 'ps_pemusik1', 'Pemusik 1',
                                    person =>
                                      hasActiveUnit(person, UNITS.MUGER) &&
                                      hasActiveRole(person, ROLES.PS_PEMUSIK, UNITS.MUGER)
                                  )}
                                  {!is19 && (is10 || (is17 && !isSP1)) && personSelect(
                                    date, svc, 'ps_pemusik2', 'Pemusik 2',
                                    person =>
                                      hasActiveUnit(person, UNITS.MUGER) &&
                                      hasActiveRole(person, ROLES.PS_PEMUSIK, UNITS.MUGER)
                                  )}
                                  {is19 && groupSelect(
                                    date, svc, 'ps_tim_musik', 'Tim Musik', musicTeams
                                  )}
                                </div>
                              </div>
                            </div>

                            {!svc.isCommunion && <div className="mt-5 rounded-xl border border-orange-100 bg-white p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <h4 className="font-bold text-orange-800">Paduan Suara / Vocal Group</h4>
                                {canEditSlot(date, svc, 'ps_vg1_name', 'muger') && choirCount < 3 && <button type="button" onClick={() => setMugerChoirCounts(v => ({...v, [countKey]: choirCount + 1}))} className="inline-flex items-center gap-1 rounded-lg border border-orange-200 px-2 py-1 text-xs font-bold text-orange-700 hover:bg-orange-50"><Plus className="h-3.5 w-3.5"/> Tambah PS/VG</button>}
                              </div>
                              <div className="space-y-3">
                                {Array.from({length: Math.min(3, choirCount)}, (_,i) => i+1).map(i => (
                                  <div key={i} className="rounded-lg border border-orange-100 bg-orange-50/40 p-3">
                                    <div className="mb-2 text-xs font-bold text-orange-700">PS/VG {i}</div>
                                    <div className="grid gap-3 lg:grid-cols-3">
                                      {groupSelect(date, svc, `ps_vg${i}_name`, 'Nama PS/VG', choirChoices)}
                                      <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Perkiraan Jumlah Orang</span><input disabled={!canEditSlot(date, svc, `ps_vg${i}_est`, 'muger')} type="number" min="1" value={getVal(date,'services',svc.id,`ps_vg${i}_est`)} onChange={e=>updateAssignment(date,'services',svc.id,`ps_vg${i}_est`,e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"/></label>
                                      <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Solois</span><select disabled={!canEditSlot(date, svc, `ps_vg${i}_soloist`, 'muger')} value={getVal(date,'services',svc.id,`ps_vg${i}_soloist`)} onChange={e=>updateAssignment(date,'services',svc.id,`ps_vg${i}_soloist`,e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"><option value="">- Pilih -</option><option value="Y">Ada</option><option value="N">Tidak Ada</option></select></label>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  const renderIbadahTab = () => {
    const monthDates = getServiceDatesInMonth(selectedMonth, customServices);
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-blue-900">Kalender Ibadah</h3>
            <p className="text-sm text-blue-700">Atur jenis ibadah per tanggal, serta tambah atau edit ibadah khusus.</p>
          </div>
          {canEdit && <button onClick={() => openAddCustomService()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4"/> Tambah Ibadah</button>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {monthDates.map(date => {
            const setting = getDateServiceSetting(date, customServices);
            const isCommunion = setting?.serviceMode === 'HOLY_COMMUNION';
            return (
              <div key={date} className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">{formatDateIndo(date)}</div>
                    <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${isCommunion ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {isCommunion ? 'Sakramen Perjamuan Kudus' : 'Ibadah Reguler'}
                    </div>
                  </div>
                  {canEdit && <button onClick={() => openDateSetting(date)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50"><Edit3 className="h-3.5 w-3.5"/> Edit</button>}
                </div>
                <div className="space-y-2">
                  {getServicesForDate(date, customServices).map(svc => (
                    <div key={svc.id} className="rounded-lg bg-gray-50 p-3">
                      <div className="flex justify-between gap-2">
                        <div>
                          <div className="font-semibold">{svc.label}</div>
                          <div className="text-xs text-gray-500">{svc.time} · {svc.location || 'Gedung Gereja'}</div>
                        </div>
                        {svc.isCustom && canEdit && (
                          <div className="flex items-start gap-1">
                            <button onClick={() => openEditCustomService(date, svc)} className="rounded p-1 text-blue-600 hover:bg-blue-50" title="Edit ibadah"><Edit3 className="h-4 w-4"/></button>
                            <button onClick={() => handleDeleteCustomService(date, svc.id, svc.label)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Hapus ibadah"><Trash2 className="h-4 w-4"/></button>
                          </div>
                        )}
                      </div>
                      {svc.notes && <p className="mt-2 text-xs text-gray-600">{svc.notes}</p>}
                      <div className="mt-2 text-[11px] font-semibold text-blue-600">Live streaming: {svc.isLivestream ? 'Ya' : 'Tidak'}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const ALL_PETUGAS_SLOT_ORDER = {
    ps_organis: 101,
    ps_pemandu: 102,
    ps_pemandu1: 102,
    ps_pemusik1: 103,
    ps_pemusik2: 104,
    ps_tim_musik: 105,
    ps_vg1_name: 106,
    ps_vg2_name: 107,
    ps_vg3_name: 108,
    mm_pic: 201,
    mm_slide: 202,
    mm_cam1: 203,
    mm_cam2: 204,
    mm_cam3: 205,
    mm_switch: 206,
    sound1: 301,
    sound2: 302,
  };

  const getAllPetugasSlotOrder = key => {
    const presbiterMatch = String(key).match(/^p(\d+)$/i);
    if (presbiterMatch) return Number(presbiterMatch[1]);
    return ALL_PETUGAS_SLOT_ORDER[key] ?? 9999;
  };

  const getAllPetugasSlotLabel = key => {
    const labels = {
      ps_organis: 'Organis',
      ps_pemandu: 'Pemandu Lagu',
      ps_pemandu1: 'Pemandu Lagu',
      ps_pemusik1: 'Pemusik 1',
      ps_pemusik2: 'Pemusik 2',
      ps_tim_musik: 'Tim Musik',
      ps_vg1_name: 'PS/VG 1',
      ps_vg2_name: 'PS/VG 2',
      ps_vg3_name: 'PS/VG 3',
      mm_pic: 'PIC Multimedia',
      mm_slide: 'Slide',
      mm_cam1: 'Camera 1',
      mm_cam2: 'Camera 2',
      mm_cam3: 'Camera 3',
      mm_switch: 'Switcher',
      sound1: 'Sound 1',
      sound2: 'Sound 2',
    };
    const presbiterMatch = String(key).match(/^p(\d+)$/i);
    if (presbiterMatch) return `P${presbiterMatch[1]}`;
    return labels[key] || String(key).replaceAll('_', ' ');
  };

  const renderAllPetugasTab = () => {
    const monthDates = getServiceDatesInMonth(selectedMonth, customServices);
    const nameOf = value => {
      const person = personnel.find(p => String(p.id) === String(value));
      if (person) return formatPersonnelDisplayName(person);
      const group = mugerGroups.find(g =>
        [g.id, g.groupId, g.code, g.teamId].some(id => String(id || '') === String(value))
      );
      return group?.name || group?.groupName || group?.timName || '-';
    };

    return (
      <div className="space-y-4">
        {monthDates.map(date => (
          <section key={date} className="rounded-xl border bg-white shadow-sm">
            <div className="border-b bg-gray-50 px-4 py-3 font-bold">{formatDateIndo(date)}</div>
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {getServicesForDate(date, customServices).map(svc => {
                const slots = assignments[date]?.services?.[svc.id] || {};
                const filled = Object.entries(slots)
                  .filter(([, value]) => value?.userId)
                  .sort(([keyA], [keyB]) => {
                    const orderDiff = getAllPetugasSlotOrder(keyA) - getAllPetugasSlotOrder(keyB);
                    return orderDiff || keyA.localeCompare(keyB);
                  });

                return (
                  <div key={svc.id} className="rounded-lg border p-3">
                    <div className="font-bold text-blue-800">{svc.time} · {svc.label}</div>
                    {filled.length ? (
                      <div className="mt-2 grid gap-1 text-xs">
                        {filled.map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-3 border-b py-1">
                            <span className="text-gray-500">{getAllPetugasSlotLabel(key)}</span>
                            <span className="text-right font-semibold">{nameOf(value.userId)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs italic text-gray-400">Belum ada petugas.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  };

  const renderMatrix = () => {
    if (activeUnitTab === 'ibadah') return renderIbadahTab();
    if (activeUnitTab === 'all_petugas') return renderAllPetugasTab();
    if (activeUnitTab === 'muger') return renderMugerDailyView();
    const dates = getServiceDatesInMonth(selectedMonth, customServices);
    let columns = [];
    if(activeUnitTab === 'presbiter') columns = Array.from({length: presbiterCount}, (_,i)=>({id: `p${i+1}`, label: `P${i+1}`, type: 'select'}));
    else if(activeUnitTab === 'multimedia') columns = [{id:'mm_slide', label: 'Slide', type:'select'}, {id:'mm_cam1', label:'Cam 1', type: 'select'}, {id:'mm_cam2', label:'Cam 2', type:'select'}, {id:'mm_cam3', label: 'Cam 3', type: 'select'}, {id:'mm_switch', label: 'Switcher', type:'select'}, {id: 'mm_pic', label: 'PIC', type: 'select'}];
    else if(activeUnitTab === 'sound') columns = [{id: 'sound1', label: 'Operator 1', type:'select'}, {id:'sound2', label: 'Operator 2', type:'select'}];
    else if(activeUnitTab === 'muger') columns = [
      {id:'ps_organis', label:'Organis (08.00)', type: 'select'},
      {id:'ps_pemandu', label: 'Pemandu Lagu', type:'select'},
      {id:'ps_pemusik1', label: 'Pemusik 1', type: 'select'},
      {id:'ps_pemusik2', label: 'Pemusik 2 (10/17)', type:'select'},
      {id:'ps_tim_musik', label: 'Tim Musik (19.00)', type:'select'},
      {id:'ps_vg1_name', label: 'PS/VG 1 (Sblm Khotbah)', type:'select'},
      {id:'ps_vg1_est', label:'Est. Jml 1', type:'text'},
      {id:'ps_vg1_soloist', label: 'Solois 1', type: 'select_yn'},
      {id:'ps_vg1_instr', label:'Alat Musik 1', type:'text'},
      {id:'ps_vg2_name', label:'PS/VG 2 (Stlh Doa)', type: 'select'},
      {id:'ps_vg2_est', label: 'Est. Jml 2', type:'text'},
      {id:'ps_vg2_soloist', label: 'Solois 2', type: 'select_yn'},
      {id:'ps_vg2_instr', label: 'Alat Musik 2', type: 'text'},
      {id:'ps_vg3_name', label: 'PS/VG 3 (Stlh Doa)', type:'select'},
      {id:'ps_vg3_est', label:'Est. Jml 3', type:'text'},
      {id:'ps_vg3_soloist', label: 'Solois 3', type: 'select_yn'},
      {id:'ps_vg3_instr', label:'Alat Musik 3', type:'text'}
    ];
    if(activeUnitTab === 'pelkat') {
      return (
        <div className="space-y-4 sm:space-y-8 overflow-x-auto w-full pb-4">
          {dates.filter(d => new Date(d).getDay() === 0).map(date => (
            <div key={date} className="bg-white p-4 rounded-xl border border-gray-200 min-w-[800px] shadow-sm">
              <div className="font-bold mb-4 flex justify-between bg-blue-100 p-3 rounded-lg text-blue-800 text-sm shadow-sm">
                <span className="flex items-center"><Calendar className="w-4 h-4 mr-2" />{formatDateIndo(date)} (08:00 WIB)</span>
                <span className="text-xs font-medium uppercase bg-white px-2 py-1 rounded text-blue-600">Ibadah Pelkat</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h5 className="text-sm font-bold text-gray-800 mb-1">Pelkat PA</h5>
                  <div className="border border-gray-400 bg-gray-50 p-3 space-y-2 text-xs rounded-lg">
                    <h6 className="text-xs font-bold text-gray-600 mb-2">Persiapan Jumat</h6>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Ruang</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900">Ruang 2A</span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-1/3 font-medium text-gray-700">Pendeta Pendamping</span>
                      <span className="w-4 text-center">:</span>
                      <div className="w-2/3">
                        <select disabled={!canEdit} className="w-full border border-gray-300 rounded p-1 bg-white focus:bg-white" value={getVal(date, 'pendetaPendamping', 'pa', 'pendamping')} onChange={e=>updateAssignment(date, 'pendetaPendamping', 'pa', 'pendamping', e.target.value)}>
                          <option value="">[nama Pendeta]</option>
                          {renderOptions(p=>(p.roles || []).includes(ROLES.PENDETA))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="w-1/3 font-medium text-gray-700">Pemimpin Persiapan</span>
                      <span className="w-4 text-center">:</span>
                      <div className="w-2/3">
                        <select disabled={!canEdit} className="w-full border border-gray-300 rounded p-1 bg-white focus:bg-white" value={getVal(date, 'pemimpinPersiapan', 'pa', 'pemimpin')} onChange={e=>updateAssignment(date, 'pemimpinPersiapan', 'pa', 'pemimpin', e.target.value)}>
                          <option value="">[nama kakak layan]</option>
                          {renderOptions(p=>(p.units || []).includes(UNITS.PA))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h5 className="text-sm font-bold text-gray-800 mb-1">Pelkat PT</h5>
                  <div className="border border-gray-400 bg-gray-50 p-3 space-y-2 text-xs rounded-lg">
                    <h6 className="text-xs font-bold text-gray-600 mb-2">Persiapan Jumat</h6>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Ruang</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900">Ruang 2B</span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-1/3 font-medium text-gray-700">Pendeta Pendamping</span>
                      <span className="w-4 text-center">:</span>
                      <div className="w-2/3">
                        <select disabled={!canEdit} className="w-full border border-gray-300 rounded p-1 bg-white focus:bg-white" value={getVal(date, 'pendetaPendamping', 'pt', 'pendamping')} onChange={e=>updateAssignment(date, 'pendetaPendamping', 'pt', 'pendamping', e.target.value)}>
                          <option value="">[nama Pendeta]</option>
                          {renderOptions(p=>(p.roles || []).includes(ROLES.PENDETA))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <span className="w-1/3 font-medium text-gray-700">Pemimpin Persiapan</span>
                      <span className="w-4 text-center">:</span>
                      <div className="w-2/3">
                        <select disabled={!canEdit} className="w-full border border-gray-300 rounded p-1 bg-white focus:bg-white" value={getVal(date, 'pemimpinPersiapan', 'pt', 'pemimpin')} onChange={e=>updateAssignment(date, 'pemimpinPersiapan', 'pt', 'pemimpin', e.target.value)}>
                          <option value="">[nama kakak layan]</option>
                          {renderOptions(p=>(p.units || []).includes(UNITS.PT))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-green-200 p-4 rounded-lg bg-green-50/30">
                  <h5 className="text-sm font-bold text-green-700 border-b border-green-200 pb-2 mb-4 flex items-center"><Users className="w-4 h-4 mr-2"/> Pelayanan Anak (PA)</h5>
                  <div className="space-y-4">
                    {PELKAT_CONFIG.PA.map(c => (
                      <div key={c.id} className="bg-white p-3 rounded border border-green-100 shadow-sm mb-3">
                        <div className="flex justify-between items-start mb-2 border-b border-gray-100 pb-1">
                          <div>
                            <span className="text-xs font-bold text-gray-800 block">{c.label}</span>
                            {c.room && <span className="text-[10px] text-gray-500 block mt-0.5">{c.room}</span>}
                          </div>
                          <span className="text-[10px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">{c.slots.length} Petugas</span>
                        </div>
                        <div className="mb-3 border-b border-gray-100 pb-2">
                          <label className="block text-[9px] text-yellow-700 font-bold mb-1">Pnt/Dkn Pendamping</label>
                          <select disabled={!canEdit} className="w-full border text-[10px] sm:text-xs rounded p-1 bg-yellow-50 border-yellow-200 focus:bg-white" value={getVal(date, 'presbiterPendamping', c.id, 'pendamping')} onChange={e=>updateAssignment(date, 'presbiterPendamping', c.id, 'pendamping', e.target.value)}>
                            <option value="">- Pilih Pnt/Dkn -</option>
                            {renderOptions(p=>(p.units || []).includes(UNITS.PRESBITER))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {c.slots.map(s => (
                            <div key={s.key}>
                              <label className="block text-[9px] text-gray-500 mb-1">{s.label}</label>
                              <select disabled={!canEdit} className="w-full border text-[10px] sm:text-xs rounded p-1 bg-gray-50 focus:bg-white" value={getVal(date, 'pa', c.id, s.key)} onChange={e=>updateAssignment(date, 'pa', c.id, s.key, e.target.value)}>
                                <option value="">- Pilih -</option>
                                {renderOptions(p => servesPelkatClass(p, c.id))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border border-orange-200 p-4 rounded-lg bg-orange-50/30">
                  <h5 className="text-sm font-bold text-orange-700 border-b border-orange-200 pb-2 mb-4 flex items-center"><Users className="w-4 h-4 mr-2"/> Persekutuan Teruna (PT)</h5>
                  <div className="space-y-4">
                    {PELKAT_CONFIG.PT.map(c => (
                      <div key={c.id} className="bg-white p-3 rounded border border-orange-100 shadow-sm mb-3">
                        <div className="flex justify-between items-center mb-2 border-b border-gray-100 pb-1">
                          <span className="text-xs font-bold text-gray-800">{c.label}</span>
                          <span className="text-[10px] bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full font-medium">{c.slots.length} Petugas</span>
                        </div>
                        <div className="mb-3 border-b border-gray-100 pb-2">
                          <label className="block text-[9px] text-yellow-700 font-bold mb-1">Pnt/Dkn Pendamping</label>
                          <select disabled={!canEdit} className="w-full border text-[10px] sm:text-xs rounded p-1 bg-yellow-50 border-yellow-200 focus:bg-white" value={getVal(date, 'presbiterPendamping', c.id, 'pendamping')} onChange={e=>updateAssignment(date, 'presbiterPendamping', c.id, 'pendamping', e.target.value)}>
                            <option value="">- Pilih Pnt/Dkn -</option>
                            {renderOptions(p=>(p.units || []).includes(UNITS.PRESBITER))}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {c.slots.map(s => (
                            <div key={s.key}>
                              <label className="block text-[9px] text-gray-500 mb-1">{s.label}</label>
                              <select disabled={!canEdit} className="w-full border text-[10px] sm:text-xs rounded p-1 bg-gray-50 focus:bg-white" value={getVal(date, 'pt', c.id, s.key)} onChange={e=>updateAssignment(date, 'pt', c.id, s.key, e.target.value)}>
                                <option value="">- Pilih -</option>
                                {renderOptions(p => servesPelkatClass(p, c.id))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    const slideCreatorNames = ['Samuel Hetarie', 'Anathadya Sompotan', 'Tasya Samallo', 'Louise Anugrahani'];
    const slideCreatorOptions = personnel.filter(person =>
      slideCreatorNames.some(name => normalizePersonnelName(name) === normalizePersonnelName(person.name))
    );

    return (
      <div className="w-full pb-4">
        {activeUnitTab === 'multimedia' && (
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dates.map(date => {
              const customRows=getCustomServicesOnly(date, customServices);
              const hasSundayService=getServicesForDate(date,customServices).some(svc=>!svc.isCustom&&/ibadah hari minggu/i.test(String(svc.label||'')));
              const slideOptions=slideCreatorOptions.map(person=>({value:person.id,label:formatPersonnelDisplayName(person)}));
              if(!hasSundayService&&!customRows.length)return null;
              return <div key={`creator-${date}`} className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="mb-3 font-bold text-blue-900">{formatDateIndo(date)}</div>
                {hasSundayService&&<label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Pembuat Slide Ibadah Hari Minggu</span>
                  <SearchableSelect disabled={!canEdit} value={getVal(date,'multimediaDaily','daily','slide_creator')} options={slideOptions}
                    onChange={value=>updateAssignment(date,'multimediaDaily','daily','slide_creator',value)}/>
                  <span className="mt-1 block text-[11px] text-gray-500">Satu petugas untuk seluruh Ibadah Hari Minggu pada tanggal ini.</span></label>}
                {customRows.map((svc,index)=><label key={svc.id} className={`${hasSundayService||index?'mt-3 border-t border-blue-100 pt-3':''} block`}>
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Pembuat Slide · {svc.label} ({svc.time})</span>
                  <SearchableSelect disabled={!canEdit} value={getVal(date,'services',svc.id,'slide_creator')}
                    options={slideOptions.filter(option=>{const person=personnel.find(row=>row.id===option.value);return !person||String(option.value)===String(getVal(date,'services',svc.id,'slide_creator'))||isAvailableForService(person,date,svc.id,'slide_creator');})}
                    onChange={value=>updateAssignment(date,'services',svc.id,'slide_creator',value)}/></label>)}
              </div>;
            })}
          </div>
        )}
        <div className="w-full overflow-x-auto">
        <table className="min-w-max w-full text-[10px] sm:text-xs border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-1 sm:p-2 border sticky left-0 bg-gray-100 min-w-[120px] sm:min-w-[150px]">Tanggal / Jam</th>
              {columns.map(c=><th key={c.id} className="p-1 sm:p-2 border min-w-[100px] sm:min-w-[120px]">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {dates.map(date => (
              <React.Fragment key={date}>
                {getServicesForDate(date, customServices).map(svc => {
                  const config = getServiceConfig(svc);
                  const actualPCount = config.actualPCount;
                  const isIKM = config.isIKM;
                  return (
                    <tr key={`${date}-${svc.id}`} className="hover:bg-gray-50">
                      <td className="p-1 sm:p-2 border sticky left-0 bg-white font-medium">
                        <div className="flex justify-between items-start">
                          <div>
                            {formatDateShort(date)} <span className="text-gray-500">{svc.time}</span> <br/>
                            <span className={`text-[8px] sm:text-[9px] whitespace-nowrap ${svc.isCustom ? 'text-emerald-600 font-bold' : 'text-blue-600'}`}>{svc.label}</span>
                          </div>
                          {svc.isCustom && canEdit && (
                            <div className="ml-1 flex flex-shrink-0 gap-1">
                              <button onClick={() => openEditCustomService(date, svc)} className="rounded p-1 text-blue-600 hover:bg-blue-50" title="Edit Ibadah Khusus Ini"><Edit3 className="h-3 w-3" /></button>
                              <button onClick={() => handleDeleteCustomService(date, svc.id, svc.label)} className="rounded p-1 text-red-500 hover:bg-red-50" title="Hapus Ibadah Khusus Ini"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>
                      </td>
                      {columns.map(col => {
                        const colNumMatch = col.id.match(/^p(\d+)$/);
                        const colNum = colNumMatch ? parseInt(colNumMatch[1]) : 0;
                        const isOutOfRange = activeUnitTab === 'presbiter' && colNum > 0 && colNum > actualPCount;
                        const isClosedMultimedia = activeUnitTab === 'multimedia' && !getMultimediaKeysForService(svc).includes(col.id);
                        
                        if (isOutOfRange || isClosedMultimedia) {
                          return <td key={col.id} className="p-0.5 sm:p-1 border bg-gray-200 text-center text-gray-400 font-bold text-[8px] sm:text-[10px]">TUTUP</td>;
                        }
                        const filter = (p) => {
                          const selectedValue=getVal(date,'services',svc.id,col.id);
                          if(activeUnitTab!=='presbiter'&&String(p.id)!==String(selectedValue)&&!isAvailableForService(p,date,svc.id,col.id))return false;
                          if (activeUnitTab === 'presbiter') {
                            const isGP = isIKM && !svc.isCommunion && (colNum >= 2 && colNum <= 4);
                            if (isGP) return (p.units || []).includes(UNITS.GP);
                            if ((p.units || []).includes(UNITS.PRESBITER)) {
                              if (colNum === 1) return hasActiveRole(p, ROLES.PENATUA, UNITS.PRESBITER);
                              if (!isIKM && colNum === 2) return hasActiveRole(p, ROLES.PENATUA, UNITS.PRESBITER);
                              if (!isIKM && colNum === 4) return hasActiveRole(p, ROLES.DIAKEN, UNITS.PRESBITER);
                              if (isIKM && !svc.isCommunion && (colNum >= 2 && colNum <= 4)) return false; 
                              return true;
                            }
                            return false;
                          }
                          if(activeUnitTab==='multimedia') {
                            const memberships = normalizeMemberships(p);
                            const hasActiveUnit = memberships.unitMemberships.some(
                              unit =>
                                normalizeRoleToken(unit.name) === normalizeRoleToken(UNITS.MULTIMEDIA) &&
                                String(unit.status || 'active').toLowerCase() !== 'inactive'
                            );

                            if (!hasActiveUnit || !canServeMultimediaService(p, svc)) return false;

                            const personWithMemberships = {
                              ...p,
                              roleMemberships: memberships.roleMemberships,
                            };

                            if(col.id === 'mm_slide') {
                              return hasActiveMultimediaRole(personWithMemberships, ROLES.MM_SLIDE);
                            }
                            if(col.id.startsWith('mm_cam')) {
                              return hasActiveMultimediaRole(personWithMemberships, ROLES.MM_CAM);
                            }
                            if(col.id === 'mm_switch') {
                              return hasActiveMultimediaRole(personWithMemberships, ROLES.MM_SWITCH);
                            }
                            if(col.id === 'mm_pic') {
                              return hasActiveMultimediaRole(personWithMemberships, ROLES.MM_PIC);
                            }
                            return true;
                          }
                          if(activeUnitTab==='sound') return (p.units || []).includes(UNITS.SOUND);
                          if(activeUnitTab==='muger') {
                            if(col.id === 'ps_organis') return hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER);
                            if(col.id === 'ps_pemandu') return hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMANDU, UNITS.MUGER);
                            if(col.id === 'ps_pemusik1' || col.id === 'ps_pemusik2') return hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_PEMUSIK, UNITS.MUGER);
                            if(col.id === 'ps_tim_musik') return hasActiveUnit(p, UNITS.MUGER) && hasActiveRole(p, ROLES.PS_TIM_MUSIK, UNITS.MUGER);
                            return (p.roles || []).includes(ROLES.PS_CHOIR);
                          }
                          return true;
                        }
                        return (
                          <td key={col.id} className="p-0.5 sm:p-1 border">
                            {col.type === 'text' ? (
                              <DebouncedInput disabled={!canEditSlot(date, svc, col.id, activeUnitTab)} className="w-full border-b border-gray-300 bg-transparent text-[10px] sm:text-xs px-1 py-1 focus:outline-none focus:border-blue-500" value={getVal(date, 'services', svc.id, col.id)} onChange={val => updateAssignment(date, 'services', svc.id, col.id, val)} placeholder={col.label} />
                            ) : col.type === 'select_yn' ? (
                              <select disabled={!canEditSlot(date, svc, col.id, activeUnitTab)} className="w-full border-none bg-transparent text-[10px] sm:text-xs" value={getVal(date, 'services', svc.id, col.id)} onChange={e=>updateAssignment(date, 'services', svc.id, col.id, e.target.value)}>
                                <option value="">- Y/N -</option>
                                <option value="Y">Ya</option>
                                <option value="N">Tidak</option>
                              </select>
                            ) : (
                              <SearchableSelect
                                disabled={!canEditSlot(date, svc, col.id, activeUnitTab)}
                                value={getVal(date, 'services', svc.id, col.id)}
                                placeholder="- Pilih -"
                                options={personnel
                                  .filter(filter)
                                  .sort(activeUnitTab === 'multimedia' && isTambakService(svc)
                                    ? (a, b) => Number(isDedicatedTambakMultimedia(b)) - Number(isDedicatedTambakMultimedia(a)) || (a.name || '').localeCompare(b.name || '', 'id')
                                    : (a, b) => (a.name || '').localeCompare(b.name || '', 'id'))
                                  .map(person => ({
                                    value: person.id,
                                    label: `${formatPersonnelDisplayName(person)} (${assignmentCounts[person.id]?.byMonth[selectedMonth] || 0})`,
                                  }))}
                                onChange={value => updateAssignment(date, 'services', svc.id, col.id, value)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr><td colSpan={columns.length+1} className="bg-gray-200 h-1 sm:h-2"></td></tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white p-4 sm:p-6 rounded shadow border border-gray-200 w-full overflow-hidden relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
          <h2 className="text-lg sm:text-xl font-bold">Kelola Jadwal</h2>
          <input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} className="border rounded p-1 text-xs sm:text-sm font-medium w-full sm:w-auto" />
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button onClick={handleExport} className="flex-1 sm:flex-none justify-center items-center px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-xs sm:text-sm flex">
            <Download className="w-4 h-4 mr-1 sm:mr-2"/> Export
          </button>
          
          <input
            type="file"
            ref={importInputRef}
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={async () => {
              if (!canUseBulkActions) {
                await showAlert('Buka kunci edit terlebih dahulu untuk mengimpor jadwal.');
                return;
              }
              importInputRef.current?.click();
            }}
            className="flex-1 sm:flex-none justify-center items-center px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs sm:text-sm flex"
          >
            <Upload className="w-4 h-4 mr-1 sm:mr-2"/> Import
          </button>
          {canPublishActiveTab && (isPublished
            ? <button onClick={() => setUnlockEdit(!unlockEdit)} className="flex-1 sm:flex-none justify-center px-3 py-2 border rounded text-xs sm:text-sm bg-red-50 text-red-600 flex items-center">{unlockEdit ? 'Tutup Edit': 'Buka Kunci'}</button>
            : <button onClick={()=>onPublish(selectedMonth, activeUnitTab)} className="flex-1 sm:flex-none justify-center px-3 py-2 bg-blue-600 text-white rounded text-xs sm:text-sm flex items-center"><Send className="w-4 h-4 mr-1 sm:mr-2"/> Publish</button>
          )}
        </div>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto border-b w-full pb-1">
        {availableTabs.map(tab => (
          <button
            key={tab.id}
            onClick={()=>setActiveUnitTab(tab.id)}
            className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg whitespace-nowrap ${activeUnitTab===tab.id ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap justify-between gap-2">
<div></div>
        <div className="flex flex-wrap justify-end gap-2 ml-auto">
          {canUseBulkActions && activeUnitTab === 'presbiter' && presbiterCount < 30 && (
            <button onClick={() => setPresbiterCount(p => p + 1)} className="flex items-center w-full sm:w-auto justify-center px-3 py-2 bg-indigo-600 text-white rounded-lg shadow font-bold hover:bg-indigo-700 transition text-sm">
              <Plus className="w-4 h-4 sm:w-5 sm:h-5 mr-1"/> Tambah P{presbiterCount + 1}
            </button>
          )}
          {canUseBulkActions && activeUnitTab === 'presbiter' && presbiterCount > 8 && (
            <button onClick={() => setPresbiterCount(p => p - 1)} className="flex items-center w-full sm:w-auto justify-center px-3 py-2 bg-red-500 text-white rounded-lg shadow font-bold hover:bg-red-600 transition text-sm">
              <Minus className="w-4 h-4 sm:w-5 sm:h-5 mr-1"/> Kurangi Slot
            </button>
          )}
          {canUseBulkActions && activeUnitTab && !['ibadah','all_petugas'].includes(activeUnitTab) && (
            <button onClick={()=>resetAssignments(activeUnitTab)} className="flex items-center w-full sm:w-auto justify-center px-4 py-2 bg-red-600 text-white rounded-lg shadow font-bold hover:bg-red-700 transition text-sm">
              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2"/> Reset {availableTabs.find(t=>t.id===activeUnitTab)?.label || activeUnitTab}
            </button>
          )}
          {canUseBulkActions && activeUnitTab && !['ibadah','all_petugas'].includes(activeUnitTab) && (
            <button onClick={()=>autoGenerate(activeUnitTab)} className="flex items-center w-full sm:w-auto justify-center px-4 py-2 bg-purple-600 text-white rounded-lg shadow font-bold hover:bg-purple-700 transition text-sm">
              <Wand2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2"/> Auto-Isi {availableTabs.find(t=>t.id===activeUnitTab)?.label || activeUnitTab}
            </button>
          )}
        </div>
      </div>
      {showCustomModal && (
        <div className="absolute top-16 left-0 right-0 z-20 flex justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-300 w-full max-w-sm p-6 relative">
            <button onClick={closeCustomServiceModal} className="absolute top-3 right-3 text-gray-400 hover:text-gray-700"><X className="w-5 h-5"/></button>
            <h3 className="font-bold text-gray-800 mb-4 text-lg border-b pb-2">{editingCustomService ? 'Edit Ibadah' : 'Tambah Ibadah'}</h3>
            <form onSubmit={handleAddCustomService} className="space-y-4">
              <div><label className="mb-1 block text-xs font-bold text-gray-600">Nama Ibadah</label><select className="w-full rounded border p-2 text-sm" value={customLabel} onChange={e=>setCustomLabel(e.target.value)}>{masterServiceTypes.map(name=><option key={name} value={name}>{name}</option>)}</select><p className="mt-1 text-[11px] text-gray-500">Pilihan berasal dari Master → Ibadah.</p></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-bold text-gray-600">Tanggal</label><input type="date" required min={`${selectedMonth}-01`} max={`${selectedMonth}-31`} className="w-full rounded border p-2 text-sm" value={customDate} onChange={e=>setCustomDate(e.target.value)}/></div><div><label className="mb-1 block text-xs font-bold text-gray-600">Waktu</label><input type="time" required className="w-full rounded border p-2 text-sm" value={customTime} onChange={e=>setCustomTime(e.target.value)}/></div></div>
              <div><label className="mb-1 block text-xs font-bold text-gray-600">Live Streaming</label><div className="flex gap-2"><button type="button" onClick={()=>setCustomLivestream(true)} className={`flex-1 rounded border px-3 py-2 text-sm font-bold ${customLivestream?'border-blue-600 bg-blue-50 text-blue-700':'border-gray-300'}`}>Ya</button><button type="button" onClick={()=>setCustomLivestream(false)} className={`flex-1 rounded border px-3 py-2 text-sm font-bold ${!customLivestream?'border-blue-600 bg-blue-50 text-blue-700':'border-gray-300'}`}>Tidak</button></div><p className="mt-1 text-[11px] text-gray-500">Ya: seluruh role Multimedia. Tidak: Slide saja.</p></div>
              <div><label className="mb-1 block text-xs font-bold text-gray-600">Lokasi</label><select className="w-full rounded border p-2 text-sm" value={customLocation} onChange={e=>setCustomLocation(e.target.value)}><option>Gedung Gereja</option><option>Ruang Pertemuan</option><option>Lounge</option><option>Ruang 2A</option><option>Ruang 2B</option><option>Ruang 3A</option><option>Aula TSK 11</option></select></div>
              <div><label className="mb-1 block text-xs font-bold text-gray-600">Notes</label><textarea rows="3" className="w-full rounded border p-2 text-sm" value={customNotes} onChange={e=>setCustomNotes(e.target.value)} placeholder="Catatan tambahan..."/></div>
              <div><label className="mb-1 block text-xs font-bold text-gray-600">Jumlah Maksimal Presbiter</label><input type="number" min="1" max="30" className="w-full rounded border p-2 text-sm" value={customPCount} onChange={e=>setCustomPCount(e.target.value)}/></div>
              <button type="submit" className="w-full bg-emerald-600 text-white rounded p-2 text-sm font-bold hover:bg-emerald-700 transition">{editingCustomService ? 'Simpan Perubahan' : 'Tambahkan Ibadah'}</button>
            </form>
          </div>
        </div>
      )}
      {showDateSettingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <button onClick={() => setShowDateSettingModal(false)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-700"><X className="h-5 w-5"/></button>
            <h3 className="mb-1 text-lg font-bold text-gray-800">Edit Jenis Ibadah</h3>
            <p className="mb-4 text-sm text-gray-500">{formatDateIndo(editingDateSetting)}</p>
            <form onSubmit={handleSaveDateSetting} className="space-y-4">
              <label className={`block cursor-pointer rounded-xl border p-4 ${dateServiceMode === 'REGULAR' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <input type="radio" className="mr-2" checked={dateServiceMode === 'REGULAR'} onChange={() => setDateServiceMode('REGULAR')}/>
                <span className="font-bold">Ibadah Reguler</span>
                <span className="mt-1 block pl-6 text-xs text-gray-500">Susunan petugas mengikuti jadwal ibadah biasa.</span>
              </label>
              <label className={`block cursor-pointer rounded-xl border p-4 ${dateServiceMode === 'HOLY_COMMUNION' ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}>
                <input type="radio" className="mr-2" checked={dateServiceMode === 'HOLY_COMMUNION'} onChange={() => setDateServiceMode('HOLY_COMMUNION')}/>
                <span className="font-bold">Sakramen Perjamuan Kudus</span>
                <span className="mt-1 block pl-6 text-xs text-gray-500">Berlaku untuk seluruh ibadah pada tanggal ini. IKM P2–P4 diisi Presbiter dan PS/VG ditutup.</span>
              </label>
              <button type="submit" className="w-full rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700">Simpan</button>
            </form>
          </div>
        </div>
      )}
      {importReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="font-bold text-lg text-gray-800">Laporan Import</h3>
              <button onClick={() => setImportReport(null)} className="text-gray-400 hover:text-red-500">
                <X className="w-6 h-6"/>
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">File: <strong>{importReport.fileName}</strong></p>
            <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded mb-3 text-sm font-bold">
              {importReport.success} penugasan berhasil diimpor.
            </div>
            {importReport.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-xs font-bold text-red-700 mb-2">! {importReport.errors.length} baris dilewati:</p>
                <ul className="text-xs text-red-600 space-y-1 list-disc list-inside max-h-60 overflow-y-auto">
                  {importReport.errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              </div>
            )}
            <button
              onClick={() => setImportReport(null)}
              className="w-full mt-4 bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700 transition"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
      {activeUnitTab ? renderMatrix() : <div className="text-gray-500 italic p-4 text-center border rounded">Anda tidak memiliki akses ke unit ini.</div>}
    </div>
  );
};
const ScheduleViewPublic = ({ services, personnel, assignments, selectedDate, onDateChange, customServices, mugerGroups = [] }) => {
  const [calendarMonth, setCalendarMonth] = useState(() => selectedDate.slice(0, 7));

  useEffect(() => {
    setCalendarMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);

  const calendarDays = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const leadingEmpty = firstDay.getDay();
    const rows = [];

    for (let index = 0; index < leadingEmpty; index += 1) rows.push(null);

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
      const serviceRows = getServicesForDate(date, customServices);
      const hasAssignments = Boolean(assignments[date]);
      const customCount = (customServices[date] || []).length;

      rows.push({
        day,
        date,
        serviceCount: serviceRows.length,
        customCount,
        hasAssignments,
        isSunday: new Date(`${date}T00:00:00`).getDay() === 0,
      });
    }

    while (rows.length % 7 !== 0) rows.push(null);
    return rows;
  }, [calendarMonth, assignments, customServices]);

  const calendarTitle = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, month - 1, 1));
  }, [calendarMonth]);

  const changeCalendarMonth = offset => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const target = new Date(year, month - 1 + offset, 1);
    const nextMonth = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
    setCalendarMonth(nextMonth);
    onDateChange(`${nextMonth}-01`);
  };

  const svcs = useMemo(() => {
    const rawSvcs = getServicesForDate(selectedDate, customServices);
    return rawSvcs.map(s => {
      const config = getServiceConfig(s);
      return {...s, pCount: config.actualPCount };
    });
  }, [selectedDate, customServices]);
  const resolveAssigneeName = uid => {
    if (!uid) return '-';
    const person = personnel.find(p => String(p.id) === String(uid));
    if (person) return formatPersonnelDisplayName(person);
    const group = mugerGroups.find(g =>
      [g.id, g.groupId, g.code, g.teamId].some(value => String(value || '') === String(uid))
    );
    return group?.name || group?.groupName || group?.timName || '-';
  };
  const getPersonnelName = (serviceId, key) => {
    const assignedId =
      assignments[selectedDate]?.services?.[serviceId]?.[key]?.userId;  

    if (!assignedId) return '-';  

    // Petugas biasa, termasuk PS/VG yang dibuat lewat Master Petugas
    const person = personnel.find(
      item => String(item.id) === String(assignedId)
    );  

    if (person) {
      return formatPersonnelDisplayName(person);
    } 

    // Tim musik / group lama
    const group = mugerGroups.find(
      item => String(item.id) === String(assignedId)
    );  

    if (group) {
      return group.name;
    } 

    return '-';
  };
  const getAssignedNames = (serviceId, keys = []) => {
    const names = keys
      .map(key => getPersonnelName(serviceId, key))
      .filter(name => name && name !== '-');

    return [...new Set(names)].join(', ') || '-';
  };
  const getPelkatName = (category, classId, key) => {
    const uid = assignments[selectedDate]?.[category]?.[classId]?.[key]?.userId;
    return resolveAssigneeName(uid);
  };
  const getRawVal = (svcId, key) => {
    return assignments[selectedDate]?.services?.[svcId]?.[key]?.userId || "";
  };
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">Jadwal Publik</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pilih tanggal pada kalender untuk melihat seluruh petugas ibadah.
          </p>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={event => onDateChange(event.target.value)}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm sm:w-auto"
        />
      </div>

      <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => changeCalendarMonth(-1)}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
            aria-label="Bulan sebelumnya"
          >
            <ChevronRight className="h-5 w-5 rotate-180" />
          </button>

          <div className="text-center">
            <div className="flex items-center justify-center gap-2 font-bold capitalize text-gray-900">
              <Calendar className="h-5 w-5 text-blue-600" />
              {calendarTitle}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Tanggal berwarna memiliki jadwal ibadah.
            </p>
          </div>

          <button
            type="button"
            onClick={() => changeCalendarMonth(1)}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
            aria-label="Bulan berikutnya"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-center text-[11px] font-bold uppercase text-gray-500 sm:text-xs">
          {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => (
            <div key={day} className="px-1 py-3">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {calendarDays.map((row, index) => {
            if (!row) {
              return (
                <div
                  key={`empty-${index}`}
                  className="min-h-[76px] border-b border-r border-gray-100 bg-gray-50/40 sm:min-h-[104px]"
                />
              );
            }

            const isSelected = row.date === selectedDate;
            const hasSchedule = row.hasAssignments || row.customCount > 0;
            const serviceLabel = row.customCount > 0
              ? `${row.customCount} khusus`
              : row.isSunday
                ? 'Ibadah Minggu'
                : '';

            return (
              <button
                key={row.date}
                type="button"
                onClick={() => onDateChange(row.date)}
                className={`min-h-[76px] border-b border-r border-gray-100 p-2 text-left transition sm:min-h-[104px] sm:p-3 ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : hasSchedule
                      ? 'bg-blue-50 hover:bg-blue-100'
                      : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : row.isSunday
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700'
                  }`}>
                    {row.day}
                  </span>

                  {hasSchedule && (
                    <span className={`mt-1 h-2 w-2 rounded-full ${
                      isSelected ? 'bg-white' : 'bg-blue-600'
                    }`} />
                  )}
                </div>

                {serviceLabel && (
                  <div className={`mt-2 hidden text-[10px] font-semibold leading-tight sm:block ${
                    isSelected ? 'text-blue-50' : 'text-blue-700'
                  }`}>
                    {serviceLabel}
                  </div>
                )}

                {row.customCount > 0 && row.isSunday && (
                  <div className={`mt-1 hidden text-[10px] sm:block ${
                    isSelected ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    + ibadah tambahan
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">
          Jadwal terpilih
        </div>
        <div className="mt-1 font-bold text-blue-950">
          {new Intl.DateTimeFormat('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date(`${selectedDate}T00:00:00`))}
        </div>
      </div>

      <div className="space-y-4 sm:space-y-6">
        {(assignments[selectedDate]?.pa || assignments[selectedDate]?.pt ||
          assignments[selectedDate]?.presbiterPendamping ||
          assignments[selectedDate]?.pendetaPendamping ||
          assignments[selectedDate]?.pemimpinPersiapan) && new Date(selectedDate).getDay() === 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden mb-8">
            <div className="bg-green-50 p-3 sm:p-4 border-b border-green-100 flex items-center justify-between">
              <span className="font-bold text-green-800 text-sm sm:text-base flex items-center"><Users className="w-5 h-5 mr-2"/> 08:00 - Ibadah Pelkat (PA & PT)</span>
            </div>
            <div className="p-4 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h5 className="text-sm font-bold text-gray-800 mb-1">Pelkat PA</h5>
                  <div className="border border-gray-400 bg-gray-50 p-3 space-y-2 text-xs rounded-lg">
                    <h6 className="text-xs font-bold text-gray-600 mb-2">Persiapan Jumat</h6>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Ruang</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900">Ruang 2A</span>
                    </div>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Pendeta Pendamping</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900 font-semibold">{getPelkatName('pendetaPendamping', 'pa', 'pendamping')}</span>
                    </div>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Pemimpin Persiapan</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900 font-semibold">{getPelkatName('pemimpinPersiapan', 'pa', 'pemimpin')}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h5 className="text-sm font-bold text-gray-800 mb-1">Pelkat PT</h5>
                  <div className="border border-gray-400 bg-gray-50 p-3 space-y-2 text-xs rounded-lg">
                    <h6 className="text-xs font-bold text-gray-600 mb-2">Persiapan Jumat</h6>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Ruang</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900">Ruang 2B</span>
                    </div>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Pendeta Pendamping</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900 font-semibold">{getPelkatName('pendetaPendamping', 'pt', 'pendamping')}</span>
                    </div>
                    <div className="flex">
                      <span className="w-1/3 font-medium text-gray-700">Pemimpin Persiapan</span>
                      <span className="w-4 text-center">:</span>
                      <span className="w-2/3 text-gray-900 font-semibold">{getPelkatName('pemimpinPersiapan', 'pt', 'pemimpin')}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <div className="font-black text-green-700 mb-3 border-b-2 border-green-100 pb-1">Pelayanan Anak (PA)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {PELKAT_CONFIG.PA.map(c => (
                      <div key={c.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                        <div className="border-b border-gray-100 pb-1 mb-2">
                          <div className="font-bold text-xs sm:text-sm text-gray-700">{c.label}</div>
                          {c.room && <div className="text-[10px] text-gray-500 mt-0.5">{c.room}</div>}
                        </div>
                        <div className="space-y-1">
                          {(() => {
                            const pntName = getPelkatName('presbiterPendamping', c.id, 'pendamping');
                            if (pntName !== '-') return (
                              <div className="flex justify-between text-[10px] sm:text-xs mb-1 bg-yellow-50 p-1 rounded">
                                <span className="text-yellow-700 font-semibold w-1/3 truncate">Pnt/Dkn Pendamping</span>
                                <span className="font-bold text-yellow-800 text-right w-2/3 truncate">{pntName}</span>
                              </div>
                            );
                            return null;
                          })()}
                          {c.slots?.map(s => {
                            const pName = getPelkatName('pa', c.id, s.key);
                            if (pName === '-') return null;
                            return (
                              <div key={s.key} className="flex justify-between text-[10px] sm:text-xs">
                                <span className="text-gray-500 w-1/3 truncate" title={s.label}>{s.label}</span>
                                <span className="font-medium text-gray-800 text-right w-2/3 truncate" title={pName}>{pName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-black text-orange-600 mb-3 border-b-2 border-orange-100 pb-1">Persekutuan Teruna (PT)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {PELKAT_CONFIG.PT.map(c => (
                      <div key={c.id} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm mb-3">
                        <div className="font-bold text-xs sm:text-sm border-b border-gray-100 pb-1 mb-2 text-gray-700">{c.label}</div>
                        <div className="space-y-1">
                          {(() => {
                            const pntName = getPelkatName('presbiterPendamping', c.id, 'pendamping');
                            if (pntName !== '-') return (
                              <div className="flex justify-between text-[10px] sm:text-xs mb-1 bg-yellow-50 p-1 rounded">
                                <span className="text-yellow-700 font-semibold w-1/3 truncate">Pnt/Dkn Pendamping</span>
                                <span className="font-bold text-yellow-800 text-right w-2/3 truncate">{pntName}</span>
                              </div>
                            );
                            return null;
                          })()}
                          {c.slots?.map(s => {
                            const pName = getPelkatName('pt', c.id, s.key);
                            if (pName === '-') return null;
                            return (
                              <div key={s.key} className="flex justify-between text-[10px] sm:text-xs">
                                <span className="text-gray-500 w-1/3 truncate" title={s.label}>{s.label}</span>
                                <span className="font-medium text-gray-800 text-right w-2/3 truncate" title={pName}>{pName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {svcs.map(s => {
          const config = getServiceConfig(s);
          const actualPCount = config.actualPCount;
          const assignedPCount = actualPCount;
          return (
            <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className={`p-3 sm:p-4 border-b flex flex-col sm:flex-row justify-between font-bold text-xs sm:text-base gap-2 sm:gap-0 ${s.isCustom ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-blue-50 border-blue-100 text-blue-900'}`}>
                <span className="flex items-center"><Clock className="w-4 h-4 mr-2"/> {s.time} - {s.label}</span>
              </div>
              <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs sm:text-sm">
                <div>
                  <div className="font-black text-gray-400 uppercase mb-3 border-b pb-1">Presbiter</div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {Array.from({length: assignedPCount}).map((_,i) => (
                      <div key={i} className="flex justify-between border-b border-gray-50 pb-1">
                        <span className="font-medium text-gray-500">P{i+1}</span>
                        <span className="text-right text-gray-800 font-medium truncate ml-2" title={getPersonnelName(s.id, `p${i+1}`)}>
                          {getPersonnelName(s.id, `p${i+1}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-6">
                  <div>
                    <div className="font-black text-gray-400 uppercase mb-3 border-b pb-1">Multimedia & Sound</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                      {[...getMultimediaKeysForService(s), 'sound1', 'sound2'].map(k => {
                        const labels = {mm_slide: 'Slide', mm_cam1: 'Cam 1', mm_cam2: 'Cam 2', mm_cam3: 'Cam 3', mm_switch: 'Switcher', mm_pic: 'PIC', sound1: 'Sound 1', sound2: 'Sound 2' };
                        return (
                          <div key={k} className="flex justify-between border-b border-gray-50 pb-1">
                            <span className="font-medium text-gray-500">{labels[k]}</span>
                            <span className="text-right text-gray-800 font-medium truncate ml-2" title={getPersonnelName(s.id, k)}>{getPersonnelName(s.id, k)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="font-black text-gray-400 uppercase mb-3 border-b pb-1">
                      Musik Gereja (Muger)
                    </div>                  

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                      {/* Pemandu Lagu */}
                      <div className="flex justify-between border-b border-gray-50 pb-1">
                        <span className="font-medium text-gray-500">
                          Pemandu Lagu
                        </span>                 

                        <span className="text-right text-gray-800 font-medium ml-2">
                          {getAssignedNames(s.id, [
                            'ps_pemandu1',
                            'ps_pemandu2',
                            'ps_pemandu3',
                            'ps_pemandu4',
                            // kompatibilitas data lama
                            'ps_pemandu',
                          ])}
                        </span>
                      </div>                  

                      {/* Pukul 08.00: Organis ditampilkan sebagai Pemusik */}
                      {String(s.time || '').startsWith('08:00') ? (
                        <div className="flex justify-between border-b border-gray-50 pb-1">
                          <span className="font-medium text-gray-500">
                            Pemusik
                          </span>                 

                          <span className="text-right text-gray-800 font-medium truncate ml-2">
                            {getAssignedNames(s.id, [
                              'ps_organis',
                              'ps_pemusik1',
                            ])}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between border-b border-gray-50 pb-1">
                            <span className="font-medium text-gray-500">
                              Pemusik 1
                            </span>                 

                            <span className="text-right text-gray-800 font-medium truncate ml-2">
                              {getPersonnelName(s.id, 'ps_pemusik1')}
                            </span>
                          </div>                  

                          <div className="flex justify-between border-b border-gray-50 pb-1">
                            <span className="font-medium text-gray-500">
                              Pemusik 2
                            </span>                 

                            <span className="text-right text-gray-800 font-medium truncate ml-2">
                              {getPersonnelName(s.id, 'ps_pemusik2')}
                            </span>
                          </div>
                        </>
                      )}                  

                      {String(s.time || '').startsWith('19:00') && (
                        <div className="flex justify-between border-b border-gray-50 pb-1">
                          <span className="font-medium text-gray-500">
                            Tim Musik
                          </span>                 

                          <span className="text-right text-gray-800 font-medium truncate ml-2">
                            {getPersonnelName(s.id, 'ps_tim_musik')}
                          </span>
                        </div>
                      )}
                    </div>                  

                    {/* PS/VG */}
                    <div className="mt-3 space-y-2">
                      {[1, 2, 3].map(i => {
                        const vgName = getPersonnelName(
                          s.id,
                          `ps_vg${i}_name`
                        );                  

                        const est = getRawVal(
                          s.id,
                          `ps_vg${i}_est`
                        );                  

                        const soloist = getRawVal(
                          s.id,
                          `ps_vg${i}_soloist`
                        );                  

                        const instr = getRawVal(
                          s.id,
                          `ps_vg${i}_instr`
                        );                  

                        if (!vgName || vgName === '-') return null;                 

                        return (
                          <div
                            key={`vg${i}`}
                            className="flex flex-col bg-gray-50 p-2 rounded border border-gray-100"
                          >
                            <span className="font-bold text-purple-700 mb-1 text-[10px] uppercase">
                              PS/VG {i}{' '}
                              {i === 1
                                ? '(Sebelum Khotbah)'
                                : '(Setelah Doa Syafaat)'}
                            </span>                 

                            <span className="text-gray-800 text-sm font-bold">
                              {vgName}
                            </span>                 

                            {(est || soloist === 'Y' || instr) && (
                              <span className="text-gray-500 text-[10px] mt-0.5 font-medium">
                                {[
                                  est ? `Est: ${est} orang` : '',
                                  soloist === 'Y' ? 'Ada Solois' : '',
                                  instr ? `Alat: ${instr}` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' | ')}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {svcs.length === 0 && <div className="text-center p-8 text-gray-500 bg-white rounded border border-dashed">Tidak ada jadwal ibadah rutin di tanggal ini.</div>}
      </div>
    </div>
  );
};

const normalizePersonnelName = (value = '') => String(value)
  .trim()
  .replace(/^(pnt|penatua|dkn|diaken)\.?\s+/i, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const levenshteinDistance = (a = '', b = '') => {
  const left = normalizePersonnelName(a);
  const right = normalizePersonnelName(b);
  const matrix = Array.from({ length: right.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= left.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= right.length; i++) {
    for (let j = 1; j <= left.length; j++) {
      matrix[i][j] = right[i - 1] === left[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[right.length][left.length];
};
const isSimilarPersonnelName = (a, b) => {
  const left = normalizePersonnelName(a);
  const right = normalizePersonnelName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) >= 5;
  const distance = levenshteinDistance(left, right);
  const longest = Math.max(left.length, right.length);
  return longest >= 5 && distance <= Math.max(1, Math.floor(longest * 0.22));
};

const mergePersonnelDuplicates = (rows = []) => {
  const merged = new Map();
  for (const row of rows) {
    const key = normalizePersonnelName(row?.name);
    if (!key) continue;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, {
        ...row,
        name: String(row.name || '').replace(/^(pnt|penatua|dkn|diaken)\.?\s+/i, '').trim(),
        units: [...new Set(row.units || (row.unit ? [row.unit] : []))],
        roles: [...new Set(row.roles || (row.role ? [row.role] : []))],
        pelkatClasses: [...new Set(row.pelkatClasses || (row.pelkatClass ? [row.pelkatClass] : []))],
        musicTeams: [...(row.musicTeams || [])],
        collaborations: [...(row.collaborations || [])],
      });
      continue;
    }
    const teamMap = new Map([...(previous.musicTeams || []), ...(row.musicTeams || [])].map(t => [String(t.id || t.name), t]));
    const collaborationMap = new Map([...(previous.collaborations || []), ...(row.collaborations || [])].map(t => [String(t.id || t.name), t]));
    merged.set(key, {
      ...previous,
      ...row,
      id: previous.id || row.id,
      name: previous.name || row.name,
      units: [...new Set([...(previous.units || []), ...(row.units || []), ...(row.unit ? [row.unit] : [])])],
      roles: [...new Set([...(previous.roles || []), ...(row.roles || []), ...(row.role ? [row.role] : [])])],
      pelkatClasses: [...new Set([...(previous.pelkatClasses || []), ...(row.pelkatClasses || []), ...(row.pelkatClass ? [row.pelkatClass] : [])])],
      musicTeams: [...teamMap.values()],
      collaborations: [...collaborationMap.values()],
      unitMemberships: [
        ...new Map(
          [...(previous.unitMemberships || []), ...(row.unitMemberships || [])]
            .filter(item => item?.name)
            .map(item => [normalizeRoleToken(item.name), item])
        ).values(),
      ],
      roleMemberships: [
        ...new Map(
          [...(previous.roleMemberships || []), ...(row.roleMemberships || [])]
            .filter(item => item?.name || item?.roleId || item?.id)
            .map(item => [
              `${normalizeRoleToken(item.unit || '')}::${normalizeRoleToken(item.name || item.roleName || '')}::${String(item.roleId || item.id || '')}`,
              item,
            ])
        ).values(),
      ],
      multimediaAssignment: previous.multimediaAssignment || row.multimediaAssignment,
    });
  }
  return [...merged.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));
};


const loadPersonnelFromNormalizedCollections = async () => {
  const [userSnap, unitSnap, roleSnap, userUnitSnap, userRoleSnap, groupSnap, groupMemberSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'units')),
    getDocs(collection(db, 'roles')),
    getDocs(collection(db, 'userUnits')),
    getDocs(collection(db, 'userRoles')),
    getDocs(collection(db, 'groups')),
    getDocs(collection(db, 'groupMembers')),
  ]);

  const unitsById = new Map(unitSnap.docs.map(row => {
    const data = row.data();
    return [row.id, data.unitName || data.name || data.nama || data.label || row.id];
  }));
  const rolesById = new Map(roleSnap.docs.map(row => {
    const data = row.data();
    return [row.id, data.roleName || data.name || data.nama || data.namaRole || data.role || data.label || row.id];
  }));

  const activeMasterRoles = roleSnap.docs
    .map(row => {
      const data = row.data() || {};
      return {
        id: row.id,
        name: data.roleName || data.name || data.nama || data.namaRole || data.role || data.label || '',
        unitId: data.unitId || '',
        unitName: data.unitName || data.unit || data.namaUnit || '',
        status: data.status || 'active',
      };
    })
    .filter(role => role.name && role.status !== 'inactive');

  const roleByNormalizedName = new Map(
    activeMasterRoles.map(role => [normalizeRoleToken(role.name), role])
  );

  const canonicalizeMasterRole = (rawName, roleId = '', rawUnitName = '') => {
    const byId = roleId
      ? activeMasterRoles.find(role => String(role.id) === String(roleId))
      : null;

    if (byId) return byId;

    const token = normalizeRoleToken(rawName);
    if (!token) return null;

    const exact = roleByNormalizedName.get(token);
    if (exact) return exact;

    // Nama role harus sama dengan role aktif di Master Role.
    // Contoh: bila Master Role berisi "Camera", maka "Kameramen",
    // "Kamera", atau nama lain tidak dianggap sebagai role berbeda.
    return null;
  };
  const groupsById = new Map(groupSnap.docs.map(row => {
    const data = row.data();
    return [row.id, {
      id: row.id,
      name: data.timName || data.groupName || data.name || row.id,
      type: data.type || 'MUSIC_TEAM',
      status: data.status || 'active',
      leaderId: String(data.leaderId || data.coordinatorId || ''),
    }];
  }));

  const unitRowsByUser = new Map();
  const legacyPelkatRolesByUser = new Map();

  for (const row of userUnitSnap.docs) {
    const data = row.data();
    const userId = String(
      data.userId || data.userID || data.personId || data.personID ||
      data.personnelId || data.petugasId || data.idUser || data.uid || ''
    ).trim();
    if (!userId) continue;

    const rawUnitName = data.unitName || unitsById.get(String(data.unitId || '')) || '';
    if (!rawUnitName) continue;

    const normalized = normalizeLegacyPelkatUnit(rawUnitName);
    const unitName = normalized.unitName;

    if (!unitRowsByUser.has(userId)) unitRowsByUser.set(userId, []);

    const existingUnits = unitRowsByUser.get(userId);
    if (!existingUnits.some(item => unitMatches(item.name, unitName))) {
      existingUnits.push({ name: unitName, status: data.status || 'active' });
    }

    if (normalized.inferredRole) {
      if (!legacyPelkatRolesByUser.has(userId)) legacyPelkatRolesByUser.set(userId, []);
      legacyPelkatRolesByUser.get(userId).push({
        name: normalized.inferredRole,
        unit: unitName,
        status: data.status || 'active',
      });
    }
  }

  const roleRowsByUser = new Map();

  for (const row of userRoleSnap.docs) {
    const data = row.data() || {};
    const userId = String(
      data.userId || data.userID || data.personId || data.personID ||
      data.personnelId || data.petugasId || data.idUser || data.uid || ''
    ).trim();
    if (!userId) continue;

    const rawUnitName =
      data.unitName ||
      unitsById.get(String(data.unitId || '')) ||
      '';

    const canonicalRole = canonicalizeMasterRole(
      data.roleName || data.name || data.nama || data.namaRole || data.role || data.label || '',
      String(data.roleId || data.roleID || data.idRole || data.roleCode || data.role_id || data.id_role || ''),
      rawUnitName
    );

    // Jangan buang role user hanya karena struktur field master berbeda.
    // Gunakan data mentah sebagai fallback agar Penatua/Diaken dan role unit tetap terbaca.
    const fallbackRoleId = String(data.roleId || data.roleID || data.idRole || data.roleCode || data.role_id || data.id_role || '').trim();
    const fallbackRoleName =
      data.roleName || data.name || data.nama || data.namaRole || data.role || data.label ||
      rolesById.get(fallbackRoleId) || '';

    const resolvedRole = canonicalRole || (fallbackRoleName ? {
      id: fallbackRoleId,
      name: fallbackRoleName,
      unitId: String(data.unitId || ''),
      unitName: rawUnitName,
    } : null);

    if (!resolvedRole) continue;

    const unitName =
      resolvedRole.unitName ||
      rawUnitName ||
      unitsById.get(String(resolvedRole.unitId || '')) ||
      '';

    if (!roleRowsByUser.has(userId)) roleRowsByUser.set(userId, []);

    const memberships = roleRowsByUser.get(userId);
    const canonicalMembership = {
      id: resolvedRole.id,
      roleId: resolvedRole.id,
      name: resolvedRole.name,
      unit: unitName,
      status: data.status || 'active',
    };

    const existing = memberships.find(item =>
      normalizeRoleToken(item.name) === normalizeRoleToken(canonicalMembership.name) &&
      (
        !item.unit ||
        !canonicalMembership.unit ||
        unitMatches(item.unit, canonicalMembership.unit)
      )
    );

    if (!existing) {
      memberships.push(canonicalMembership);
    }
  }

  for (const [userId, inferredRoles] of legacyPelkatRolesByUser.entries()) {
    if (!roleRowsByUser.has(userId)) roleRowsByUser.set(userId, []);
    const currentRoles = roleRowsByUser.get(userId);

    inferredRoles.forEach(role => {
      if (!currentRoles.some(item =>
        genericRoleMatches(item.name, role.name) &&
        (!item.unit || unitMatches(item.unit, role.unit))
      )) {
        currentRoles.push(role);
      }
    });
  }

  const teamsByUser = new Map();
  const collaborationsByUser = new Map();
  for (const row of groupMemberSnap.docs) {
    const data = row.data();
    const userId = String(data.userId || '');
    const groupId = String(data.groupId || '');
    if (!userId || !groupId) continue;
    const group = groupsById.get(groupId) || { id: groupId, name: groupId, type: 'MUSIC_TEAM', status: 'active' };
    const member = { id: groupId, name: group.name, memberRole: data.memberRole || 'MEMBER', status: data.status || 'active', leaderId: group.leaderId || '' };
    const target = group.type === 'COLLABORATION' ? collaborationsByUser : teamsByUser;
    if (!target.has(userId)) target.set(userId, []);
    target.get(userId).push(member);
  }

  const rows = userSnap.docs.map(row => {
    const data = row.data();
    const id = row.id;
    const unitMemberships = unitRowsByUser.get(id) || [];
    const roleMemberships = roleRowsByUser.get(id) || [];
    return {
      id,
      name: data.name || data.namaUser || data.displayName || id,
      email: data.email || data.contactEmail || '',
      phone: data.phone || data.noHp || '',
      wargaJemaat: data.wargaJemaat ?? null,
      status: data.status || data.active || 'active',
      multimediaAssignment: data.multimediaAssignment || data.penugasanMultimedia || null,
      pelkatClasses: data.pelkatClasses || [],
      musicTeams: teamsByUser.get(id) || [],
      collaborations: collaborationsByUser.get(id) || [],
      unitMemberships,
      roleMemberships,
      units: unitMemberships.filter(x => x.status !== 'inactive').map(x => x.name),
      roles: roleMemberships.filter(x => x.status !== 'inactive').map(x => x.name),
      roleIds: roleMemberships.filter(x => x.status !== 'inactive').map(x => x.roleId || x.id).filter(Boolean),
      assignments: data.assignments || 0,
    };
  });
  console.log(
    rows.find(p => p.name === "GP Paulus Choir")
  );
  return mergePersonnelDuplicates(rows);
};


const MASTER_COLLECTION_CONFIG = {
  services: {
    title: 'Master Jenis Ibadah',
    singular: 'Jenis Ibadah',
    collectionName: 'services',
    prefix: 'SVC',
    width: 4,
    fields: [
      { key: 'name', label: 'Nama Jenis Ibadah', required: true },
      { key: 'code', label: 'Kode', required: true },
      { key: 'description', label: 'Deskripsi' },
    ],
  },
  units: {
    title: 'Master Unit',
    singular: 'Unit',
    collectionName: 'units',
    prefix: 'UN',
    width: 4,
    fields: [
      { key: 'name', label: 'Nama Unit', required: true },
      { key: 'code', label: 'Kode Unit', required: true },
      { key: 'description', label: 'Deskripsi' },
    ],
  },
  roles: {
    title: 'Master Role',
    singular: 'Role',
    collectionName: 'roles',
    prefix: 'RL',
    width: 4,
    fields: [
      { key: 'name', label: 'Nama Role', required: true },
      { key: 'unitId', label: 'Unit', type: 'unit', required: true },
      { key: 'description', label: 'Deskripsi' },
    ],
  },
};

const MasterCrudPage = ({ type, currentUser }) => {
  const config = MASTER_COLLECTION_CONFIG[type];
  const { showAlert, showConfirm } = useDialog();
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const DEFAULT_MASTER_SERVICE_TYPES = [
    { name: 'Ibadah Hari Minggu', code: 'IHM' },
    { name: 'Ibadah Hari Minggu SP I', code: 'IHM_SP1' },
    { name: 'Ibadah Kaum Muda', code: 'IKM' },
    { name: 'Ibadah Keluarga', code: 'IKEL' },
    { name: 'Ibadah Sektor', code: 'ISEK' },
    { name: 'Ibadah Syukur', code: 'ISYK' },
    { name: 'Ibadah Kedukaan', code: 'IDUKA' },
    { name: 'Ibadah Penglepasan', code: 'IPLEPASAN' },
    { name: 'Ibadah Pemberkatan Perkawinan', code: 'IPK' },
    { name: 'Ibadah Perjamuan Kudus', code: 'IPKUDUS' },
    { name: 'Malam Natal', code: 'MNATAL' },
    { name: 'Natal', code: 'NATAL' },
    { name: 'Jumat Agung', code: 'JAGUNG' },
    { name: 'Paskah', code: 'PASKAH' },
    { name: 'Kenaikan Yesus Kristus', code: 'KENAIKAN' },
    { name: 'Lainnya', code: 'OTHER' },
  ];

  const isSuperadmin = (currentUser?.roles || []).includes(ROLES.SUPERADMIN);
  const canWrite = type === 'services'
    ? ((currentUser?.roles || []).includes(ROLES.SUPERADMIN) || (currentUser?.roles || []).includes(ROLES.ADMIN_UNIT))
    : isSuperadmin;

  const emptyForm = useMemo(() => {
    const base = { status: 'active' };
    config.fields.forEach(field => { base[field.key] = ''; });
    return base;
  }, [type]);

  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(false);
  }, [type, emptyForm]);

  useEffect(() => {
    if (type !== 'services' || !isSuperadmin) return;

    let cancelled = false;

    const seedTypes = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'services'));
        const existing = snapshot.docs
          .map(row => row.data() || {})
          .filter(data =>
            data.recordType === 'SERVICE_TYPE' ||
            data.masterType === true ||
            Boolean(data.typeName)
          );

        if (existing.length || cancelled) return;

        for (let index = 0; index < DEFAULT_MASTER_SERVICE_TYPES.length; index += 1) {
          const row = DEFAULT_MASTER_SERVICE_TYPES[index];
          const id = `SVC${String(index + 1).padStart(4, '0')}`;

          await safeSetDoc(
            doc(db, 'services', id),
            {
              name: row.name,
              serviceName: row.name,
              label: row.name,
              typeName: row.name,
              code: row.code,
              serviceCode: row.code,
              description: '',
              recordType: 'SERVICE_TYPE',
              masterType: true,
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (error) {
        console.error('Gagal membuat master jenis ibadah:', error);
      }
    };

    seedTypes();
    return () => { cancelled = true; };
  }, [type, isSuperadmin]);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, config.collectionName),
      snapshot => {
        const normalizedRows = snapshot.docs.map(row => {
          const data = row.data() || {};

          if (type === 'units') {
            const unitName = data.name || data.unitName || data.label || '';
            const normalizedLegacy = normalizeLegacyPelkatUnit(unitName);

            // PA-Batita, PA-TK, PT-Eka, dst. bukan lagi unit master.
            if (normalizedLegacy.inferredRole) return null;

            return {
              id: row.id,
              ...data,
              name: unitName,
              code: data.code || data.unitCode || data.shortCode || row.id,
              description: data.description || data.notes || '',
              status: data.status || 'active',
            };
          }

          if (type === 'roles') {
            return {
              id: row.id,
              ...data,
              name: data.name || data.roleName || data.label || '',
              unitId: data.unitId || data.unitCode || '',
              unitName: data.unitName || data.unit || data.namaUnit || '',
              description: data.description || data.notes || '',
              status: data.status || 'active',
            };
          }

          if (type === 'services') {
            if (
              data.recordType !== 'SERVICE_TYPE' &&
              data.masterType !== true &&
              !data.typeName
            ) {
              return null;
            }
          }

          return {
            id: row.id,
            ...data,
            name: data.name || data.serviceName || data.label || data.title || data.typeName || '',
            code: data.code || data.serviceCode || data.serviceType || row.id,
            description: data.description || data.notes || '',
            status: data.status || 'active',
          };
        });

        setRows(normalizedRows.filter(Boolean));
        setLoading(false);
      },
      error => {
        console.error(error);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [config.collectionName]);

  useEffect(() => {
    if (type !== 'roles') return undefined;
    return onSnapshot(collection(db, 'units'), snapshot => {
      setUnits(
        snapshot.docs
          .map(row => {
            const data = row.data() || {};
            return {
              id: row.id,
              ...data,
              name: data.name || data.unitName || data.label || '',
              code: data.code || data.unitCode || row.id,
              status: data.status || 'active',
            };
          })
          .filter(row => row.status !== 'inactive')
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id'))
      );
    });
  }, [type]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(row => {
        if (!q) return true;
        return Object.values(row).some(value =>
          typeof value === 'string' && value.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'id'));
  }, [rows, search]);

  const openAdd = () => {
    if (!canWrite) return;
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = row => {
    if (!canWrite) return;
    setEditing(row);
    const next = { ...emptyForm, ...row };
    setForm(next);
    setShowForm(true);
  };

  const save = async event => {
    event.preventDefault();
    if (!canWrite || saving) return;

    const missing = config.fields.find(field =>
      field.required && !String(form[field.key] || '').trim()
    );
    if (missing) {
      await showAlert(`${missing.label} wajib diisi.`);
      return;
    }

    setSaving(true);
    try {
      const id = editing?.id || await getNextSequentialId(
        config.collectionName,
        config.prefix,
        config.width
      );

      const cleanedName = String(form.name || '').trim();
      const payload = {
        ...form,
        name: cleanedName,
        status: form.status || 'active',
        updatedAt: serverTimestamp(),
      };

      if (!editing) payload.createdAt = serverTimestamp();

      if (type === 'services') {
        payload.serviceName = cleanedName;
        payload.label = cleanedName;
        payload.typeName = cleanedName;
        payload.serviceCode = String(form.code || '').trim();
        payload.recordType = 'SERVICE_TYPE';
        payload.masterType = true;
      }

      if (type === 'units') {
        payload.unitName = cleanedName;
        payload.unitCode = String(form.code || '').trim();
      }

      if (type === 'roles') {
        const selectedUnit = units.find(unit => unit.id === form.unitId);
        payload.roleName = cleanedName;
        payload.unitName = selectedUnit?.name || form.unitName || '';
      }

      await safeSetDoc(doc(db, config.collectionName, id), payload, { merge: true });
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      await showAlert(`${config.singular} berhasil disimpan.`);
    } catch (error) {
      console.error(error);
      await showAlert(`Gagal menyimpan ${config.singular.toLowerCase()}: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async row => {
    if (!canWrite) return;
    const confirmed = await showConfirm(
      `Hapus ${config.singular.toLowerCase()} "${row.name || row.id}"?\n\nData yang sudah dipakai pada histori jadwal tidak otomatis dihapus.`
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, config.collectionName, row.id));
      await showAlert(`${config.singular} berhasil dihapus.`);
    } catch (error) {
      console.error(error);
      await showAlert(`Gagal menghapus: ${error.message}`);
    }
  };

  const statusLabel = status =>
    String(status || 'active').toLowerCase() === 'active' ? 'Aktif' : 'Nonaktif';

  const getUnitName = row =>
    row.unitName || units.find(unit => unit.id === row.unitId)?.name || '-';

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{config.title}</h2>
          <p className="mt-1 text-sm text-gray-500">
            Data tersimpan langsung ke collection <code>{config.collectionName}</code> di Firestore.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add {config.singular}
          </button>
        )}
      </div>

      {!canWrite && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Unit dan Role hanya dapat diubah oleh Superadmin.
        </div>
      )}

      <div className="mb-4 rounded-xl border bg-white p-4 shadow-sm">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={`Cari ${config.singular.toLowerCase()}...`}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {showForm && (
        <form onSubmit={save} className="mb-5 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-900">
                {editing ? `Edit ${config.singular}` : `Tambah ${config.singular}`}
              </h3>
              {editing && <p className="text-xs text-gray-500">{editing.id}</p>}
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="rounded p-1 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {config.fields.map(field => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {field.label}{field.required ? ' *' : ''}
                </span>
                {field.type === 'unit' ? (
                  <select
                    value={form[field.key] || ''}
                    onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">- Pilih Unit -</option>
                    {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type || 'text'}
                    value={form[field.key] || ''}
                    onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                )}
              </label>
            ))}


            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
              <select
                value={form.status || 'active'}
                onChange={event => setForm(current => ({ ...current, status: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">
              Batal
            </button>
            <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Nama</th>
                {type === 'services' && <th className="px-4 py-3">Kode / Deskripsi</th>}
                {type === 'units' && <th className="px-4 py-3">Kode</th>}
                {type === 'roles' && <th className="px-4 py-3">Unit</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.id}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800">{row.name || '-'}</td>
                  {type === 'services' && (
                    <td className="px-4 py-3 text-gray-600">
                      <div>{row.code || row.serviceCode || '-'}</div>
                      <div className="text-xs text-gray-400">{row.description || '-'}</div>
                    </td>
                  )}
                  {type === 'units' && <td className="px-4 py-3 text-gray-600">{row.code || '-'}</td>}
                  {type === 'roles' && <td className="px-4 py-3 text-gray-600">{getUnitName(row)}</td>}
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      row.status === 'inactive'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canWrite ? (
                      <div className="inline-flex gap-2">
                        <button type="button" onClick={() => openEdit(row)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(row)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">
                          Hapus
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && !filteredRows.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Belum ada data.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Memuat data...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MainApp = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [dateView, setDateView] = useState(getTodayString());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMasterOpen, setIsMasterOpen] = useState(true);
  const [personnel, setPersonnelLocal] = useState([]);
  const personnelRef = useRef([]);
  const [publishedSchedules, setPublishedSchedulesLocal] = useState([]);
  const [assignments, setAssignmentsLocal] = useState({});
  const assignmentsRef = useRef({});
  const [swapRequests, setSwapRequestsLocal] = useState([]);
  const swapRequestsRef = useRef([]);
  const [customServices, setCustomServicesLocal] = useState({});
  const [mugerGroups, setMugerGroups] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [loginUsers, setLoginUsers] = useState([]);
  const [loginDirectoryLoaded, setLoginDirectoryLoaded] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);

  useEffect(() => {
    personnelRef.current = personnel;
  }, [personnel]);

  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  useEffect(() => {
    swapRequestsRef.current = swapRequests;
  }, [swapRequests]);

  // Master Muger menjadi source of truth untuk Tim Musik / PS / VG.
  useEffect(() => {
    return onSnapshot(collection(db, 'groups'), snapshot => {
      const rows = snapshot.docs.map(groupDoc => {
        const data = groupDoc.data() || {};
        return {
          id: groupDoc.id,
          ...data,
          name: data.name || data.groupName || data.timName || groupDoc.id,
        };
      });
      setMugerGroups(rows);
    }, error => {
      console.error('Gagal memuat Master Muger:', error);
      setMugerGroups([]);
    });
  }, []);

  const writePersonnelSessionCache = (rows) => {
    try {
      sessionStorage.setItem('gpibPersonnelCacheV5AllAutofill', JSON.stringify({
        savedAt: Date.now(),
        rows,
      }));
    } catch {
      // Ignore browser storage errors.
    }
  };

  // 1. Load public login directory and observe Firebase Authentication
  useEffect(() => {
    const loadDirectory = async () => {
      try {
        const snap = await getDocs(collection(db, 'loginDirectory'));
        const rows = snap.docs.map(d => {
          const data = d.data() || {};
          const rawUnits =
            data.units ||
            data.unitNames ||
            data.unitIds ||
            data.unitName ||
            data.unit ||
            [];

          const units = Array.isArray(rawUnits)
            ? rawUnits.filter(Boolean)
            : String(rawUnits || '')
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);

          if (!units.length && /^admin\s+/i.test(data.name || '')) {
            const inferred = String(data.name || '').replace(/^admin\s+/i, '').trim();
            if (inferred && !/phmj|super/i.test(inferred)) units.push(inferred);
          }

          const isAdminName = /^admin\b/i.test(String(data.name || '').trim());
          const isPhmjAdmin = /admin\s+phmj/i.test(String(data.name || '').trim());
          const loginRoleLabel = isPhmjAdmin
            ? 'Super Admin'
            : isAdminName
              ? 'Admin'
              : '';

          return { id: d.id, ...data, units, loginRoleLabel };
        })
          .filter(row => row.status !== 'inactive')
          .sort((a,b) => (a.name || '').localeCompare(b.name || '', 'id'));
        setLoginUsers(rows);
      } catch (err) {
        console.error('Gagal memuat loginDirectory:', err);
      } finally {
        setLoginDirectoryLoaded(true);
      }
    };
    loadDirectory();
    return onAuthStateChanged(auth, setFirebaseUser);
  }, []);
  // 2. Load normalized personnel only once, then observe the lightweight compatibility document.
  // Previously, all 7 normalized collections were re-read every time assignments changed,
  // which made the initial load and subsequent updates unnecessarily slow.
  useEffect(() => {
    if (!firebaseUser) return;

    let cancelled = false;
    const docRef = doc(db, ...docPath);
    const PERSONNEL_CACHE_KEY = 'gpibPersonnelCacheV9MasterRoleExact';
    const PERSONNEL_CACHE_TTL_MS = 5 * 60 * 1000;

    const readPersonnelCache = () => {
      try {
        const raw = sessionStorage.getItem(PERSONNEL_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.savedAt || !Array.isArray(parsed?.rows)) return null;
        if (Date.now() - parsed.savedAt > PERSONNEL_CACHE_TTL_MS) return null;
        return parsed.rows;
      } catch {
        return null;
      }
    };

    const writePersonnelCache = (rows) => {
      try {
        sessionStorage.setItem(PERSONNEL_CACHE_KEY, JSON.stringify({
          savedAt: Date.now(),
          rows,
        }));
      } catch {
        // Ignore storage quota/private-mode errors.
      }
    };

    const cachedPersonnel = readPersonnelCache();
    if (cachedPersonnel?.length) {
      setPersonnelLocal(cachedPersonnel);
    }

    const personnelPromise = loadPersonnelFromNormalizedCollections()
      .then((rows) => {
        if (cancelled) return rows;
        setPersonnelLocal(rows);
        writePersonnelCache(rows);
        return rows;
      })
      .catch((error) => {
        console.error('Gagal memuat collection petugas:', error);
        if (!cachedPersonnel?.length && !cancelled) setPersonnelLocal([]);
        return cachedPersonnel || [];
      });

    let compatibilityLoaded = false;
    const unsubscribeDb = onSnapshot(docRef, (snap) => {
      if (cancelled) return;

      if (snap.exists()) {
        const data = snap.data();
        const nextAssignments = data.assignments || {};
        const nextSwapRequests = data.swapRequests || [];
        assignmentsRef.current = nextAssignments;
        swapRequestsRef.current = nextSwapRequests;
        setAssignmentsLocal(nextAssignments);
        setSwapRequestsLocal(nextSwapRequests);
        setCustomServicesLocal(data.customServices || {});
        setPublishedSchedulesLocal(data.publishedSchedules || []);
      } else {
        safeSetDoc(docRef, {
          assignments: {},
          swapRequests: [],
          customServices: {},
          publishedSchedules: []
        }).catch(console.error);
      }

      compatibilityLoaded = true;
      Promise.resolve(personnelPromise).finally(() => {
        if (!cancelled && compatibilityLoaded) setIsDataLoaded(true);
      });
    }, (error) => {
      console.error('Firestore onSnapshot error:', error);
      Promise.resolve(personnelPromise).finally(() => {
        if (!cancelled) setIsDataLoaded(true);
      });
    });

    return () => {
      cancelled = true;
      unsubscribeDb();
    };
  }, [firebaseUser]);
  const handleFirebaseLogin = async (loginUser, password, rememberMe) => {
    if (!password) throw new Error('Masukkan password.');
    const credential = await signInWithEmailAndPassword(auth, loginUser.loginEmail, pinToFirebasePassword(password));
    const profileSnap = await getDoc(doc(db, 'profiles', credential.user.uid));
    const profile = profileSnap.exists() ? profileSnap.data() : {};
    const legacy = personnel.find(p => (p.name || '').toLowerCase() === (loginUser.name || '').toLowerCase());

    // Backward-compatible role resolution: use profile first, then userAppRoles.
    // This also fixes profiles created by an older seed script that stored appRole as USER.
    let appRole = profile.appRole || 'USER';
    if (appRole === 'USER' && profile.personId) {
      const appRoleSnap = await getDocs(collection(db, 'userAppRoles'));
      const roleRows = appRoleSnap.docs
        .map(item => item.data())
        .filter(item => String(item.userId || '') === String(profile.personId) && String(item.status || 'active').toLowerCase() !== 'inactive');
      const roleCodes = roleRows.map(item => String(item.appRole || item.appRoleId || '').toUpperCase());
      if (roleCodes.some(code => code === 'SUPERADMIN' || code === 'AR001')) appRole = 'SUPERADMIN';
      else if (roleCodes.some(code => code === 'ADMIN_UNIT' || code === 'AR002')) appRole = 'ADMIN_UNIT';
    }
    const loginName = String(loginUser.name || '').trim();
    const isPhmjAdminName = /admin\s+phmj|super\s*admin/i.test(loginName);
    const isUnitAdminName = /^admin\b/i.test(loginName) && !isPhmjAdminName;
    if (appRole === 'USER' && isPhmjAdminName) appRole = 'SUPERADMIN';
    if (appRole === 'USER' && isUnitAdminName) appRole = 'ADMIN_UNIT';

    const mappedRoles = appRole === 'SUPERADMIN'
      ? [ROLES.SUPERADMIN]
      : appRole === 'ADMIN_UNIT'
        ? [ROLES.ADMIN_UNIT]
        : (legacy?.roles || []);

    let resolvedUnits = loginUser.units?.length
      ? [...loginUser.units]
      : profile.unitNames?.length
        ? [...profile.unitNames]
        : profile.units?.length
          ? [...profile.units]
          : (legacy?.units || []);

    if (!resolvedUnits.length && isUnitAdminName) {
      const inferredUnit = loginName.replace(/^admin\s+/i, '').trim();
      if (inferredUnit) resolvedUnits = [inferredUnit];
    }

    const signedUser = {
      ...(legacy || {}),
      id: legacy?.id || profile.personId || loginUser.id,
      name: loginUser.name,
      roles: mappedRoles,
      units: resolvedUnits,
      appRole,
      loginRoleLabel: loginUser.loginRoleLabel,
      profileUid: credential.user.uid,
      mustChangePassword: profile.mustChangePassword === true,
    };
    if (rememberMe) localStorage.setItem('savedLoginName', loginUser.name);
    setUser(signedUser);
  };
  useEffect(() => {
    if (!user || !personnel.length) return;

    const canSyncDirectory =
      (user.roles || []).includes(ROLES.SUPERADMIN) ||
      (user.roles || []).includes(ROLES.ADMIN_UNIT);

    if (!canSyncDirectory) return;

    const cacheKey = 'gpibLoginDirectoryUnitsSyncedV1';
    if (sessionStorage.getItem(cacheKey) === 'yes') return;

    let cancelled = false;

    const syncDirectoryUnits = async () => {
      try {
        for (let index = 0; index < personnel.length; index += 35) {
          if (cancelled) return;
          const chunk = personnel.slice(index, index + 35);

          await Promise.all(
            chunk.map(person =>
              safeSetDoc(
                doc(db, 'loginDirectory', person.id),
                {
                  name: person.name,
                  units: person.units || [],
                  unitNames: person.units || [],
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch(() => null)
            )
          );
        }

        sessionStorage.setItem(cacheKey, 'yes');

        setLoginUsers(current =>
          current.map(row => {
            const person = personnel.find(item => item.id === row.id);
            if (!person) return row;
            const isAdminName = /^admin\b/i.test(String(row.name || '').trim());
            const isPhmjAdmin = /admin\s+phmj/i.test(String(row.name || '').trim());
            return {
              ...row,
              units: person.units || [],
              loginRoleLabel: isPhmjAdmin
                ? 'Super Admin'
                : isAdminName
                  ? 'Admin'
                  : row.loginRoleLabel,
            };
          })
        );
      } catch (error) {
        console.error('Gagal menyinkronkan unit loginDirectory:', error);
      }
    };

    syncDirectoryUnits();
    return () => { cancelled = true; };
  }, [user, personnel]);

  const handleLogout = async () => {
    localStorage.removeItem('savedLoginName');
    sessionStorage.clear();
    await signOut(auth).catch(console.error);
    setUser(null);
    setIsDataLoaded(false);
  };
  const setPersonnel = (val) => {
    // Always use the latest in-memory value. This avoids stale React closures,
    // so Add/Edit/Active-Inactive changes appear immediately without refresh.
    const previous = personnelRef.current;
    const next = typeof val === 'function' ? val(previous) : val;

    personnelRef.current = next;
    setPersonnelLocal(next);
    writePersonnelSessionCache(next);

    Promise.all([
      safeSetDoc(doc(db, ...docPath), { personnel: next }, { merge: true }),
      syncPersonnelDiff(db, previous, next),
    ])
      .then(async () => {
        // Re-read the normalized collections after saving so the UI uses the
        // canonical Firestore result and remains consistent across menus.
        const refreshed = await loadPersonnelFromNormalizedCollections();
        personnelRef.current = refreshed;
        setPersonnelLocal(refreshed);
        writePersonnelSessionCache(refreshed);
      })
      .catch(console.error);
  };
  const canWriteNormalizedSchedule = Boolean(
    (user?.roles || []).includes(ROLES.SUPERADMIN) ||
    (user?.roles || []).includes(ROLES.ADMIN_UNIT)
  );

  const setAssignments = async (val) => {
    // User biasa boleh menerima tukar jadwal melalui dokumen kompatibilitas
    // penugasanData. Collection scheduleAssignments tetap hanya boleh ditulis admin.
    const previous = assignmentsRef.current;
    const newVal = typeof val === 'function' ? val(previous) : val;
    assignmentsRef.current = newVal;
    setAssignmentsLocal(newVal);

    try {
      await safeSetDoc(doc(db, ...docPath), { assignments: newVal }, { merge: true });

      // Sinkronisasi ke collection normalized hanya dilakukan oleh admin,
      // sesuai Firestore Rules. Ini mencegah error permission-denied saat user
      // biasa menerima permintaan tukar jadwal.
      if (canWriteNormalizedSchedule) {
        await syncAssignments(db, newVal);
      }

      return newVal;
    } catch (error) {
      assignmentsRef.current = previous;
      setAssignmentsLocal(previous);
      console.error('Gagal menyimpan perubahan jadwal:', error);
      throw error;
    }
  };

  const setSwapRequests = async (val) => {
    const previous = swapRequestsRef.current;
    const newVal = typeof val === 'function' ? val(previous) : val;
    swapRequestsRef.current = newVal;
    setSwapRequestsLocal(newVal);

    try {
      await safeSetDoc(doc(db, ...docPath), { swapRequests: newVal }, { merge: true });

      // syncSwapRequests melakukan cleanup/delete dokumen lain. Berdasarkan rules,
      // operasi tersebut hanya aman dijalankan oleh admin.
      if (canWriteNormalizedSchedule) {
        await syncSwapRequests(db, newVal);
      }

      return newVal;
    } catch (error) {
      swapRequestsRef.current = previous;
      setSwapRequestsLocal(previous);
      console.error('Gagal menyimpan permintaan tukar jadwal:', error);
      throw error;
    }
  };
  const setCustomServices = (val) => {
    const newVal = typeof val === 'function' ? val(customServices) : val;
    setCustomServicesLocal(newVal);
    Promise.all([
      safeSetDoc(doc(db, ...docPath), { customServices: newVal }, { merge: true }),
      syncServices(db, newVal),
    ]).catch(console.error);
  };
  const setPublishedSchedules = (val) => {
    const newVal = typeof val === 'function' ? val(publishedSchedules) : val;
    setPublishedSchedulesLocal(newVal);
    Promise.all([
      safeSetDoc(doc(db, ...docPath), { publishedSchedules: newVal }, { merge: true }),
      syncPublishedSchedules(db, newVal),
    ]).catch(console.error);
  };
  const { showAlert } = useDialog();
  const handlePublish = async (month, unit) => {
    const publishKey = `${month}-${unit}`;
    if (!publishedSchedules.includes(publishKey)) {
      setPublishedSchedules([...publishedSchedules, publishKey]);
      triggerPushNotification("Jadwal Baru!", `Jadwal ${unit.toUpperCase()} untuk bulan ini baru saja diterbitkan.`);
      const tabLabels = { presbiter: 'Presbiter', multimedia: 'Multimedia', sound: 'Sound', muger: 'Muger', pelkat: 'Pelkat' };
      await showAlert(`Jadwal ${tabLabels[unit] || unit.toUpperCase()} Bulan Ini Berhasil Dipublikasikan!`);
    }
  };
  const incomingRequestsCount = user ? swapRequests.filter(req => req.targetUserId === user.id && req.status === 'pending').length : 0;
  const prevSwapCount = useRef(swapRequests.length);
  useEffect(() => {
    if (!user) return;
    if (swapRequests.length > prevSwapCount.current) {
      const newReq = swapRequests[swapRequests.length - 1];
      if (newReq.targetUserId === user.id && newReq.status === 'pending') {
        triggerPushNotification("Permintaan Tukar Jadwal", `Ada permintaan tukar jadwal dari rekan Anda pada tanggal ${formatDateIndo(newReq.date)}.`);
      }
    }
    prevSwapCount.current = swapRequests.length;
  }, [swapRequests, user]);
  if (!loginDirectoryLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-600 font-medium animate-pulse">Memuat daftar pengguna...</p>
      </div>
    );
  }
  if (!user) return <Login onLogin={handleFirebaseLogin} users={loginUsers} />;
  if (!isDataLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-600 font-medium animate-pulse">Menghubungkan ke Database...</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen bg-gray-100 overflow-hidden">
      <div className={`bg-white shadow-lg transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-16'} hidden md:flex flex-col z-10 relative`}>
        <div className="p-4 flex justify-between items-center border-b">
          {isSidebarOpen && <span className="font-bold text-xl text-blue-800 truncate">GPIB Paulus</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-gray-100 rounded text-gray-500 mx-auto">
            <Menu className="w-6 h-6" />
          </button>
        </div>
        <nav className="p-4 flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
          <button onClick={()=>setView('dashboard')} className={`w-full flex items-center p-2 rounded ${view==='dashboard'?'bg-blue-50 text-blue-700':'hover:bg-gray-50'}`} title="Dashboard">
            <Calendar className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Dashboard</span>}
          </button>
          <button onClick={()=>setView('kinerja')} className={`w-full flex items-center p-2 rounded ${view==='kinerja'?'bg-blue-50 text-blue-700':'hover:bg-gray-50'}`} title="Kinerja Saya">
            <BarChart3 className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Kinerja Saya</span>}
          </button>
          <button onClick={()=>setView('tukar_jadwal')} className={`w-full flex items-center p-2 rounded text-purple-700 ${view==='tukar_jadwal'?'bg-purple-100': 'hover:bg-purple-50'}`} title="Tukar Jadwal">
            <RefreshCw className="w-5 h-5 min-w-[20px]" />
            {isSidebarOpen && <span className="ml-3 text-left font-semibold whitespace-nowrap">Tukar Jadwal</span>}
            {isSidebarOpen && incomingRequestsCount > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{incomingRequestsCount}</span>}
            {!isSidebarOpen && incomingRequestsCount > 0 && <span className="absolute top-2 right-2 bg-red-500 w-3 h-3 rounded-full border-2 border-white"></span>}
          </button>
          <button onClick={()=>setView('jadwal')} className={`w-full flex items-center p-2 rounded ${view==='jadwal'?'bg-blue-50 text-blue-700':'hover:bg-gray-50'}`} title="Jadwal Publik">
            <Grid className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Jadwal Publik</span>}
          </button>
          <button onClick={()=>setView('pengaturan')} className={`w-full flex items-center p-2 rounded ${view==='pengaturan'?'bg-blue-50 text-blue-700': 'hover:bg-gray-50'}`} title="Pengaturan">
            <Settings className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Pengaturan Akun</span>}
          </button>
          
          {((user?.roles || []).includes(ROLES.SUPERADMIN) || (user?.roles || []).includes(ROLES.ADMIN_UNIT)) && (
            <>
              <div className={`pt-4 pb-1 text-xs font-bold text-gray-400 uppercase ${!isSidebarOpen && 'text-center'}`}>{isSidebarOpen ? 'Admin' : '---'}</div>
              <button onClick={()=>setView('admin_schedule')} className={`w-full flex items-center p-2 rounded ${view==='admin_schedule'?'bg-blue-50 text-blue-700':'hover:bg-gray-50'}`} title="Kelola Jadwal">
                <Calendar className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Kelola Jadwal</span>}
              </button>
              <button onClick={()=>setView('admin_stats')} className={`w-full flex items-center p-2 rounded ${view==='admin_stats'?'bg-blue-50 text-blue-700':'hover:bg-gray-50'}`} title="Statistik">
                <BarChart3 className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Statistik</span>}
              </button>
              <button
                onClick={() => setIsMasterOpen(current => !current)}
                className={`w-full flex items-center p-2 rounded ${
                  ['admin_db','admin_muger_teams','master_services','master_units','master_roles'].includes(view)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'hover:bg-gray-50'
                }`}
                title="Master"
              >
                <Layers className="w-5 h-5 min-w-[20px]" />
                {isSidebarOpen && (
                  <>
                    <span className="ml-3 flex-1 text-left whitespace-nowrap">Master</span>
                    <ChevronDown className={`h-4 w-4 transition ${isMasterOpen ? 'rotate-180' : ''}`} />
                  </>
                )}
              </button>

              {isMasterOpen && isSidebarOpen && (
                <div className="ml-4 space-y-1 border-l border-gray-200 pl-3">
                  <button onClick={()=>setView('admin_db')} className={`w-full rounded p-2 text-left text-sm ${view==='admin_db'?'bg-blue-50 font-semibold text-blue-700':'hover:bg-gray-50'}`}>Petugas</button>
                  {((user?.roles || []).includes(ROLES.SUPERADMIN) || (user?.units || []).includes(UNITS.MUGER)) && (
                    <button onClick={()=>setView('admin_muger_teams')} className={`w-full rounded p-2 text-left text-sm ${view==='admin_muger_teams'?'bg-purple-50 font-semibold text-purple-700':'hover:bg-gray-50'}`}>Muger</button>
                  )}
                  <button onClick={()=>setView('master_services')} className={`w-full rounded p-2 text-left text-sm ${view==='master_services'?'bg-blue-50 font-semibold text-blue-700':'hover:bg-gray-50'}`}>Ibadah</button>
                  <button onClick={()=>setView('master_units')} className={`w-full rounded p-2 text-left text-sm ${view==='master_units'?'bg-blue-50 font-semibold text-blue-700':'hover:bg-gray-50'}`}>Unit</button>
                  <button onClick={()=>setView('master_roles')} className={`w-full rounded p-2 text-left text-sm ${view==='master_roles'?'bg-blue-50 font-semibold text-blue-700':'hover:bg-gray-50'}`}>Role</button>
                </div>
              )}
            </>
          )}
        </nav>
        <div className="p-4 border-t mt-auto">
          <button onClick={handleLogout} className="w-full flex items-center p-2 text-red-600 hover:bg-red-50 rounded justify-center md:justify-start" title="Keluar">
            <LogOut className="w-5 h-5 min-w-[20px]" /> {isSidebarOpen && <span className="ml-3 text-left whitespace-nowrap">Keluar</span>}
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col h-screen overflow-hidden w-full relative">
        <div className="md:hidden bg-blue-800 text-white p-4 flex justify-between items-center shadow-md shrink-0 z-20">
          <span className="font-bold text-lg">GPIB Paulus</span>
          <div className="flex items-center gap-4">
            <div className="relative" onClick={() => setView('tukar_jadwal')}>
              <Bell className="w-6 h-6" />
              {incomingRequestsCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full border-2 border-blue-800"></span>}
            </div>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-1"><Menu className="w-6 h-6"/></button>
          </div>
        </div>
        <div className="hidden md:flex bg-white shadow-sm border-b p-4 justify-between items-center shrink-0 z-10">
          <div className="font-bold text-gray-700 text-sm">Dashboard / <span className="text-blue-600 capitalize">{view.replace('_', ' ')}</span></div>
          <div className="flex items-center gap-4">
            <div className="relative cursor-pointer text-gray-500 hover:text-blue-600 transition" onClick={() => setView('tukar_jadwal')} title="Notifikasi">
              <Bell className="w-6 h-6" />
              {incomingRequestsCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">{incomingRequestsCount}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">{(user?.name || 'U').charAt(0)}</div>
              <span className="text-sm font-medium text-gray-700">{user?.name}</span>
            </div>
          </div>
        </div>
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white shadow-lg p-2 space-y-1 absolute top-[60px] left-0 w-full z-30 border-b border-gray-200">
            <button onClick={()=>{setView('dashboard'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded ${view==='dashboard'?'bg-blue-50 text-blue-700':''}`}>Dashboard</button>
            <button onClick={()=>{setView('kinerja'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded ${view==='kinerja'?'bg-blue-50 text-blue-700':''}`}>Kinerja Saya</button>
            <button onClick={()=>{setView('tukar_jadwal'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded text-purple-700 font-bold flex justify-between ${view==='tukar_jadwal'?'bg-purple-50':''}`}>
              Tukar Jadwal
              {incomingRequestsCount > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{incomingRequestsCount} Baru</span>}
            </button>
            <button onClick={()=>{setView('jadwal'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded ${view==='jadwal'?'bg-blue-50 text-blue-700':''}`}>Jadwal Publik</button>
            <button onClick={()=>{setView('pengaturan'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded ${view==='pengaturan'?'bg-blue-50 text-blue-700':''}`}>Pengaturan Akun</button>
            
            {((user?.roles || []).includes(ROLES.SUPERADMIN) || (user?.roles || []).includes(ROLES.ADMIN_UNIT)) && (
              <>
                <div className="border-t my-1"></div>
                <div className="px-3 pt-2 pb-1 text-xs font-bold text-gray-400 uppercase">Admin</div>
                <button onClick={()=>{setView('admin_schedule'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='admin_schedule'?'bg-blue-50 text-blue-700':''}`}>Kelola Jadwal</button>
                <button onClick={()=>{setView('admin_stats'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='admin_stats'?'bg-blue-50 text-blue-700':''}`}>Statistik</button>
                <div className="px-3 pt-3 pb-1 text-xs font-bold uppercase text-gray-400">Master</div>
                <button onClick={()=>{setView('admin_db'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='admin_db'?'bg-blue-50 text-blue-700':''}`}>Petugas</button>
                {((user?.roles || []).includes(ROLES.SUPERADMIN) || (user?.units || []).includes(UNITS.MUGER)) && <button onClick={()=>{setView('admin_muger_teams'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='admin_muger_teams'?'bg-purple-50 text-purple-700':''}`}>Muger</button>}
                <button onClick={()=>{setView('master_services'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='master_services'?'bg-blue-50 text-blue-700':''}`}>Ibadah</button>
                <button onClick={()=>{setView('master_units'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='master_units'?'bg-blue-50 text-blue-700':''}`}>Unit</button>
                <button onClick={()=>{setView('master_roles'); setIsMobileMenuOpen(false)}} className={`block w-full text-left p-3 rounded font-medium ${view==='master_roles'?'bg-blue-50 text-blue-700':''}`}>Role</button>
              </>
            )}
            <div className="border-t my-1"></div>
            <button onClick={handleLogout} className="block w-full text-left p-3 text-red-600 font-medium">Keluar</button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto relative">
          {view === 'dashboard' && <Dashboard user={user} assignments={assignments} publishedSchedules={publishedSchedules} swapRequests={swapRequests} customServices={customServices} />}
          {view === 'kinerja' && <UserPerformance user={user} assignments={assignments} personnel={personnel} swapRequests={swapRequests} customServices={customServices} />}
          {view === 'tukar_jadwal' && <ShiftSwap user={user} assignments={assignments} setAssignments={setAssignments} personnel={personnel} swapRequests={swapRequests} setSwapRequests={setSwapRequests} customServices={customServices} />}
          {view === 'jadwal' && <ScheduleViewPublic services={SUNDAY_SERVICES} personnel={personnel} assignments={assignments} selectedDate={dateView} onDateChange={setDateView} customServices={customServices} mugerGroups={mugerGroups} />}
          {view === 'pengaturan' && <UserSettings user={user} setUser={setUser} personnel={personnel} setPersonnel={setPersonnel} />}
          {view === 'admin_schedule' && <ScheduleManager personnel={personnel} assignments={assignments} setAssignments={setAssignments} user={user} publishedSchedules={publishedSchedules} onPublish={handlePublish} swapRequests={swapRequests} customServices={customServices} setCustomServices={setCustomServices} />}
          {view === 'admin_stats' && <AdminStats personnel={personnel} assignments={assignments} swapRequests={swapRequests} customServices={customServices} />}
          {view === 'admin_db' && <AdminDatabase personnel={personnel} setPersonnel={setPersonnel} currentUser={user} />}
          {view === 'admin_muger_teams' && <MugerTeamDirectory personnel={personnel} setPersonnel={setPersonnel} currentUser={user} />}
          {view === 'master_services' && <MasterCrudPage type="services" currentUser={user} />}
          {view === 'master_units' && <MasterCrudPage type="units" currentUser={user} />}
          {view === 'master_roles' && <MasterCrudPage type="roles" currentUser={user} />}
        </div>
      </div>
    </div>
  );
};
export default function App() {
  return (
    <DialogProvider>
      <MainApp />
    </DialogProvider>
  );
}
