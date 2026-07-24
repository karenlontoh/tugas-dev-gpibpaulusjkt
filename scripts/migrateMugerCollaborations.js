import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const normalize = value =>
  String(value || '').trim().toLowerCase();

const main = async () => {
  const [userSnap, groupSnap, collaborationSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'groups')),
    getDocs(collection(db, 'musicCollaborations')),
  ]);

  const usersByName = new Map(
    userSnap.docs.map(row => {
      const data = row.data() || {};
      const name =
        data.name ||
        data.namaUser ||
        data.displayName ||
        row.id;

      return [
        normalize(name),
        {
          id: data.userId || data.id || row.id,
          name,
        },
      ];
    })
  );

  const groupsByName = new Map(
    groupSnap.docs.map(row => {
      const data = row.data() || {};
      const name =
        data.timName ||
        data.groupName ||
        data.name ||
        row.id;

      return [
        normalize(name),
        {
          id: row.id,
          name,
        },
      ];
    })
  );

  const getUser = name => {
    const user = usersByName.get(normalize(name));

    if (!user) {
      throw new Error(`User tidak ditemukan: ${name}`);
    }

    return user;
  };

  const getGroup = name => {
    const group = groupsByName.get(normalize(name));

    if (!group) {
      throw new Error(`Group tidak ditemukan: ${name}`);
    }

    return group;
  };

  const samuel = getUser('Samuel Tobing');
  const zarteus = getUser('Zarteus Osok');
  const ian = getUser('Ian Felubun');
  const bobby = getUser('Bobby Moel');

  await setDoc(
    doc(db, 'musicCollaborations', 'DUET_MUSIC_001'),
    {
      type: 'DUET',
      name: 'Duet Samuel Tobing',
      status: 'active',
      roleScope: 'Pemusik',
      partnerMode: 'ONE_OF',

      primaryMember: {
        entityType: 'PERSON',
        entityId: samuel.id,
        name: samuel.name,
        role: 'Pemusik',
      },

      partnerOptions: [
        {
          entityType: 'PERSON',
          entityId: zarteus.id,
          name: zarteus.name,
          role: 'Pemusik',
        },
        {
          entityType: 'PERSON',
          entityId: ian.id,
          name: ian.name,
          role: 'Pemusik',
        },
        {
          entityType: 'PERSON',
          entityId: bobby.id,
          name: bobby.name,
          role: 'Pemusik',
        },
      ],
    },
    { merge: true }
  );

  const ferry = getUser('Ferry Kaban');
  const grista = getUser('Grista Kaban Damanik');

  await setDoc(
    doc(db, 'musicCollaborations', 'DUET_PL_001'),
    {
      type: 'DUET',
      name: 'Ferry Kaban & Grista Kaban Damanik',
      status: 'active',
      roleScope: 'Pelayan Pujian',
      partnerMode: 'ALL',

      primaryMember: {
        entityType: 'PERSON',
        entityId: ferry.id,
        name: ferry.name,
        role: 'Pelayan Pujian',
      },

      partnerOptions: [
        {
          entityType: 'PERSON',
          entityId: grista.id,
          name: grista.name,
          role: 'Pelayan Pujian',
        },
      ],
    },
    { merge: true }
  );

  // Contoh kolaborasi choir dengan tim musik
  const gpPaulusChoir = getUser('GP Paulus Choir');
  const tsk12 = getGroup('Tim Musik TSK 12');

  await setDoc(
    doc(db, 'musicCollaborations', 'COLLAB_CHOIR_001'),
    {
      type: 'COLLABORATION',
      name: 'GP Paulus Choir x Tim Musik TSK 12',
      status: 'active',
      memberSelectionMode: 'ALL',

      anchor: {
        entityType: 'PERSON',
        entityId: gpPaulusChoir.id,
        name: gpPaulusChoir.name,
        role: 'Paduan Suara/VG',
      },

      members: [
        {
          entityType: 'GROUP',
          entityId: tsk12.id,
          name: tsk12.name,
          role: 'Tim Musik',
          required: true,
        },
      ],
    },
    { merge: true }
  );

  // Nonaktifkan struktur lama
  for (const row of collaborationSnap.docs) {
    const data = row.data() || {};
    const type = String(data.type || '').toUpperCase();

    if (!['DUET', 'COLLABORATION'].includes(type)) {
      await updateDoc(row.ref, {
        status: 'inactive',
      });
    }
  }

  console.log('Migration Muger selesai.');
};

main().catch(error => {
  console.error('Migration gagal:', error);
  process.exitCode = 1;
});