/* ============================================================
   Sprout — 로그인 / 클라우드 동기화 / 친구 코드 둘러보기
============================================================ */
(function(){
  "use strict";

  const URL_ = window.SPROUT_SUPABASE_URL || "";
  const KEY_ = window.SPROUT_SUPABASE_KEY || "";

  /* 버튼은 무조건 보여줌 — Supabase 없으면 안내만 */
  const btn    = document.getElementById('cloudBtn');
  const scrim  = document.getElementById('cloudScrim');
  const sheet  = document.getElementById('cloudSheet');
  const banner = document.getElementById('browseBanner');
  const panel  = document.getElementById('cloudPanel');

  if(!btn) {
    console.warn('[cloud] cloudBtn 요소를 찾을 수 없어요.');
    return;
  }
  // 버튼은 HTML에서 이미 보이므로 별도 설정 불필요

  if(!URL_ || !KEY_ || typeof supabase === "undefined"){
    btn.addEventListener('click', ()=>{
      panel.innerHTML = `<h3 style="font-size:15px;color:var(--ink)">☁ 클라우드 미설정</h3>
        <p style="font-size:13px;color:var(--ink-soft)">config.js 에 Supabase URL과 Key를 입력해주세요.</p>
        <div class="ed-actions"><button class="btn-save" id="cloudClose2">닫기</button></div>`;
      openSheet();
      document.getElementById('cloudClose2')?.addEventListener('click', closeSheet);
    });
    return;
  }

  const sb = supabase.createClient(URL_, KEY_);

  const SPROUT_KEYS = [
    'sprout.cats','sprout.inbox','sprout.blocks','sprout.events','sprout.pomo',
    'sprout.habits','sprout.ddays','sprout.sleep','sprout.diary',
    'sprout.frog','sprout.doses','sprout.projects','sprout.weekly'
  ];

  let session = null, myPlannerId = null, myFriendCode = null;
  let browsing = false, mySnapshot = null;
  const pushTimers = {};
  let friends = [];
  try { friends = JSON.parse(localStorage.getItem('sprout.friends') || '[]'); } catch(e){}

  function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function saveFriends(){ try{ localStorage.setItem('sprout.friends', JSON.stringify(friends)); }catch(e){} }
  function snapLocal(){ const o={}; SPROUT_KEYS.forEach(k=>{o[k]=localStorage.getItem(k);}); return o; }
  function restoreLocal(s){ SPROUT_KEYS.forEach(k=>{ s[k]==null ? localStorage.removeItem(k) : localStorage.setItem(k,s[k]); }); }
  function readLocal(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return undefined; } }

  /* ── 클라우드 push ── */
  window.__cloudPush = function(key, value){
    if(!session || !myPlannerId || browsing || !SPROUT_KEYS.includes(key)) return;
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(async ()=>{
      await sb.from('planner_state').upsert(
        { planner_id:myPlannerId, key, value, updated_at:new Date().toISOString() },
        { onConflict:'planner_id,key' }
      );
    }, 600);
  };

  function pushAll(){ SPROUT_KEYS.forEach(k=>{ const v=readLocal(k); if(v!==undefined) window.__cloudPush(k,v); }); }

  async function pullMine(){
    if(!myPlannerId) return;
    const {data,error} = await sb.from('planner_state').select('key,value').eq('planner_id',myPlannerId);
    if(error) return;
    (data||[]).forEach(r=>localStorage.setItem(r.key, JSON.stringify(r.value)));
    if(window.__sproutReload) window.__sproutReload();
  }

  async function ensurePlanner(){
    const {data:mine} = await sb.from('planners').select('id').eq('owner_id',session.user.id).limit(1);
    if(mine && mine.length) return {id:mine[0].id, isNew:false};
    const name = (session.user.email||'나').split('@')[0] + "의 플래너";
    const {data:c} = await sb.from('planners').insert({owner_id:session.user.id,name}).select('id').single();
    return c ? {id:c.id, isNew:true} : null;
  }

  async function fetchFriendCode(){
    const {data} = await sb.from('profiles').select('friend_code').eq('id',session.user.id).single();
    return data ? data.friend_code : null;
  }

  async function findPlannerByCode(code){
    const {data:prof} = await sb.from('profiles').select('id,display_name,friend_code').eq('friend_code',code.toUpperCase()).single();
    if(!prof) return null;
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
    window.__readOnly = true; browsing = true;
    closeSheet();
    if(window.__sproutReload) window.__sproutReload();
    updateUI(name);
  }
  function exitBrowse(){
    if(!browsing) return;
    restoreLocal(mySnapshot);
    window.__readOnly = false; browsing = false;
    if(window.__sproutReload) window.__sproutReload();
    updateUI(null);
  }

  /* ── UI ── */
  function openSheet(){ scrim.classList.add('on'); sheet.classList.add('on'); }
  function closeSheet(){ scrim.classList.remove('on'); sheet.classList.remove('on'); }
  btn.addEventListener('click', ()=>{ renderPanel(); openSheet(); });
  scrim.addEventListener('click', closeSheet);

  function updateUI(browsingName){
    btn.style.background = (session && !browsing) ? 'var(--green-deep)' : 'rgba(255,255,255,.85)';
    btn.style.color = (session && !browsing) ? '#fff' : 'var(--ink)';
    btn.textContent = browsing ? '👀' : '☁';
    if(browsingName){
      banner.hidden = false;
      banner.innerHTML = `👀 ${esc(browsingName)} 플래너 (읽기 전용)&nbsp;<button id="exitBrowseBtn" style="border:0;background:rgba(255,255,255,.25);color:#fff;border-radius:9px;padding:3px 9px;font:inherit;font-weight:700;cursor:pointer">내 플래너로</button>`;
      document.getElementById('exitBrowseBtn').addEventListener('click', exitBrowse);
    } else {
      banner.hidden = true;
    }
  }

  function renderPanel(){
    if(!session){ renderLogin(); return; }
    renderMain();
  }

  /* 로그인 패널 */
  function renderLogin(){
    panel.innerHTML = `
      <h3 style="font-size:16px;color:var(--ink);margin-top:0">☁ 로그인</h3>
      <p style="font-size:12.5px;color:var(--ink-soft);margin:0 0 14px">로그인하면 어느 기기에서나 같은 데이터를 쓸 수 있어요.</p>
      <h3>이메일</h3>
      <input type="email" class="ed-text" id="cloudEmail" placeholder="이메일 주소" autocomplete="email" style="margin-bottom:8px">
      <h3>비밀번호</h3>
      <input type="password" class="ed-text" id="cloudPw" placeholder="6자 이상" autocomplete="current-password">
      <div id="cloudMsg" style="font-size:12.5px;min-height:18px;margin-top:8px;color:#C76B4E"></div>
      <div class="ed-actions" style="margin-top:14px">
        <button class="btn-sub" id="cloudSignup">회원가입</button>
        <button class="btn-save" id="cloudLogin">로그인</button>
      </div>`;

    const doAuth = async(mode)=>{
      const email = (document.getElementById('cloudEmail').value||'').trim();
      const pw    = document.getElementById('cloudPw').value;
      const msg   = document.getElementById('cloudMsg');
      msg.textContent = '';
      if(!email || pw.length < 6){ msg.textContent='이메일과 6자 이상 비밀번호를 입력하세요.'; return; }
      document.getElementById('cloudLogin').disabled = true;
      document.getElementById('cloudSignup').disabled = true;
      try{
        if(mode==='login'){
          const {error} = await sb.auth.signInWithPassword({email,password:pw});
          if(error) throw error;
        } else {
          const {data,error} = await sb.auth.signUp({email,password:pw});
          if(error) throw error;
          if(!data.session){ msg.style.color='var(--green-deep)'; msg.textContent='확인 메일을 보냈어요. 메일함 확인 후 로그인하세요.'; return; }
        }
      } catch(e){
        msg.textContent = e.message||'오류가 발생했어요.';
        document.getElementById('cloudLogin').disabled = false;
        document.getElementById('cloudSignup').disabled = false;
      }
    };
    document.getElementById('cloudLogin').addEventListener('click', ()=>doAuth('login'));
    document.getElementById('cloudSignup').addEventListener('click', ()=>doAuth('signup'));
    document.getElementById('cloudPw').addEventListener('keydown', e=>{ if(e.key==='Enter') doAuth('login'); });
  }

  /* 메인 패널 */
  function renderMain(){
    const codeHtml = myFriendCode
      ? `<div style="display:flex;align-items:center;gap:10px;background:var(--c-light);border-radius:11px;padding:10px 14px;margin:4px 0 14px">
           <span style="font-size:11px;font-weight:700;color:var(--green-deep)">내 친구 코드</span>
           <span style="font-family:monospace;font-size:22px;font-weight:800;color:var(--ink);letter-spacing:.15em">${esc(myFriendCode)}</span>
           <button id="copyCodeBtn" style="margin-left:auto;border:0;background:var(--green-deep);color:#fff;border-radius:8px;padding:5px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer">복사</button>
         </div>`
      : `<div style="font-size:12px;color:var(--ink-faint);margin-bottom:14px">코드 불러오는 중…</div>`;

    const friendsHtml = friends.length
      ? friends.map(f=>`
          <div style="display:flex;align-items:center;gap:8px;background:var(--app);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:6px">
            <span style="font-size:13px;font-weight:700;flex:1">${esc(f.name)}</span>
            <span style="font-family:monospace;font-size:11px;color:var(--ink-faint)">${esc(f.code)}</span>
            <button class="nbtn friend-view" data-pid="${esc(f.plannerId)}" data-name="${esc(f.name)}" style="font-size:11px;padding:5px 10px">보기</button>
            <button class="friend-del" data-code="${esc(f.code)}" style="border:0;background:transparent;color:var(--ink-faint);font-size:14px;cursor:pointer">✕</button>
          </div>`).join('')
      : `<div style="font-size:12px;color:var(--ink-faint);padding:6px 0">아직 추가한 친구가 없어요.</div>`;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <h3 style="font-size:16px;color:var(--ink);margin:0">☁ 클라우드</h3>
        <span style="font-size:11px;color:var(--ink-soft)">${esc(session.user.email||'')}</span>
      </div>
      ${codeHtml}
      <div class="ed-actions" style="margin-bottom:18px">
        <button class="btn-del" id="cloudLogout">로그아웃</button>
        <button class="btn-save" id="cloudSync">동기화</button>
      </div>
      <h3>친구 코드로 추가</h3>
      <div style="display:flex;gap:8px">
        <input type="text" class="ed-text" id="friendCodeInput" placeholder="6자리 코드" maxlength="6"
          style="text-transform:uppercase;letter-spacing:.12em;font-family:monospace;font-size:18px">
        <button class="btn-save" id="addFriendBtn" style="flex:0 0 auto;white-space:nowrap">추가</button>
      </div>
      <div id="friendAddMsg" style="font-size:12px;min-height:16px;margin:6px 0 14px;color:var(--ink-soft)"></div>
      <h3>친구 플래너</h3>
      <div id="friendsList">${friendsHtml}</div>`;

    document.getElementById('copyCodeBtn')?.addEventListener('click',()=>{
      navigator.clipboard?.writeText(myFriendCode||'').catch(()=>{});
      const b=document.getElementById('copyCodeBtn');
      if(b){b.textContent='복사됨!';setTimeout(()=>{if(b)b.textContent='복사';},1500);}
    });
    document.getElementById('cloudLogout').addEventListener('click', async()=>{ await sb.auth.signOut(); closeSheet(); });
    document.getElementById('cloudSync').addEventListener('click', async()=>{ await pullMine(); closeSheet(); });

    document.getElementById('addFriendBtn').addEventListener('click', async()=>{
      const code=(document.getElementById('friendCodeInput').value||'').trim().toUpperCase();
      const msg=document.getElementById('friendAddMsg');
      msg.style.color='#C76B4E'; msg.textContent='';
      if(code.length<4){msg.textContent='코드를 입력해주세요.';return;}
      if(code===myFriendCode){msg.textContent='내 코드예요.';return;}
      if(friends.find(f=>f.code===code)){msg.textContent='이미 추가된 친구예요.';return;}
      document.getElementById('addFriendBtn').disabled=true;
      msg.style.color='var(--ink-soft)'; msg.textContent='찾는 중…';
      const result=await findPlannerByCode(code);
      document.getElementById('addFriendBtn').disabled=false;
      if(!result){msg.textContent='코드를 찾을 수 없어요.';return;}
      friends.push(result); saveFriends();
      msg.style.color='var(--green-deep)'; msg.textContent=`${result.name} 추가됨!`;
      document.getElementById('friendCodeInput').value='';
      renderMain();
    });
    document.getElementById('friendCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('addFriendBtn').click();});

    panel.querySelectorAll('.friend-view').forEach(b=>{
      b.addEventListener('click',()=>browsePlanner(b.dataset.pid, b.dataset.name));
    });
    panel.querySelectorAll('.friend-del').forEach(b=>{
      b.addEventListener('click',()=>{
        friends=friends.filter(f=>f.code!==b.dataset.code);
        saveFriends(); renderMain();
      });
    });
  }

  /* ── 세션 처리 ── */
  async function onSession(s){
    const wasIn=!!session; session=s;
    if(session){
      const res=await ensurePlanner();
      if(res){ myPlannerId=res.id; if(res.isNew) pushAll(); else if(!wasIn) await pullMine(); }
      myFriendCode=await fetchFriendCode();
    } else {
      myPlannerId=null; myFriendCode=null;
      if(browsing) exitBrowse();
    }
    updateUI(null);
    if(sheet.classList.contains('on')) renderPanel();
  }

  sb.auth.getSession().then(({data})=>onSession(data.session));
  sb.auth.onAuthStateChange((_,s)=>onSession(s));

})();
