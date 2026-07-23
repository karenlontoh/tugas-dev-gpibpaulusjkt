# Sistem Penugasan GPIB Paulus

Project ini mempertahankan menu dan fitur aplikasi lama, termasuk Dashboard, Kinerja Saya, Tukar Jadwal, Jadwal Publik, Pengaturan Akun, Kelola Jadwal, Statistik, Database, dan Add Petugas.

## Menjalankan

1. Salin `.env.example` menjadi `.env` dan isi konfigurasi Firebase Web App.
2. Jalankan `npm install`.
3. Jalankan `npm run dev`.

## Firebase Rules

Salin isi `firestore.rules` ke Firebase Console > Firestore > Rules lalu klik Publish.

## Seed database dan akun

Letakkan `service-account.json` di root project, lalu jalankan:

```bash
npm run seed -- \
  --file ./Full_Database_Penjadwalan_Petugas.xlsx \
  --service-account ./service-account.json \
  --default-pin 1234
```

Login menggunakan nama pada dropdown dan password awal `1234`.

## Penyimpanan fitur lama

Fitur interface lama menggunakan dokumen kompatibilitas `penugasanData/main`, sedangkan akun, profil, role, unit, dan master data tetap menggunakan collection Firebase hasil seed.

## Update requirement database & Tim Musik

Seed sekarang menggunakan `Sample Value Database.xlsx` secara default.

- Prefix `PNT`, `PENATUA`, `DKN`, atau `DIAKEN` di depan nama diabaikan.
- Satu nama hanya menjadi satu user meskipun punya banyak unit/role.
- Keanggotaan Tim Musik dibentuk otomatis dari kolom `Muger` pada sheet sumber.
- Tim Musik menjadi assignee jadwal dan seluruh anggotanya ikut mendapatkan jadwal tersebut.
- Ibadah 06.00, 08.00, dan semua jadwal 17.00 hanya menyediakan Multimedia `Slide`.

Jalankan ulang seed:

```bash
npm run seed -- \
  --file "./Sample Value Database.xlsx" \
  --service-account ./service-account.json \
  --default-pin 1234
```

## Ketentuan jam petugas Multimedia

Seed membaca kolom `Penugasan` dari file `Petugas Multimedia GPIB Paulus Jakarta.xlsx`.

Contoh:

```bash
npm run seed -- \
  --file "./Sample Value Database.xlsx" \
  --multimedia-file "./Petugas Multimedia GPIB Paulus Jakarta.xlsx" \
  --service-account ./service-account.json \
  --default-pin 1234
```

Aturan yang dikenali:

- `Bisa jam berapa aja`
- `Jam 08.00`
- `Jam 17.00 & 19.00`
- `Jam 19.00`
- `Khusus Tambak` — hanya Ibadah `17.00 SP 1`

## Sinkronisasi data interface ke Firestore

Versi ini mempertahankan `penugasanData/main` sebagai dokumen kompatibilitas UI lama, tetapi setiap perubahan dari interface juga langsung ditulis ke collection terstruktur:

- Tambah/edit/hapus petugas: `users`, `loginDirectory`, `userUnits`, `userRoles`, `groups`, `groupMembers`
- Kelola jadwal dan auto-fill: `scheduleAssignments`
- Permintaan/terima/tolak swap: `swapRequests`
- Ibadah khusus: `services`
- Publish jadwal: `publishedSchedules`

Saat aplikasi pertama kali dibuka oleh admin, data lama juga dimigrasikan ke collection tersebut saat item terkait disimpan. Publish `firestore.rules` terbaru sebelum mengetes operasi tulis.

> Catatan Firebase Authentication: browser tidak boleh membuat akun Auth baru dengan hak admin. Tombol **Tambah Petugas** menyimpan seluruh profil dan relasi petugas ke Firestore. Agar petugas baru dapat login, akun Auth perlu dibuat melalui seed script atau Cloud Function/Admin SDK.

## Fix 2026-07-17

- Semua write ke `penugasanData/main` dibersihkan dari nilai `undefined` sebelum `setDoc`.
- Sinkronisasi collection terstruktur juga membersihkan `undefined`.
- Data dummy `INITIAL_USERS` tidak lagi otomatis disisipkan ke database/interface.
- Firestore tetap menjadi penyimpanan perubahan petugas, unit, role, assignment, swap, services, dan published schedules.
- Input password memakai atribut autocomplete yang sesuai.

## Update July 2026 — Multimedia, Tim Musik, dan Database

- Multimedia 17.00 reguler memakai posisi lengkap (Slide, Cam 1–3, Switcher, PIC).
- Multimedia 17.00 SP 1 hanya membuka Slide.
- Auto-isi 17.00 SP 1 memprioritaskan petugas dengan aturan `Khusus Tambak`.
- Admin Muger dan Superadmin mendapat menu `Tim Musik` untuk melihat detail tim dan anggota.
- Database Petugas memiliki pencarian dan section per unit.
- Tambah Petugas memberi warning untuk nama yang sama atau mirip sebelum data disimpan.


## Multimedia candidate fix

- Petugas Multimedia tidak dibatasi satu kali per hari.
- Role Camera menerima alias `Kameraman`, `Camera`, `Operator Camera`, `Operator Kamera`, dan `Kamera`.
- Hanya membership unit/role berstatus active yang dipakai.
- Cache petugas dinaikkan versinya agar data lama tidak menyebabkan kandidat kosong.


## Camera role compatibility fix

Auto-Isi dan dropdown Camera sekarang mengenali seluruh variasi role:
`Kameraman`, `Cameraman`, `Camera`, `Operator Camera`, `Operator Kamera`,
`Operator Cam`, `Kamera`, `Kamera 1`, dan variasi lain yang mengandung
kata camera/kamera/cam.

Cache petugas dinaikkan versinya agar role lama tidak terbaca dari cache.


Latest: searchable dropdown, full PS/VG, one PS/VG auto-fill, tab order, and same-service hierarchy conflict.


## PS/VG + dropdown search

- Complete PS/VG list is visible in Petugas > PS / Choir.
- PS/VG search dropdown in Muger is no longer clipped by accordion containers.
- Presbiter, Multimedia, and Sound dropdowns now support search.


## Muger PS/VG auto-fill
- PS/VG dipilih acak dari grup dengan pemakaian paling sedikit.
- Tidak lagi selalu memilih GP Paulus Choir.
- PS/VG dipilih sebelum pemandu lagu/pemusik sehingga tandeman prokantor dan pemusik dapat diterapkan.
- IKM tetap memakai GP Singer untuk pemandu lagu.


## Master menu and Firestore CRUD

Sidebar Master contains:
- Petugas
- Muger
- Ibadah (`services`)
- Unit (`units`)
- Role (`roles`)

Each new master page supports search, add, edit, status changes, and delete.
Unit and Role writes follow the current Firestore rules and are restricted to Superadmin.
GP Paulus Choir is prioritized for Ibadah Kaum Muda / 19.00 during Auto-Isi Muger.


## Master type and login fixes

- Master Ibadah stores service types used by the Add Ibadah form.
- Master Unit reads/writes the existing `unitName` / `unitCode` seeder schema.
- Master Role reads/writes the existing `roleName` / `unitName` seeder schema.
- Add Ibadah dropdown listens to Firestore `services` in real time.
- Ibadah Khusus button was removed from unit schedule tabs; add new services from the Ibadah tab.
- Login directory now displays user units and backfills `loginDirectory.units` after an admin signs in.


## Master/Admin/Profile fixes

- Master Ibadah now only shows `SERVICE_TYPE` records; dated scheduled-service documents are hidden.
- Default service types are seeded once into Firestore as `SVC0001...`.
- Add Ibadah dropdown only reads active master service types.
- Login labels: Admin PHMJ = Super Admin; other Admin accounts = Admin.
- Admin accounts are excluded more aggressively from the Petugas database.
- Pengaturan Akun includes editable name, warga jemaat, email, mobile number, telephone number, and real Firebase password update.


## Pelkat unit-role normalization

- Unit master only uses `Pelayanan Anak` and `Persekutuan Teruna`.
- PA class roles: Batita, TK, Kecil, Tanggung.
- PT class roles: Eka, Dwi.
- Scheduling filters each class from the user's active class role.
- Legacy `PA-Batita`, `PA-TK`, `PT-Eka`, etc. are normalized in the UI and ignored in Master Unit.
- Existing `pelkatClasses` remains readable temporarily for backward compatibility.


## Master role reflection in Petugas

- Add/Edit Petugas subscribes directly to Firestore `units` and `roles`.
- New active roles added in Master Role immediately appear in Petugas without refresh.
- New active units added in Master Unit immediately appear for Superadmin.
- Pelkat classes are selected directly as roles; the separate Kelas field was removed.


## Admin scope, statistics, and PS/VG layout

- PS/VG tab shows one clean directory table, correct count, and no empty Petugas table.
- System admin accounts are excluded from Statistics.
- Admin GP can access:
  - Presbiter: edit only IKM P2, P3, P4.
  - Muger: edit only Pemandu Lagu and Pengisi Pujian / PS-VG fields.
- Admin Multimedia, Muger, Sound, PA/PT retain full CRUD access only for their own schedule tab.
- Partial GP access cannot reset, auto-fill, import, or publish whole Presbiter/Muger tabs.


## Petugas table consistency

- PS / Choir now uses the same neutral table styling as the other Petugas sections.
- Warga Jemaat is displayed only in the Muger section.
- Presbiter, Multimedia, GP, PA, PT, Sound, Pendeta, and PS/Choir do not show the Warga Jemaat column.


## Tim Musik schedule and Master Role authority

- A Tim Musik assignment is expanded to every active member from `groupMembers`.
  Members see it in Dashboard, Kinerja Saya, Tukar Jadwal, and Statistics.
- `roles` is now the source of truth for role names shown in Petugas.
- Legacy `Kameramen`, `Kamera`, and similar values map to `Camera` only when
  `Camera` exists as an active Master Role.
- User roles that do not exist in active Master Role are ignored.


## Master Role exact source + Public Calendar

- Active documents in Firestore `roles` are the only accepted role names.
- Legacy names such as Kameramen/Kamera are no longer rendered as separate roles.
- Multimedia matching uses the exact canonical roles: Camera, Switcher,
  Operator Slide, and PIC Multimedia.
- Jadwal Publik now uses a monthly calendar. Selecting a date opens the
  existing detailed schedule below the calendar.


## Delete Petugas and Multimedia rule priority

- Only Superadmin sees the Hapus action for Petugas.
- Deletion removes normalized Firestore records in users, loginDirectory,
  userUnits, userRoles, eligibilities, and groupMembers.
- Multimedia Petugas has a Ketentuan column and filter.
- Auto-Isi prioritizes exact time/service rules first, then PL/Choir-adjusted
  personnel, then Semua Jam. Existing monthly balancing remains active.
