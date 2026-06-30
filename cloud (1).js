/* ============================================================
   Sprout — 로그인 / 클라우드 동기화 / 친구 코드 둘러보기
   config.js 의 SPROUT_SUPABASE_URL/KEY 가 없으면 로컬 전용.
============================================================ */
(function(){
  "use strict";

  const URL_ = window.SPROUT_SUPABASE_URL || "";
  const KEY_ = window.SPROUT_SUPABASE_KEY || "";
  if(!URL_ || !KEY_) return;
  if(typeof supabase === "undefined" || !supabase.createClient){
    console.warn("[cloud] supabase-js 미로드"); return;
  }

  const sb = supabase.createClient(URL_, KEY_);

  const SPROUT_KEYS = [
    'sprout.cats','sprout.inbox','sprout.blocks','sprout.events','sprout.pomo',
    'sprout.habits','sprout.ddays','sprout.sleep','sprout.diary',
    'sprout.frog','sprout.doses','sprout.projects','sprout.weekly'
  ];

  /* ── 상태 ── */
  let session = null, myPlannerId = null, myFriendCode = null;
  let browsing = false, mySnapshot = null;
  const pushTimers = {};
  let friends = JSON.parse(localStorage.getItem('sprout.friends') || '[]');
  // friends: [{code, name, plannerId}]

  /* ── localStorage 헬퍼 ── */
  function snapLocal(){ const o={}; SPROUT_KEYS.forEach(k=>{o[k]=localStorage.getItem(k);}); return o; }
  function restoreLocal(s){ SPROUT_KEYS.forEach(k=>{ if(s[k]==null) localStorage.removeItem(k); else localStorage.setItem(k,s[k]); }); }
  function readLocal(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return undefined; } }
  function escape(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function saveFriends(){ localStorage.setItem('sprout.friends', JSON.stringify(friends)); }

  /* ── 클라우드 push (디바운스) ── */
  window.__cloudPush = function(key, value){
    if(!session || !myPlannerId || browsing) return;
    if(!SPROUT_KEYS.includes(key)) return;
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(async ()=>{
      await sb.from('planner_state').upsert(
        { planner_id:myPlannerId, key, value, updated_at:new Date().toISOString() },
        { onConflict:'planner_id,key' }
      );
    }, 600);
  };

  function pushAll(){
    SPROUT_KEYS.forEach(k=>{ const v=readLocal(k); if(v!==undefined) window.__cloudPush(k,v); });
  }

  /* ── 내 플래너 pull ── */
  async function pullMine(){
    if(!myPlannerId) return;
    const {data,error} = await sb.from('planner_state').select('key,value').eq('planner_id',myPlannerId);
    if(error){ console.warn('[cloud] pull 실패', error); return; }
    (data||[]).forEach(r=>localStorage.setItem(r.key, JSON.stringify(r.value)));
    if(window.__sproutReload) window.__sproutReload();
  }

  /* ── 플래너 보장 ── */
  async function ensurePlanner(){
    const {data:mine} = await sb.from('planners').select('id').eq('owner_id',session.user.id).limit(1);
    if(mine && mine.length) return {id:mine[0].id, isNew:false};
    const name=(session.user.email||'나').split('@')[0]+"의 플래너";
    const {data:c} = await sb.from('planners').insert({owner_id:session.user.id,name}).select('id').single();
    return c ? {id:c.id, isNew:true} : null;
  }

  /* ── 내 친구코드 읽기 ── */
  async function fetchFriendCode(){
    const {data} = await sb.from('profiles').select('friend_code').eq('id',session.user.id).single();
    return data ? data.friend_code : null;
  }

  /* ── 친구 코드로 플래너 찾기 ── */
  async function findPlannerByCode(code){
    code = code.trim().toUpperCase();
    const {data:prof,error} = await sb.from('profiles').select('id,display_name,friend_code').eq('friend_code',code).single();
    if(error||!prof) return null;
    const {data:plan} = await sb.from('planners').select('id,name').eq('owner_id',prof.id).single();
    if(!plan) return null;
    return {code:prof.friend_code, name:prof.display_name||plan.name, plannerId:plan.id};
  }

  /* ── 둘러보기 ── */
  async function browsePlanner(plannerId, name){
    if(!browsing) mySnapshot = snapLocal();
    const {data,error} = await sb.from('planner_state').select('key,value').eq('planner_id',plannerId);
    if(error){ alert('불러오기 실패: '+error.message); return; }
    SPROUT_KEYS.forEach(k=>localStorage.removeItem(k));
    (data||[]).forEach(r=>localStorage.setItem(r.key, JSON.stringify(r.value)));
    window.__readOnly = true;
    browsing = true;
    closeSheet();
    if(window.__sproutReload) window.__sproutReload();
    updateBanner(name);
  }
  function exitBrowse(){
    if(!browsing) return;
    restoreLocal(mySnapshot);
    window.__readOnly = false;
    browsing = false;
    if(window.__sproutReload) window.__sproutReload();
    updateBanner(null);
  }

  /* ── UI 삽입 ── */
  const appEl = document.querySelector('.app');

  /* 우상단 ☁ 버튼 */
  const btn = document.createElement('button');
  btn.id = 'cloudBtn';
  btn.setAttribute('aria-label', '클라우드 / 로그인');
  btn.style.cssText =
    'position:absolute;right:14px;top:calc(10px + env(safe-area-inset-top));z-index:30;'
    +'width:40px;height:40px;border:0;border-radius:50%;'
    +'background:rgba(255,255,255,.7);backdrop-filter:blur(6px);'
    +'box-shadow:0 2px 12px -4px rgba(110,150,80,.35);'
    +'font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ink)';
  btn.textContent = '☁';
  appEl.appendChild(btn);

  /* 배너 */
  const banner = document.createElement('div');
  banner.id = 'browseBanner';
  banner.hidden = true;
  banner.style.cssText =
    'position:absolute;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);'
    +'z-index:35;background:var(--green-deep);color:#fff;font-weight:700;font-size:12px;'
    +'padding:7px 14px;border-radius:20px;display:flex;align-items:center;gap:8px;'
    +'box-shadow:var(--shadow);white-space:nowrap;pointer-events:auto';
  appEl.appendChild(banner);

  /* 시트 */
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = 'cloudScrim';
  appEl.appendChild(scrim);

  const sheet = document.createElement('div');
  sheet.className = 'sheet'; sheet.id = 'cloudSheet';
  sheet.innerHTML = '<div class="grab"></div><div id="cloudPanel"></div>';
  appEl.appendChild(sheet);

  function openSheet(){ scrim.classList.add('on'); sheet.classList.add('on'); renderPanel(); }
  function closeSheet(){ scrim.classList.remove('on'); sheet.classList.remove('on'); }
  btn.addEventListener('click', openSheet);
  scrim.addEventListener('click', closeSheet);

  /* ── 배너 업데이트 ── */
  function updateBanner(browsingName){
    btn.style.background = (session && !browsing)
      ? 'var(--green-deep)' : 'rgba(255,255,255,.7)';
    btn.style.color = (session && !browsing) ? '#fff' : 'var(--ink)';
    btn.textContent = session ? (browsing ? '👀' : '☁') : '☁';
    if(browsingName){
      banner.hidden = false;
      banner.innerHTML = `👀 ${escape(browsingName)} 플래너 (읽기 전용)&nbsp;`
        +'<button id="exitBrowseBtn" style="border:0;background:rgba(255,255,255,.25);color:#fff;'
        +'border-radius:9px;padding:3px 9px;font:inherit;font-weight:700;cursor:pointer">내 플래너로</button>';
      document.getElementById('exitBrowseBtn').addEventListener('click', exitBrowse);
    } else {
      banner.hidden = true;
    }
  }

  /* ── 패널 렌더 ── */
  function renderPanel(){
    const el = document.getElementById('cloudPanel');
    if(!session){ renderLoginPanel(el); return; }
    renderMainPanel(el);
  }

  /* 로그인 패널 */
  function renderLoginPanel(el){
    el.innerHTML = `
      <h3 style="font-size:16px;color:var(--ink);margin-top:0">☁ 로그인</h3>
      <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 14px">로그인하면 어느 기기에서나 같은 데이터를 쓸 수 있어요.</p>
      <h3>이메일</h3>
      <input type="email" class="ed-text" id="cloudEmail" placeholder="이메일 주소" autocomplete="email" style="margin-bottom:8px">
      <h3>비밀번호</h3>
      <input type="password" class="ed-text" id="cloudPw" placeholder="6자 이상" autocomplete="current-password">
      <div id="cloudMsg" style="font-size:12.5px;min-height:18px;margin-top:8px"></div>
      <div class="ed-actions" style="margin-top:14px">
        <button class="btn-sub" id="cloudSignup">회원가입</button>
        <button class="btn-save" id="cloudLogin">로그인</button>
      </div>`;
    const doAuth = async (mode) => {
      const email = document.getElementById('cloudEmail').value.trim();
      const pw = document.getElementById('cloudPw').value;
      const msg = document.getElementById('cloudMsg');
      msg.style.color = '#C76B4E'; msg.textContent = '';
      if(!email || pw.length < 6){ msg.textContent = '이메일과 6자 이상 비밀번호를 입력하세요.'; return; }
      document.getElementById('cloudLogin').disabled = true;
      document.getElementById('cloudSignup').disabled = true;
      try{
        if(mode === 'login'){
          const {error} = await sb.auth.signInWithPassword({email, password:pw});
          if(error) throw error;
        } else {
          const {data,error} = await sb.auth.signUp({email, password:pw});
          if(error) throw error;
          if(!data.session){ msg.style.color='var(--green-deep)'; msg.textContent='확인 메일을 보냈어요. 메일함 확인 후 로그인해주세요.'; return; }
        }
      } catch(e){
        msg.textContent = e.message||'오류가 발생했어요.';
      } finally {
        const l=document.getElementById('cloudLogin'),s=document.getElementById('cloudSignup');
        if(l)l.disabled=false; if(s)s.disabled=false;
      }
    };
    document.getElementById('cloudLogin').addEventListener('click', ()=>doAuth('login'));
    document.getElementById('cloudSignup').addEventListener('click', ()=>doAuth('signup'));
    document.getElementById('cloudPw').addEventListener('keydown', e=>{ if(e.key==='Enter') doAuth('login'); });
  }

  /* 로그인 후 메인 패널 */
  function renderMainPanel(el){
    const codeHtml = myFriendCode
      ? `<div style="display:flex;align-items:center;gap:10px;background:var(--c-light);border-radius:11px;padding:10px 14px;margin:4px 0 14px">
           <span style="font-size:11px;font-weight:700;color:var(--green-deep)">내 친구 코드</span>
           <span style="font-family:monospace;font-size:20px;font-weight:800;color:var(--ink);letter-spacing:.15em">${escape(myFriendCode)}</span>
           <button id="copyCodeBtn" style="margin-left:auto;border:0;background:var(--green-deep);color:#fff;border-radius:8px;padding:5px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer">복사</button>
         </div>`
      : `<div style="font-size:12px;color:var(--ink-faint);margin-bottom:14px">친구 코드를 불러오는 중…</div>`;

    const friendsHtml = friends.length
      ? friends.map(f=>`
          <div style="display:flex;align-items:center;gap:8px;background:var(--app);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:6px" data-pid="${escape(f.plannerId)}">
            <span style="font-size:13px;font-weight:700;flex:1">${escape(f.name)}</span>
            <span style="font-family:monospace;font-size:11px;color:var(--ink-faint)">${escape(f.code)}</span>
            <button class="friend-browse-btn nbtn" style="font-size:11px;padding:5px 10px">보기</button>
            <button class="friend-del-btn" style="border:0;background:transparent;color:var(--ink-faint);font-size:14px;cursor:pointer" data-code="${escape(f.code)}">✕</button>
          </div>`).join('')
      : `<div style="font-size:12px;color:var(--ink-faint);padding:6px 0">아직 추가한 친구가 없어요.</div>`;

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <h3 style="font-size:16px;color:var(--ink);margin:0">☁ 클라우드</h3>
        <span style="font-size:11.5px;color:var(--ink-soft)">${escape(session.user.email||'')}</span>
      </div>
      ${codeHtml}
      <div class="ed-actions" style="margin-bottom:18px">
        <button class="btn-del" id="cloudLogout">로그아웃</button>
        <button class="btn-save" id="cloudSync">동기화</button>
      </div>

      <h3>친구 코드로 추가</h3>
      <div style="display:flex;gap:8px">
        <input type="text" class="ed-text" id="friendCodeInput" placeholder="6자리 코드 입력" maxlength="6"
          style="text-transform:uppercase;letter-spacing:.1em;font-family:monospace;font-size:16px">
        <button class="btn-save" id="addFriendBtn" style="flex:0 0 auto">추가</button>
      </div>
      <div id="friendAddMsg" style="font-size:12px;min-height:16px;margin:6px 0 14px;color:var(--ink-soft)"></div>

      <h3>친구 플래너</h3>
      <div id="friendsList">${friendsHtml}</div>`;

    /* 이벤트 */
    document.getElementById('cloudLogout').addEventListener('click', async()=>{
      await sb.auth.signOut();
    });
    document.getElementById('cloudSync').addEventListener('click', async()=>{
      if(!browsing){ await pullMine(); closeSheet(); }
    });

    /* 코드 복사 */
    document.getElementById('copyCodeBtn')?.addEventListener('click', ()=>{
      if(myFriendCode) navigator.clipboard?.writeText(myFriendCode).catch(()=>{});
      const btn = document.getElementById('copyCodeBtn');
      if(btn){ btn.textContent='복사됨!'; setTimeout(()=>{ if(btn)btn.textContent='복사'; }, 1500); }
    });

    /* 친구 추가 */
    document.getElementById('addFriendBtn').addEventListener('click', async()=>{
      const code = (document.getElementById('friendCodeInput').value||'').trim().toUpperCase();
      const msg = document.getElementById('friendAddMsg');
      msg.style.color = '#C76B4E'; msg.textContent = '';
      if(code.length < 4){ msg.textContent = '코드를 입력해주세요.'; return; }
      if(code === myFriendCode){ msg.textContent = '내 코드예요.'; return; }
      if(friends.find(f=>f.code===code)){ msg.textContent = '이미 추가된 친구예요.'; return; }
      const addBtn = document.getElementById('addFriendBtn');
      addBtn.disabled = true; msg.style.color='var(--ink-soft)'; msg.textContent = '찾는 중…';
      const result = await findPlannerByCode(code);
      addBtn.disabled = false;
      if(!result){ msg.textContent = '코드를 찾을 수 없어요.'; return; }
      friends.push(result);
      saveFriends();
      msg.style.color='var(--green-deep)'; msg.textContent = `${result.name} 추가됨!`;
      document.getElementById('friendCodeInput').value = '';
      renderMainPanel(el);
    });
    document.getElementById('friendCodeInput').addEventListener('keydown', e=>{
      if(e.key==='Enter') document.getElementById('addFriendBtn').click();
    });

    /* 친구 보기 / 삭제 */
    el.querySelectorAll('.friend-browse-btn').forEach(b=>{
      const row = b.closest('[data-pid]');
      const f = friends.find(f=>f.plannerId===row.dataset.pid);
      if(f) b.addEventListener('click', ()=>browsePlanner(f.plannerId, f.name));
    });
    el.querySelectorAll('.friend-del-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        const code = b.dataset.code;
        friends = friends.filter(f=>f.code!==code);
        saveFriends();
        renderMainPanel(el);
      });
    });
  }

  /* ── 세션 처리 ── */
  async function onSession(newSession){
    const wasIn = !!session;
    session = newSession;
    if(session){
      const res = await ensurePlanner();
      if(res){
        myPlannerId = res.id;
        if(res.isNew) pushAll();
        else if(!wasIn) await pullMine();
      }
      myFriendCode = await fetchFriendCode();
    } else {
      myPlannerId = null; myFriendCode = null;
      if(browsing) exitBrowse();
    }
    updateBanner(browsing ? '친구' : null);
    // 시트가 열려있으면 패널 갱신
    if(sheet.classList.contains('on')) renderPanel();
  }

  sb.auth.getSession().then(({data})=>onSession(data.session));
  sb.auth.onAuthStateChange((_,s)=>onSession(s));

})();
