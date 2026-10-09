/* MooseTown – koppeling met Supabase.
   Biedt dezelfde functies die de app eerder van claude.ai kreeg:
   MT.use('db')   → collecties/documenten met live updates (tabellen in Supabase)
   MT.use('user') → wie er is ingelogd en de namen van anderen (tabel profiles) */
(function(){
  const cfg=window.MOOSETOWN_CONFIG||{};
  const TABLES=['gardens','beds','plantings','logs','weather','plants'];
  const toSnake=k=>k.replace(/[A-Z]/g,m=>'_'+m.toLowerCase());
  const toCamel=k=>k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
  const toRow=obj=>{const o={};for(const k in obj)o[toSnake(k)]=obj[k]===''?null:obj[k];return o};
  const fromRow=row=>{const o={};for(const k in row){if(k!=='id')o[toCamel(k)]=row[k]}return o};
  const newId=()=>Array.from(crypto.getRandomValues(new Uint8Array(15)),b=>'0123456789abcdefghijklmnopqrstuvwxyz'[b%36]).join('');
  const isUuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
  const mapErr=e=>{const denied=e&&(e.code==='42501'||e.status===401||e.status===403||/row-level security/i.test(e.message||''));
    return {code:denied?'invalid_argument':(e&&e.code==='23503'?'invalid_argument':'unavailable'),message:e?.message||'Onbekende fout'}};

  let sb=null,session=null,readyResolve;const ready=new Promise(r=>readyResolve=r);
  const cache={},listeners={},loaded={},loading={};
  TABLES.forEach(t=>{cache[t]=new Map();listeners[t]=new Set()});

  const snapshot=t=>{const docs=[...cache[t]].map(([id,d])=>({id,exists:true,data:()=>d,metadata:{fromCache:false,hasPendingWrites:false}}));
    return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}};
  const emit=t=>{if(!loaded[t])return;const s=snapshot(t);listeners[t].forEach(l=>{try{l.next(s)}catch(e){console.error(e)}})};

  async function loadTable(t){
    if(loading[t])return loading[t];
    loading[t]=(async()=>{
      const rows=[];
      for(let from=0;;from+=1000){
        const {data,error}=await sb.from(t).select('*').range(from,from+999);
        if(error)throw mapErr(error);
        rows.push(...data);if(data.length<1000)break;
      }
      cache[t]=new Map(rows.map(r=>[r.id,fromRow(r)]));loaded[t]=true;emit(t);
    })().finally(()=>{loading[t]=null});
    return loading[t];
  }
  function subscribe(t){
    sb.channel('mt-'+t)
      .on('postgres_changes',{event:'*',schema:'public',table:t},p=>{
        if(p.eventType==='DELETE'){if(p.old&&p.old.id)cache[t].delete(p.old.id)}
        else if(p.new&&p.new.id)cache[t].set(p.new.id,fromRow(p.new));
        emit(t);
      })
      .subscribe(status=>{if(status==='SUBSCRIBED'&&loaded[t])loadTable(t).catch(()=>{})});
  }
  let started=false;
  function start(){
    if(started)return;started=true;
    TABLES.forEach(subscribe);
    // vangnet: bij terugkeren naar het tabblad alles opnieuw ophalen
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)TABLES.forEach(t=>loaded[t]&&loadTable(t).catch(()=>{}))});
  }

  function docRef(t,id){
    if(!TABLES.includes(t))throw new TypeError('Onbekende collectie: '+t);
    return {id,path:t+'/'+id,
      async get(){const d=cache[t].get(id);return {id,exists:!!d,data:()=>d,metadata:{}}},
      async set(data){
        const before=cache[t].get(id);cache[t].set(id,{...data});emit(t);
        const {error}=await sb.from(t).upsert({id,...toRow(data)});
        if(error){before?cache[t].set(id,before):cache[t].delete(id);emit(t);throw mapErr(error)}
      },
      async update(data){
        const before=cache[t].get(id);if(before){cache[t].set(id,{...before,...data});emit(t)}
        const {error}=await sb.from(t).update(toRow(data)).eq('id',id);
        if(error){if(before){cache[t].set(id,before);emit(t)}throw mapErr(error)}
      },
      async delete(){
        const before=cache[t].get(id);cache[t].delete(id);emit(t);
        const {error}=await sb.from(t).delete().eq('id',id);
        if(error){if(before){cache[t].set(id,before);emit(t)}throw mapErr(error)}
      }};
  }
  const db={
    collection(t){return {path:t,
      doc:id=>docRef(t,id||newId()),
      async add(data){const r=docRef(t,newId());await r.set(data);return r},
      onSnapshot(next,error){
        const l={next,error};listeners[t].add(l);
        if(loaded[t])setTimeout(()=>l.next(snapshot(t)));
        else loadTable(t).catch(e=>{l.error&&l.error(e)});
        return ()=>listeners[t].delete(l);
      }}},
    doc(path){const [t,id]=String(path).split('/');return docRef(t,id)}
  };

  const profileCache=new Map();
  async function loadProfiles(ids){
    const want=[...new Set(ids)].filter(i=>isUuid(i)&&!profileCache.has(i));
    if(want.length){const {data}=await sb.from('profiles').select('id,display_name').in('id',want);(data||[]).forEach(p=>profileCache.set(p.id,p.display_name||''));want.forEach(i=>profileCache.has(i)||profileCache.set(i,''))}
  }
  const myName=()=>profileCache.get(session.user.id)||(session.user.email||'').split('@')[0];
  const user={
    async isOwner(){return true},async canEdit(){return true},async can(){return true},
    async id(){return session.user.id},
    async me(){await loadProfiles([session.user.id]);return {id:session.user.id,name:myName(),avatarUrl:'',color:'',email:session.user.email||null,isOwner:true,canEdit:true}},
    async profiles(ids){ids=[].concat(ids);await loadProfiles(ids);return Object.fromEntries(ids.map(i=>[i,{id:i,name:profileCache.get(i)||'',avatarUrl:'',color:'',email:null,isMe:i===session.user.id,guest:false}]))},
    async name(){return myName()},async search(){return []}
  };

  /* ---------- inloggen ---------- */
  function authScreen(msg){
    let el=document.getElementById('auth');
    if(!el){el=document.createElement('div');el.id='auth';el.className='overlay';document.body.appendChild(el)}
    el.innerHTML=`<form class="modal" id="authform" novalidate>
      <span class="label">MooseTown</span><h2>Inloggen</h2>
      <p class="muted" style="margin:0">Vul je e-mailadres in. Je krijgt een mail met een inloglink; een wachtwoord is niet nodig.</p>
      <label class="field"><span>E-mailadres</span><input type="email" id="authmail" autocomplete="email" required></label>
      <p class="err" id="autherr" ${msg?'':'hidden'}>${msg||''}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Stuur inloglink</button></div></form>`;
    el.querySelector('form').addEventListener('submit',async e=>{
      e.preventDefault();const mail=el.querySelector('#authmail').value.trim(),err=el.querySelector('#autherr');
      if(!/^\S+@\S+\.\S+$/.test(mail)){err.textContent='Vul een geldig e-mailadres in.';err.hidden=false;return}
      const btn=el.querySelector('[type=submit]');btn.disabled=true;
      const {error}=await sb.auth.signInWithOtp({email:mail,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:false}});
      if(error){btn.disabled=false;err.textContent=/signups? not allowed|not found/i.test(error.message)?'Dit e-mailadres heeft nog geen toegang. Vraag de beheerder om je uit te nodigen.':'Versturen lukte niet: '+error.message;err.hidden=false;return}
      el.querySelector('form').innerHTML=`<span class="label">MooseTown</span><h2>Check je mail</h2><p class="muted" style="margin:0">We hebben een inloglink gestuurd naar <b>${mail.replace(/[<>&"]/g,'')}</b>. Open die link op dit apparaat.</p>`;
    });
  }
  function setupScreen(){
    const el=document.createElement('div');el.className='overlay';
    el.innerHTML=`<div class="modal"><h2>MooseTown is nog niet gekoppeld</h2><p class="muted" style="margin:0">Vul in <b>config.js</b> de Project URL en de anon key van je Supabase-project in. Zie LEESMIJ.md.</p></div>`;
    document.body.appendChild(el);
  }

  async function init(){
    if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase){setupScreen();readyResolve(false);return}
    sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,detectSessionInUrl:true}});
    sb.auth.onAuthStateChange((ev,s)=>{
      if(s&&!session){session=s;document.getElementById('auth')?.remove();start();readyResolve(true)}
      else if(ev==='SIGNED_OUT'){location.reload()}
      else if(s)session=s;
    });
    const {data}=await sb.auth.getSession();
    if(data.session){if(!session){session=data.session;start();readyResolve(true)}}
    else authScreen();
  }

  window.MT={
    async use(name){const ok=await ready;if(!ok)return null;return name==='db'?db:name==='user'?user:null},
    async signOut(){await sb.auth.signOut()},
    async setName(n){const {error}=await sb.from('profiles').upsert({id:session.user.id,display_name:n});if(error)throw mapErr(error);profileCache.set(session.user.id,n)}
  };
  init();
})();
