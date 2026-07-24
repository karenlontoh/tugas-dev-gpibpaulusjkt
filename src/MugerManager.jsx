import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Save, Search, Trash2, X } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const normalizeText = (value = '') => String(value).trim().toLowerCase();
const unique = values => [...new Set((values || []).map(String).filter(Boolean))];

const StatusPill = ({ status }) => (
  <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${status === 'inactive' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
    {status === 'inactive' ? 'Nonaktif' : 'Aktif'}
  </span>
);

const SearchableSelect = ({ value, options, onChange, placeholder = 'Pilih petugas', disabled = false }) => {
  const [keyword, setKeyword] = useState('');
  const filtered = useMemo(() => {
    const q = normalizeText(keyword);
    return options.filter(option => !q || normalizeText(option.label).includes(q));
  }, [options, keyword]);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
        <input
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
          placeholder="Cari..."
          disabled={disabled}
        />
      </div>
      <select
        value={value || ''}
        onChange={event => onChange(event.target.value)}
        className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {filtered.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
};

export default function MugerManager({ db, personnel, normalizeMemberships, mugerUnitName, showAlert, showConfirm }) {
  const [tab, setTab] = useState('teams');
  const [search, setSearch] = useState('');
  const [teams, setTeams] = useState([]);
  const [relations, setRelations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamEditor, setTeamEditor] = useState(null);
  const [relationEditor, setRelationEditor] = useState(null);
  const [teamMemberSearch, setTeamMemberSearch] = useState('');

  const people = useMemo(
    () => personnel.filter(person => !person.isTeam).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id')),
    [personnel]
  );

  const mugerPeople = useMemo(() => people.filter(person => {
    if (person.status === 'inactive') return false;
    const memberships = normalizeMemberships(person);
    return memberships.unitMemberships.some(unit => unit.name === mugerUnitName && unit.status !== 'inactive');
  }), [people, normalizeMemberships, mugerUnitName]);

  const peopleById = useMemo(() => new Map(people.map(person => [String(person.id), person])), [people]);
  const teamsById = useMemo(() => new Map(teams.map(team => [String(team.id), team])), [teams]);

  const activeRoleNames = useMemo(() => {
    const names = [];
    mugerPeople.forEach(person => {
      const memberships = normalizeMemberships(person);
      memberships.roleMemberships
        .filter(role => role.status !== 'inactive' && (!role.unit || role.unit === mugerUnitName))
        .forEach(role => {
          if (role.name) names.push(role.name);
        });
    });
    return unique(names).sort((a, b) => a.localeCompare(b, 'id'));
  }, [mugerPeople, normalizeMemberships, mugerUnitName]);

  const getPeopleForRole = roleName => mugerPeople.filter(person => {
    const memberships = normalizeMemberships(person);
    return memberships.roleMemberships.some(role => (
      role.status !== 'inactive' &&
      role.name === roleName &&
      (!role.unit || role.unit === mugerUnitName)
    ));
  });

  const entityOptionsForGroup = group => {
    if (group.entityType === 'GROUP') {
      return teams
        .filter(team => team.status !== 'inactive')
        .map(team => ({ value: String(team.id), label: team.name }));
    }
    return getPeopleForRole(group.roleName)
      .map(person => ({ value: String(person.id), label: person.name }));
  };

  const load = async () => {
    setLoading(true);
    try {
      const [groupSnap, memberSnap, relationSnap] = await Promise.all([
        getDocs(collection(db, 'groups')),
        getDocs(collection(db, 'groupMembers')),
        getDocs(collection(db, 'musicCollaborations')),
      ]);

      const membersByGroup = new Map();
      memberSnap.docs.forEach(row => {
        const data = row.data() || {};
        const groupId = String(data.groupId || '');
        if (!groupId || (data.status || 'active') === 'inactive') return;
        if (!membersByGroup.has(groupId)) membersByGroup.set(groupId, []);
        membersByGroup.get(groupId).push({
          id: row.id,
          userId: String(data.userId || ''),
          memberRole: data.memberRole || 'Anggota',
          status: data.status || 'active',
        });
      });

      const nextTeams = groupSnap.docs.map(row => {
        const data = row.data() || {};
        return {
          id: row.id,
          name: data.timName || data.groupName || data.name || row.id,
          type: String(data.type || data.groupType || 'MUSIC_TEAM').toUpperCase(),
          status: data.status || 'active',
          leaderId: String(data.leaderId || data.coordinatorId || ''),
          members: membersByGroup.get(row.id) || [],
        };
      }).filter(group => ['MUSIC_TEAM', 'TIM_MUSIK', 'MUSIC TEAM'].includes(group.type));
      setTeams(nextTeams);

      const nextRelations = relationSnap.docs.map(row => {
        const data = row.data() || {};
        const type = String(data.type || '').toUpperCase();
        if (!['DUET', 'COLLABORATION'].includes(type)) return null;
        return {
          id: row.id,
          type,
          status: data.status || 'active',
          groups: Array.isArray(data.groups)
            ? data.groups.map(group => ({
                roleName: String(group.roleName || ''),
                entityType: group.entityType === 'GROUP' ? 'GROUP' : 'PERSON',
                memberIds: unique(group.memberIds),
              }))
            : [],
        };
      }).filter(Boolean);
      setRelations(nextRelations);
    } catch (error) {
      console.error(error);
      await showAlert(`Gagal membaca data Muger: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [people.length]);

  const filteredTeamPeople = useMemo(() => {
    const q = normalizeText(teamMemberSearch);
    return mugerPeople.filter(person => !q || normalizeText(person.name).includes(q));
  }, [mugerPeople, teamMemberSearch]);

  const saveTeam = async () => {
    if (!teamEditor?.name?.trim()) return showAlert('Nama tim wajib diisi.');
    try {
      const groupId = String(teamEditor.id || `TM${Date.now()}`);
      const selectedMemberIds = unique(teamEditor.memberIds);
      const leaderId = String(teamEditor.leaderId || '');
      if (!leaderId) return showAlert('Koordinator Tim Musik wajib dipilih.');
      if (!selectedMemberIds.includes(leaderId)) return showAlert('Koordinator harus termasuk dalam anggota Tim Musik.');
      const memberSnap = await getDocs(collection(db, 'groupMembers'));
      let maxMemberNumber = 0;
      memberSnap.docs.forEach(row => {
        const match = String(row.id).match(/^GM(\d+)$/i);
        if (match) maxMemberNumber = Math.max(maxMemberNumber, Number(match[1]) || 0);
      });

      const currentRows = memberSnap.docs.filter(row => String(row.data().groupId || '') === groupId);
      const sequentialByUser = new Map();
      currentRows.forEach(row => {
        const userId = String(row.data().userId || '');
        if (/^GM\d+$/i.test(row.id) && userId && !sequentialByUser.has(userId)) sequentialByUser.set(userId, row);
      });

      const batch = writeBatch(db);
      batch.set(doc(db, 'groups', groupId), {
        groupName: teamEditor.name.trim(),
        timName: teamEditor.name.trim(),
        groupType: 'MUSIC_TEAM',
        type: 'MUSIC_TEAM',
        status: 'active',
        leaderId,
        coordinatorId: leaderId,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      currentRows.forEach(row => {
        const userId = String(row.data().userId || '');
        const keep = selectedMemberIds.includes(userId) && sequentialByUser.get(userId)?.id === row.id;
        if (!keep) batch.delete(row.ref);
      });

      selectedMemberIds.forEach(userId => {
        const existing = sequentialByUser.get(userId);
        const memberId = existing?.id || `GM${String(++maxMemberNumber).padStart(5, '0')}`;
        batch.set(doc(db, 'groupMembers', memberId), {
          groupId,
          userId,
          memberRole: userId === leaderId ? 'Koordinator' : 'Anggota',
          status: 'active',
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });

      await batch.commit();
      setTeamEditor(null);
      setTeamMemberSearch('');
      await load();
      await showAlert('Tim Musik berhasil disimpan.');
    } catch (error) {
      await showAlert(`Gagal menyimpan Tim Musik: ${error.message || error}`);
    }
  };

  const deleteTeam = async team => {
    if (!await showConfirm(`Hapus ${team.name} beserta seluruh anggotanya?`)) return;
    const memberSnap = await getDocs(collection(db, 'groupMembers'));
    const batch = writeBatch(db);
    memberSnap.docs
      .filter(row => String(row.data().groupId || '') === String(team.id))
      .forEach(row => batch.delete(row.ref));
    batch.delete(doc(db, 'groups', team.id));
    await batch.commit();
    await load();
  };

  const newDuet = () => ({
    id: `MC_${Date.now()}`,
    type: 'DUET',
    status: 'active',
    groups: [{ roleName: activeRoleNames[0] || '', entityType: 'PERSON', memberIds: ['', ''] }],
  });

  const newCollaboration = () => ({
    id: `MC_${Date.now()}`,
    type: 'COLLABORATION',
    status: 'active',
    groups: [
      { roleName: activeRoleNames[0] || '', entityType: 'PERSON', memberIds: [''] },
      { roleName: activeRoleNames[1] || activeRoleNames[0] || '', entityType: 'PERSON', memberIds: [''] },
    ],
  });

  const setGroup = (groupIndex, patch) => setRelationEditor(previous => ({
    ...previous,
    groups: previous.groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group),
  }));

  const setMember = (groupIndex, memberIndex, memberId) => setRelationEditor(previous => ({
    ...previous,
    groups: previous.groups.map((group, index) => {
      if (index !== groupIndex) return group;
      const memberIds = [...group.memberIds];
      memberIds[memberIndex] = memberId;
      return { ...group, memberIds };
    }),
  }));

  const addMember = groupIndex => setRelationEditor(previous => ({
    ...previous,
    groups: previous.groups.map((group, index) => index === groupIndex
      ? { ...group, memberIds: [...group.memberIds, ''] }
      : group),
  }));

  const removeMember = (groupIndex, memberIndex) => setRelationEditor(previous => ({
    ...previous,
    groups: previous.groups.map((group, index) => index === groupIndex
      ? { ...group, memberIds: group.memberIds.filter((_, idx) => idx !== memberIndex) }
      : group),
  }));

  const addCollaborationGroup = () => setRelationEditor(previous => ({
    ...previous,
    groups: [...previous.groups, { roleName: activeRoleNames[0] || '', entityType: 'PERSON', memberIds: [''] }],
  }));

  const saveRelation = async () => {
    const groups = (relationEditor.groups || []).map(group => ({
      roleName: String(group.roleName || '').trim(),
      entityType: group.entityType === 'GROUP' ? 'GROUP' : 'PERSON',
      memberIds: unique(group.memberIds),
    })).filter(group => group.roleName && group.memberIds.length);

    if (relationEditor.type === 'DUET') {
      if (groups.length !== 1) return showAlert('Duet harus memiliki satu role.');
      if (groups[0].entityType !== 'PERSON') return showAlert('Duet hanya dapat berisi petugas.');
      if (groups[0].memberIds.length < 2) return showAlert('Duet minimal berisi dua petugas.');
    } else {
      if (groups.length < 2) return showAlert('Kolaborasi minimal terdiri dari dua role/grup.');
    }

    try {
      await setDoc(doc(db, 'musicCollaborations', String(relationEditor.id)), {
        type: relationEditor.type,
        groups,
        status: 'active',
        updatedAt: serverTimestamp(),
      }, { merge: false });
      setRelationEditor(null);
      await load();
      await showAlert(`${relationEditor.type === 'DUET' ? 'Duet' : 'Kolaborasi'} berhasil disimpan.`);
    } catch (error) {
      await showAlert(`Gagal menyimpan data: ${error.message || error}`);
    }
  };

  const deleteRelation = async item => {
    if (!await showConfirm(`Hapus ${item.type === 'DUET' ? 'duet' : 'kolaborasi'} ini?`)) return;
    await deleteDoc(doc(db, 'musicCollaborations', item.id));
    await load();
  };

  const entityName = (entityType, id) => entityType === 'GROUP'
    ? teamsById.get(String(id))?.name || String(id)
    : peopleById.get(String(id))?.name || String(id);

  const relationTitle = relation => {
    if (relation.type === 'DUET') return `Duet ${relation.groups[0]?.roleName || ''}`.trim();
    const firstMember = relation.groups.flatMap(group => group.memberIds.map(id => entityName(group.entityType, id)))[0];
    return firstMember ? `Kolaborasi ${firstMember}` : 'Kolaborasi';
  };

  const relationSearchText = relation => [
    relationTitle(relation),
    ...relation.groups.flatMap(group => [group.roleName, ...group.memberIds.map(id => entityName(group.entityType, id))]),
  ].join(' ').toLowerCase();

  const filteredTeams = teams.filter(team => !search.trim() || `${team.name} ${(team.members || []).map(member => peopleById.get(member.userId)?.name || '').join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const duetRows = relations.filter(item => item.type === 'DUET' && (!search.trim() || relationSearchText(item).includes(search.toLowerCase())));
  const collaborationRows = relations.filter(item => item.type === 'COLLABORATION' && (!search.trim() || relationSearchText(item).includes(search.toLowerCase())));

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Kelola Muger</h2>
          <p className="text-sm text-gray-500 mt-1">Kelola Tim Musik, duet dalam satu role, dan kolaborasi lintas role.</p>
        </div>
        {tab === 'teams' && (
          <button onClick={() => setTeamEditor({ id: `TM${Date.now()}`, name: '', leaderId: '', memberIds: [] })} className="inline-flex items-center justify-center bg-purple-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm">
            <Plus className="w-4 h-4 mr-2" />Tambah Tim Musik
          </button>
        )}
        {tab === 'duets' && (
          <button onClick={() => setRelationEditor(newDuet())} className="inline-flex items-center justify-center bg-purple-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm">
            <Plus className="w-4 h-4 mr-2" />Tambah Duet
          </button>
        )}
        {tab === 'collaborations' && (
          <button onClick={() => setRelationEditor(newCollaboration())} className="inline-flex items-center justify-center bg-purple-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm">
            <Plus className="w-4 h-4 mr-2" />Tambah Kolaborasi
          </button>
        )}
      </div>

      <div className="bg-white border rounded-xl overflow-hidden mb-4">
        <div className="flex flex-wrap gap-2 p-3 border-b bg-gray-50">
          {[
            ['teams', 'Tim Musik'],
            ['duets', 'Duet'],
            ['collaborations', 'Kolaborasi'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-lg text-sm font-bold ${tab === id ? 'bg-purple-600 text-white' : 'bg-white border text-gray-600'}`}>{label}</button>
          ))}
        </div>
        <div className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari tim atau petugas..." />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border rounded-xl p-12 text-center text-gray-400">Memuat data...</div>
      ) : tab === 'teams' ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredTeams.map(team => (
            <div key={team.id} className="bg-white border rounded-xl overflow-hidden">
              <div className="p-4 bg-purple-50 border-b flex justify-between">
                <div><h3 className="font-bold text-purple-900">{team.name}</h3><p className="text-xs text-purple-600">{team.members.length} anggota</p></div>
                <div className="flex gap-2">
                  <button onClick={() => setTeamEditor({ ...team, leaderId: team.leaderId || team.members.find(member => normalizeText(member.memberRole) === 'koordinator')?.userId || '', memberIds: team.members.map(member => member.userId) })} className="px-3 py-1.5 border rounded text-xs font-bold text-purple-700"><Edit3 className="inline w-3.5 h-3.5 mr-1" />Edit</button>
                  <button onClick={() => deleteTeam(team)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="divide-y">
                {team.members.map(member => {
                  const person = peopleById.get(member.userId);
                  return <div key={`${team.id}-${member.userId}`} className="p-3 flex justify-between"><div><div className="font-semibold text-sm">{person?.name || member.userId}</div><div className="text-xs text-gray-500">{member.memberRole || 'Anggota'}</div></div><StatusPill status={person?.status || member.status} /></div>;
                })}
              </div>
            </div>
          ))}
          {!filteredTeams.length && <div className="xl:col-span-2 bg-white border rounded-xl p-12 text-center text-gray-400">Belum ada Tim Musik.</div>}
        </div>
      ) : (
        <div className="space-y-4">
          {(tab === 'duets' ? duetRows : collaborationRows).map(item => (
            <div key={item.id} className="bg-white border rounded-xl overflow-hidden">
              <div className="p-4 bg-purple-50 border-b flex justify-between gap-3">
                <div>
                  <h3 className="font-bold text-purple-900">{relationTitle(item)}</h3>
                  <span className="inline-block mt-1 text-[10px] px-2 py-1 border bg-white rounded-full text-purple-700 font-bold">{item.type === 'DUET' ? 'Duet' : 'Kolaborasi'}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setRelationEditor({ ...item, groups: item.groups.map(group => ({ ...group, memberIds: [...group.memberIds] })) })} className="px-3 py-1.5 border rounded text-xs font-bold text-purple-700"><Edit3 className="inline w-3.5 h-3.5 mr-1" />Edit</button>
                  <button onClick={() => deleteRelation(item)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {item.groups.map((group, index) => (
                  <div key={`${item.id}-${index}`} className="grid sm:grid-cols-[180px_1fr] gap-1">
                    <strong className="text-sm">{group.roleName}:</strong>
                    <span className="text-sm">{group.memberIds.map(id => entityName(group.entityType, id)).join(' / ') || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!(tab === 'duets' ? duetRows : collaborationRows).length && <div className="bg-white border rounded-xl p-12 text-center text-gray-400">Belum ada data.</div>}
        </div>
      )}

      {teamEditor && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5">
            <div className="flex justify-between border-b pb-3 mb-4"><h3 className="font-bold text-xl">Edit Tim Musik</h3><button onClick={() => setTeamEditor(null)}><X /></button></div>
            <label className="text-xs font-medium">Nama Tim</label>
            <input value={teamEditor.name} onChange={event => setTeamEditor({ ...teamEditor, name: event.target.value })} className="w-full border rounded p-2 mt-1 mb-4" />
            <label className="text-xs font-medium">Koordinator Tim</label>
            <select value={teamEditor.leaderId || ''} onChange={event => setTeamEditor({ ...teamEditor, leaderId: event.target.value })} className="w-full border rounded p-2 mt-1 mb-4 bg-white">
              <option value="">Pilih koordinator</option>
              {(teamEditor.memberIds || []).map(id => <option key={id} value={id}>{peopleById.get(String(id))?.name || id}</option>)}
            </select>
            <div className="relative mb-3"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" /><input value={teamMemberSearch} onChange={event => setTeamMemberSearch(event.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari anggota Muger..." /></div>
            <div className="border rounded max-h-96 overflow-y-auto divide-y">
              {filteredTeamPeople.map(person => <label key={person.id} className="flex gap-3 p-3"><input type="checkbox" checked={(teamEditor.memberIds || []).includes(person.id)} onChange={() => setTeamEditor(previous => ({ ...previous, memberIds: previous.memberIds.includes(person.id) ? previous.memberIds.filter(id => id !== person.id) : [...previous.memberIds, person.id] }))} /><span>{person.name}</span></label>)}
            </div>
            <div className="flex justify-end gap-2 mt-5"><button onClick={() => setTeamEditor(null)} className="px-4 py-2 border rounded">Batal</button><button onClick={saveTeam} className="px-4 py-2 bg-purple-600 text-white rounded font-bold"><Save className="inline w-4 h-4 mr-2" />Simpan</button></div>
          </div>
        </div>
      )}

      {relationEditor && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[94vh] overflow-y-auto p-5">
            <div className="flex justify-between border-b pb-3 mb-4"><h3 className="font-bold text-xl">{relationEditor.type === 'DUET' ? 'Edit Duet' : 'Edit Kolaborasi'}</h3><button onClick={() => setRelationEditor(null)}><X /></button></div>

            {relationEditor.groups.map((group, groupIndex) => (
              <div key={groupIndex} className="border rounded-xl p-4 mb-4">
                <div className="flex items-end gap-3 mb-4">
                  <div className="flex-1">
                    <label className="text-xs font-medium">Role</label>
                    <select
                      value={group.entityType === 'GROUP' ? '__GROUP__' : group.roleName}
                      onChange={event => {
                        const isGroup = event.target.value === '__GROUP__';
                        setGroup(groupIndex, {
                          entityType: isGroup ? 'GROUP' : 'PERSON',
                          roleName: isGroup ? 'Tim Musik' : event.target.value,
                          memberIds: [''],
                        });
                      }}
                      className="w-full border rounded-lg px-3 py-2 mt-1 bg-white"
                      disabled={relationEditor.type === 'DUET' && groupIndex > 0}
                    >
                      <option value="">Pilih role</option>
                      {activeRoleNames.map(roleName => <option key={roleName} value={roleName}>{roleName}</option>)}
                      {relationEditor.type === 'COLLABORATION' && teams.length > 0 && <option value="__GROUP__">Tim Musik</option>}
                    </select>
                  </div>
                  {relationEditor.type === 'COLLABORATION' && relationEditor.groups.length > 2 && (
                    <button onClick={() => setRelationEditor(previous => ({ ...previous, groups: previous.groups.filter((_, index) => index !== groupIndex) }))} className="p-2 text-red-500"><Trash2 className="w-5 h-5" /></button>
                  )}
                </div>

                <div className="space-y-3">
                  {group.memberIds.map((memberId, memberIndex) => (
                    <div key={memberIndex} className="flex items-start gap-2">
                      <div className="flex-1">
                        <SearchableSelect
                          value={memberId}
                          options={entityOptionsForGroup(group)}
                          onChange={value => setMember(groupIndex, memberIndex, value)}
                          placeholder={group.entityType === 'GROUP' ? 'Pilih Tim Musik' : 'Pilih petugas'}
                          disabled={!group.roleName}
                        />
                      </div>
                      {group.memberIds.length > 1 && <button onClick={() => removeMember(groupIndex, memberIndex)} className="mt-1 p-2 text-red-500"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  ))}
                </div>

                <button onClick={() => addMember(groupIndex)} className="mt-3 px-3 py-2 border border-purple-300 text-purple-700 rounded text-sm font-bold"><Plus className="inline w-4 h-4 mr-1" />Tambah Petugas</button>
              </div>
            ))}

            {relationEditor.type === 'COLLABORATION' && (
              <button onClick={addCollaborationGroup} className="px-3 py-2 border border-purple-300 text-purple-700 rounded text-sm font-bold"><Plus className="inline w-4 h-4 mr-1" />Tambah Role</button>
            )}

            <div className="flex justify-end gap-2 mt-5"><button onClick={() => setRelationEditor(null)} className="px-4 py-2 border rounded">Batal</button><button onClick={saveRelation} className="px-4 py-2 bg-purple-600 text-white rounded font-bold"><Save className="inline w-4 h-4 mr-2" />Simpan</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
