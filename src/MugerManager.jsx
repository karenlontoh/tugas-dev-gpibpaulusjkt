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

const INITIAL_COLLABORATIONS = [
  { id:'MC_TANDEM_PELAYAN_MUSIK', name:'Pelayan Musik', type:'TANDEM', sections:[
    { label:'Samuel Tobing', names:['Zarteus Osok','Bobby','Ian Felubun'] },
    { label:'Ricko Sanggelorang', names:['Zarteus Osok','Bobby'] },
    { label:'Jonathan Wibowo', names:['Geraldine Supit'] },
    { label:'Nathania Marahsidi', names:['Nigel Simatupang'] },
    { label:'Rillo Purba', names:['Edita Siregar'] },
  ]},
  { id:'MC_NAFIRI_CHOIR', name:'Nafiri Choir', type:'CHOIR', sections:[
    { label:'Prokantor', names:['John','M Pattiwael'] },
    { label:'Pemusik', names:['Jonathan Wibowo','Geraldine Supit','Suzan Pattiwael Tangka','Rillo Purba'] },
  ]},
  { id:'MC_HOSANA_CHORALE', name:'Hosana Chorale', type:'CHOIR', sections:[
    { label:'Prokantor', names:['Amanda Sitompul'] },
    { label:'Pemusik', names:['Edita Siregar','Rillo Purba'] },
  ]},
  { id:'MC_PS_JEMAAT_PAULUS', name:'PS Jemaat Paulus', type:'CHOIR', sections:[
    { label:'Prokantor', names:['Donda Salakory'] },
    { label:'Pemusik', names:['Ozzy Marpaung'] },
  ]},
  { id:'MC_PS_JEMAAT_SP_VII', name:'PS Jemaat SP VII', type:'CHOIR', sections:[
    { label:'Prokantor', names:['Torez Pattiwael'] },
    { label:'Pemusik', names:['Suzanna C Pattiwael Tangka'] },
  ]},
];

const normalizeName = (value='') => String(value)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/^(pnt|penatua|dkn|diaken)\.?\s+/i,'')
  .replace(/[^a-z0-9]/gi,'').toLowerCase();

const StatusPill = ({status}) => <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${status==='inactive'?'bg-gray-100 text-gray-500':'bg-green-100 text-green-700'}`}>{status==='inactive'?'Nonaktif':'Aktif'}</span>;

export default function MugerManager({ db, personnel, normalizeMemberships, mugerUnitName, showAlert, showConfirm }) {
  const [tab,setTab] = useState('teams');
  const [search,setSearch] = useState('');
  const [teams,setTeams] = useState([]);
  const [collabs,setCollabs] = useState([]);
  const [loading,setLoading] = useState(true);
  const [teamEditor,setTeamEditor] = useState(null);
  const [collabEditor,setCollabEditor] = useState(null);
  const [newTeamName,setNewTeamName] = useState('');
  const [teamMemberSearch,setTeamMemberSearch] = useState('');
  const [collabMemberSearch,setCollabMemberSearch] = useState('');

  const people = useMemo(() => personnel.filter(p=>!p.isTeam).sort((a,b)=>(a.name||'').localeCompare(b.name||'','id')), [personnel]);
  const mugerPeople = useMemo(() => people.filter(p=>normalizeMemberships(p).unitMemberships.some(u=>u.name===mugerUnitName && u.status!=='inactive')), [people,normalizeMemberships,mugerUnitName]);
  const filteredTeamPeople = useMemo(() => mugerPeople.filter(p=>!teamMemberSearch.trim()||(p.name||'').toLowerCase().includes(teamMemberSearch.trim().toLowerCase())), [mugerPeople,teamMemberSearch]);
  const filteredCollabPeople = useMemo(() => mugerPeople.filter(p=>!collabMemberSearch.trim()||(p.name||'').toLowerCase().includes(collabMemberSearch.trim().toLowerCase())), [mugerPeople,collabMemberSearch]);
  const peopleById = useMemo(() => new Map(people.map(p=>[String(p.id),p])), [people]);
  const peopleByName = useMemo(() => new Map(people.map(p=>[normalizeName(p.name),p])), [people]);

  const resolveName = (name) => {
    const exact = peopleByName.get(normalizeName(name));
    if (exact) return exact.id;
    const target = normalizeName(name);
    return people.find(p=>{const current=normalizeName(p.name);return current && target && (current.includes(target)||target.includes(current));})?.id || null;
  };

  const load = async (autoSeed=true) => {
    setLoading(true);
    try {
      const [groupSnap,memberSnap,collabSnap] = await Promise.all([
        getDocs(collection(db,'groups')),
        getDocs(collection(db,'groupMembers')),
        getDocs(collection(db,'musicCollaborations')),
      ]);
      const membersByGroup = new Map();
      memberSnap.docs.forEach(row=>{
        const d=row.data(); const groupId=String(d.groupId||'');
        if(!groupId || (d.status||'active')==='inactive') return;
        if(!membersByGroup.has(groupId)) membersByGroup.set(groupId,[]);
        membersByGroup.get(groupId).push({id:row.id,userId:String(d.userId||''),memberRole:(String(d.memberRole||'').toUpperCase()==='MEMBER'||String(d.memberRole||'').toLowerCase()==='anggota')?'Anggota':(d.memberRole||'Anggota'),status:d.status||'active'});
      });
      setTeams(groupSnap.docs.map(row=>{
        const d=row.data();
        return {id:row.id,name:d.timName||d.groupName||d.name||row.id,type:String(d.type||d.groupType||'MUSIC_TEAM').toUpperCase(),status:d.status||'active',members:membersByGroup.get(row.id)||[]};
      }).filter(g=>['MUSIC_TEAM','TIM_MUSIK','MUSIC TEAM'].includes(g.type)));

      if(collabSnap.empty && autoSeed && people.length){
        const batch=writeBatch(db);
        INITIAL_COLLABORATIONS.forEach(item=>{
          const sections=item.sections.map(section=>({
            label:section.label,
            memberIds:section.names.map(resolveName).filter(Boolean),
            unresolvedNames:section.names.filter(name=>!resolveName(name)),
          }));
          batch.set(doc(db,'musicCollaborations',item.id),{name:item.name,type:item.type,sections,status:'active',createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
        });
        await batch.commit();
        return load(false);
      }
      setCollabs(collabSnap.docs.map(row=>({id:row.id,name:row.data().name||row.id,type:row.data().type||'TANDEM',sections:Array.isArray(row.data().sections)?row.data().sections:[],status:row.data().status||'active'})).sort((a,b)=>a.name.localeCompare(b.name,'id')));
    } catch(error){
      console.error(error);
      await showAlert(`Gagal membaca data Muger: ${error.message||error}`);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(true); },[people.length]);

  const saveTeam = async () => {
    if(!teamEditor?.name?.trim()) return showAlert('Nama tim wajib diisi.');
    try{
      const groupId=String(teamEditor.id||`TM${Date.now()}`);
      const selectedMemberIds=[...new Set((teamEditor.memberIds||[]).map(String))];
      const memberSnap=await getDocs(collection(db,'groupMembers'));

      // Ikuti format seeder: GM00001, GM00002, dan seterusnya.
      // ID lama yang sudah sequential dipertahankan. ID format web lama
      // (GM_tm0001__us0001) dimigrasikan saat tim disimpan kembali.
      let maxMemberNumber=0;
      memberSnap.docs.forEach(row=>{
        const match=String(row.id).match(/^GM(\d+)$/i);
        if(match) maxMemberNumber=Math.max(maxMemberNumber,Number(match[1])||0);
      });

      const currentRows=memberSnap.docs.filter(
        row=>String(row.data().groupId||'')===groupId
      );
      const sequentialByUser=new Map();
      currentRows.forEach(row=>{
        const userId=String(row.data().userId||'');
        if(/^GM\d+$/i.test(row.id) && userId && !sequentialByUser.has(userId)) {
          sequentialByUser.set(userId,row);
        }
      });

      const batch=writeBatch(db);
      batch.set(doc(db,'groups',groupId),{
        groupName:teamEditor.name.trim(),
        timName:teamEditor.name.trim(),
        groupType:'MUSIC_TEAM',
        type:'MUSIC_TEAM',
        status:'active',
        updatedAt:serverTimestamp()
      },{merge:true});

      // Hapus anggota yang sudah tidak dipilih, duplicate, serta ID format lama.
      currentRows.forEach(row=>{
        const userId=String(row.data().userId||'');
        const keepRow=selectedMemberIds.includes(userId) && sequentialByUser.get(userId)?.id===row.id;
        if(!keepRow) batch.delete(row.ref);
      });

      // Pertahankan dokumen sequential yang ada dan buat ID GM##### hanya untuk anggota baru.
      selectedMemberIds.forEach(userId=>{
        const existing=sequentialByUser.get(userId);
        const memberId=existing?.id || `GM${String(++maxMemberNumber).padStart(5,'0')}`;
        batch.set(doc(db,'groupMembers',memberId),{
          groupId,
          userId,
          memberRole:'Anggota',
          status:'active',
          updatedAt:serverTimestamp()
        },{merge:true});
      });

      await batch.commit();
      setTeamEditor(null);
      await load(false);
      await showAlert('Tim Musik berhasil disimpan.');
    }catch(error){await showAlert(`Gagal menyimpan Tim Musik: ${error.message||error}`)}
  };

  const deleteTeam = async team => {
    if(!await showConfirm(`Hapus ${team.name} beserta seluruh anggotanya?`)) return;
    const memberSnap=await getDocs(collection(db,'groupMembers')); const batch=writeBatch(db);
    memberSnap.docs.filter(r=>String(r.data().groupId||'')===String(team.id)).forEach(r=>batch.delete(r.ref));
    batch.delete(doc(db,'groups',team.id)); await batch.commit(); await load(false);
  };

  const updateSection = (index,patch) => setCollabEditor(prev=>({...prev,sections:prev.sections.map((s,i)=>i===index?{...s,...patch}:s)}));
  const toggleMember = (sectionIndex,userId) => {
    const ids=collabEditor.sections[sectionIndex].memberIds||[];
    updateSection(sectionIndex,{memberIds:ids.includes(userId)?ids.filter(id=>id!==userId):[...ids,userId]});
  };

  const saveCollab = async () => {
    if(!collabEditor?.name?.trim()) return showAlert('Nama kolaborasi wajib diisi.');
    const sections=(collabEditor.sections||[]).map(s=>({label:String(s.label||'').trim(),memberIds:[...new Set(s.memberIds||[])],unresolvedNames:[...new Set(s.unresolvedNames||[])]})).filter(s=>s.label||s.memberIds.length||s.unresolvedNames.length);
    if(!sections.length) return showAlert('Tambahkan minimal satu bagian/role.');
    try{
      const id=String(collabEditor.id||`MC_${Date.now()}`);
      await setDoc(doc(db,'musicCollaborations',id),{name:collabEditor.name.trim(),type:collabEditor.type||'TANDEM',sections,status:'active',updatedAt:serverTimestamp()},{merge:true});
      setCollabEditor(null); await load(false); await showAlert('Kolaborasi/Tandeman berhasil disimpan.');
    }catch(error){await showAlert(`Gagal menyimpan kolaborasi: ${error.message||error}`)}
  };

  const deleteCollab = async item => { if(await showConfirm(`Hapus ${item.name}?`)){await deleteDoc(doc(db,'musicCollaborations',item.id));await load(false);} };
  const namesFor = section => [...(section.memberIds||[]).map(id=>peopleById.get(String(id))?.name).filter(Boolean),...(section.unresolvedNames||[])];

  const filteredTeams=teams.filter(team=>!search.trim()||`${team.name} ${(team.members||[]).map(m=>peopleById.get(m.userId)?.name||'').join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const filteredCollabs=collabs.filter(item=>!search.trim()||`${item.name} ${(item.sections||[]).flatMap(s=>[s.label,...namesFor(s)]).join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="p-4 sm:p-6">
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5">
      <div><h2 className="text-2xl font-bold text-gray-900">Kelola Muger</h2><p className="text-sm text-gray-500 mt-1">Kelola Tim Musik dan pengaturan tandem pelayan musik/pelayan pujian.</p></div>
      {tab==='teams'?<button onClick={()=>setTeamEditor({id:`TM${Date.now()}`,name:'',memberIds:[]})} className="inline-flex items-center justify-center bg-purple-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm"><Plus className="w-4 h-4 mr-2"/>Tambah Tim Musik</button>:<button onClick={()=>setCollabEditor({id:`MC_${Date.now()}`,name:'',type:'TANDEM',sections:[{label:'',memberIds:[],unresolvedNames:[]}]})} className="inline-flex items-center justify-center bg-purple-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm"><Plus className="w-4 h-4 mr-2"/>Tambah Kolaborasi</button>}
    </div>
    <div className="bg-white border rounded-xl overflow-hidden mb-4"><div className="flex gap-2 p-3 border-b bg-gray-50"><button onClick={()=>setTab('teams')} className={`px-4 py-2 rounded-lg text-sm font-bold ${tab==='teams'?'bg-purple-600 text-white':'bg-white border text-gray-600'}`}>Tim Musik</button><button onClick={()=>setTab('collab')} className={`px-4 py-2 rounded-lg text-sm font-bold ${tab==='collab'?'bg-purple-600 text-white':'bg-white border text-gray-600'}`}>Kolaborasi / Tandeman</button></div><div className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input value={search} onChange={e=>setSearch(e.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari nama tim, kolaborasi, atau petugas..."/></div></div></div>

    {loading?<div className="bg-white border rounded-xl p-12 text-center text-gray-400">Memuat data...</div>:tab==='teams'?<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{filteredTeams.map(team=><div key={team.id} className="bg-white border rounded-xl overflow-hidden"><div className="p-4 bg-purple-50 border-b flex justify-between"><div><h3 className="font-bold text-purple-900">{team.name}</h3><p className="text-xs text-purple-600">{team.members.length} anggota</p></div><div className="flex gap-2"><button onClick={()=>setTeamEditor({...team,memberIds:team.members.map(m=>m.userId)})} className="px-3 py-1.5 border rounded text-xs font-bold text-purple-700"><Edit3 className="inline w-3.5 h-3.5 mr-1"/>Edit</button><button onClick={()=>deleteTeam(team)} className="text-red-500"><Trash2 className="w-4 h-4"/></button></div></div><div className="divide-y">{team.members.map(member=>{const person=peopleById.get(member.userId);return <div key={`${team.id}-${member.userId}`} className="p-3 flex justify-between"><div><div className="font-semibold text-sm">{person?.name||member.userId}</div><div className="text-xs text-gray-500">{String(member.memberRole||'').toUpperCase()==='MEMBER'?'Anggota':(member.memberRole||'Anggota')}</div></div><StatusPill status={person?.status||member.status}/></div>})}</div></div>)}{!filteredTeams.length&&<div className="xl:col-span-2 bg-white border rounded-xl p-12 text-center text-gray-400">Belum ada Tim Musik.</div>}</div>:<div className="space-y-4">{filteredCollabs.map(item=><div key={item.id} className="bg-white border rounded-xl overflow-hidden"><div className="p-4 bg-purple-50 border-b flex justify-between"><div className="flex gap-2 items-center"><h3 className="font-bold text-purple-900">{item.name}</h3><span className="text-[10px] px-2 py-1 border bg-white rounded-full text-purple-700 font-bold">{item.type==='CHOIR'?'Paduan Suara':'Tandem'}</span></div><div className="flex gap-2"><button onClick={()=>setCollabEditor({...item,sections:item.sections.map(s=>({...s,memberIds:[...(s.memberIds||[])],unresolvedNames:[...(s.unresolvedNames||[])]}))})} className="px-3 py-1.5 border rounded text-xs font-bold text-purple-700"><Edit3 className="inline w-3.5 h-3.5 mr-1"/>Edit</button><button onClick={()=>deleteCollab(item)} className="text-red-500"><Trash2 className="w-4 h-4"/></button></div></div><div className="p-4 space-y-3">{item.sections.map((section,index)=><div key={`${item.id}-${index}`} className="grid sm:grid-cols-[180px_1fr] gap-1"><strong className="text-sm">{section.label}:</strong><span className="text-sm">{namesFor(section).join(' / ')||'-'}</span></div>)}</div></div>)}{!filteredCollabs.length&&<div className="bg-white border rounded-xl p-12 text-center text-gray-400">Belum ada data kolaborasi.</div>}</div>}

    {teamEditor&&<div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4"><div className="bg-white rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5"><div className="flex justify-between border-b pb-3 mb-4"><h3 className="font-bold text-xl">Edit Tim Musik</h3><button onClick={()=>{setTeamEditor(null);setTeamMemberSearch('')}}><X/></button></div><label className="text-xs font-medium">Nama Tim</label><input value={teamEditor.name} onChange={e=>setTeamEditor({...teamEditor,name:e.target.value})} className="w-full border rounded p-2 mt-1 mb-4"/><div className="relative mb-3"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input value={teamMemberSearch} onChange={e=>setTeamMemberSearch(e.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari anggota Muger..."/></div><div className="border rounded max-h-96 overflow-y-auto divide-y">{filteredTeamPeople.map(p=><label key={p.id} className="flex gap-3 p-3"><input type="checkbox" checked={(teamEditor.memberIds||[]).includes(p.id)} onChange={()=>setTeamEditor(prev=>({...prev,memberIds:prev.memberIds.includes(p.id)?prev.memberIds.filter(id=>id!==p.id):[...prev.memberIds,p.id]}))}/><span>{p.name}</span></label>)}{!filteredTeamPeople.length&&<div className="p-6 text-center text-sm text-gray-400">Petugas Muger tidak ditemukan.</div>}</div><div className="flex justify-end gap-2 mt-5"><button onClick={()=>{setTeamEditor(null);setTeamMemberSearch('')}} className="px-4 py-2 border rounded">Batal</button><button onClick={saveTeam} className="px-4 py-2 bg-purple-600 text-white rounded font-bold"><Save className="inline w-4 h-4 mr-2"/>Simpan</button></div></div></div>}

    {collabEditor&&<div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4"><div className="bg-white rounded-xl w-full max-w-3xl max-h-[94vh] overflow-y-auto p-5"><div className="flex justify-between border-b pb-3 mb-4"><h3 className="font-bold text-xl">Edit Kolaborasi / Tandeman</h3><button onClick={()=>setCollabEditor(null)}><X/></button></div><div className="grid sm:grid-cols-2 gap-4 mb-5"><div><label className="text-xs font-medium">Nama</label><input value={collabEditor.name} onChange={e=>setCollabEditor({...collabEditor,name:e.target.value})} className="w-full border rounded p-2 mt-1"/></div><div><label className="text-xs font-medium">Jenis</label><select value={collabEditor.type} onChange={e=>setCollabEditor({...collabEditor,type:e.target.value})} className="w-full border rounded p-2 mt-1"><option value="TANDEM">Tandem / Duet</option><option value="CHOIR">Paduan Suara / Kolaborasi</option></select></div></div><div className="relative mb-4"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input value={collabMemberSearch} onChange={e=>setCollabMemberSearch(e.target.value)} className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm" placeholder="Cari petugas Muger untuk duet / kolaborasi..."/></div><div className="space-y-4">{collabEditor.sections.map((section,index)=><div key={index} className="border rounded-xl p-4"><div className="flex gap-2 mb-3"><input value={section.label} onChange={e=>updateSection(index,{label:e.target.value})} className="flex-1 border rounded p-2" placeholder="Nama pelayan utama / role"/><button onClick={()=>setCollabEditor(prev=>({...prev,sections:prev.sections.filter((_,i)=>i!==index)}))} className="text-red-500"><Trash2/></button></div><div className="border rounded max-h-52 overflow-y-auto grid sm:grid-cols-2">{filteredCollabPeople.map(p=><label key={`${index}-${p.id}`} className="flex gap-2 p-2"><input type="checkbox" checked={(section.memberIds||[]).includes(p.id)} onChange={()=>toggleMember(index,p.id)}/><span className="text-sm">{p.name}</span></label>)}{!filteredCollabPeople.length&&<div className="sm:col-span-2 p-6 text-center text-sm text-gray-400">Petugas Muger tidak ditemukan.</div>}</div><label className="block text-xs text-gray-500 mt-2">Nama tambahan yang belum punya akun (pisahkan koma)</label><input value={(section.unresolvedNames||[]).join(', ')} onChange={e=>updateSection(index,{unresolvedNames:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})} className="w-full border rounded p-2 mt-1 text-sm"/></div>)}</div><button onClick={()=>setCollabEditor(prev=>({...prev,sections:[...prev.sections,{label:'',memberIds:[],unresolvedNames:[]}]}))} className="mt-4 px-3 py-2 border border-purple-300 text-purple-700 rounded text-sm font-bold"><Plus className="inline w-4 h-4 mr-1"/>Tambah Bagian / Role</button><div className="flex justify-end gap-2 mt-5"><button onClick={()=>setCollabEditor(null)} className="px-4 py-2 border rounded">Batal</button><button onClick={saveCollab} className="px-4 py-2 bg-purple-600 text-white rounded font-bold"><Save className="inline w-4 h-4 mr-2"/>Simpan</button></div></div></div>}
  </div>;
}
