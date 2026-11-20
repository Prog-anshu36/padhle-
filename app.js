/* SyncStudy client: YouTube IFrame API + Supabase Realtime authoritative room state. */
const $ = (s) => document.querySelector(s);
const cfg = window.SYNCSTUDY_CONFIG || {};
const basePath = location.hostname.endsWith('github.io') ? '/padhle-' : '';
const speedOptions = [.25,.5,.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3];
const uid = sessionStorage.syncstudy_uid || (sessionStorage.syncstudy_uid = crypto.randomUUID());
const app = { roomId:null, name:'', sb:null, channel:null, player:null, ready:false, applying:false, state:null, lastEvent:null, demo:false, timer:null, notesTimer:null, suppressUntil:0 };

function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2600)}
function code(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function videoId(value){try{const u=new URL(value);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1).split('/')[0];if(u.hostname.includes('youtube.com'))return u.searchParams.get('v')||u.pathname.split('/').filter(Boolean).pop()}catch{}return /^[\w-]{11}$/.test(value)?value:null}
function fmt(n){n=Math.max(0,Math.floor(n||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
function currentProjected(s){if(!s)return 0;return s.is_playing?s.current_time+Math.max(0,(Date.now()-new Date(s.last_updated_at).getTime())/1000)*s.playback_speed:s.current_time}
function color(name){return ['#7767ff','#31b7ae','#e76f9c','#e39a45','#4b94e8'][[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%5]}
const qualityLabels={small:'240p',medium:'360p',large:'480p',hd720:'720p',hd1080:'1080p',highres:'High-res'};
function refreshQualityOptions(){
  if(!app.ready)return;const select=$('#quality'),current=select.value;
  const levels=app.player.getAvailableQualityLevels?.()||[];
  select.innerHTML='<option value="default">Auto</option>'+levels.filter(q=>qualityLabels[q]).map(q=>`<option value="${q}">${qualityLabels[q]}</option>`).join('');
  select.value=[...select.options].some(o=>o.value===current)?current:'default';
}

speedOptions.forEach(v=>$('#speed').add(new Option(`${v}x`,v)));
$('#display-name').value=localStorage.syncstudy_name||'';
$('#join-toggle').onclick=()=>$('#join-row').classList.toggle('hidden');
$('#create-room').onclick=()=>enter(code());
$('#join-room').onclick=()=>enter($('#room-code').value.trim().toUpperCase());
$('#display-name').addEventListener('keydown',e=>{if(e.key==='Enter')$('#create-room').click()});
const pathRoom=location.pathname.match(/\/room\/([\w-]+)/)?.[1];if(pathRoom){$('#room-code').value=pathRoom.toUpperCase();$('#join-row').classList.remove('hidden')}

async function enter(roomId){
  const name=$('#display-name').value.trim();if(!name)return toast('Add your display name first');if(!roomId)return toast('Enter a room code');
  app.name=name.slice(0,32);app.roomId=roomId;localStorage.syncstudy_name=app.name;history.pushState({},'',`${basePath}/room/${roomId}`);
  $('#landing').classList.add('hidden');$('#room').classList.remove('hidden');$('#room-id').textContent=roomId;
  if(cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase){
    app.sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false}});await connectSupabase();
  }else{connectDemo()}
}

async function connectSupabase(){
  const expires=new Date(Date.now()+(cfg.roomExpiryHours||24)*3600000).toISOString();
  const {data,error}=await app.sb.rpc('join_room',{p_room_id:app.roomId,p_expires_at:expires});
  if(error){toast('Could not connect to room');console.error(error);setConnection(false);return}
  app.state=data;applyState(data,true);
  app.channel=app.sb.channel(`room:${app.roomId}`,{config:{presence:{key:uid},broadcast:{self:false}}});
  app.channel.on('presence',{event:'sync'},renderPresence)
    .on('broadcast',{event:'state'},({payload})=>receiveState(payload))
    .on('broadcast',{event:'chat'},({payload})=>renderMessage(payload))
    .on('broadcast',{event:'bookmark'},()=>loadBookmarks())
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${app.roomId}`},p=>receiveState(p.new))
    .subscribe(async status=>{if(status==='SUBSCRIBED'){setConnection(true);await app.channel.track({name:app.name,user_id:uid,online_at:new Date().toISOString()});loadMessages();loadBookmarks()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setConnection(false)});
}

function connectDemo(){
  app.demo=true;app.bus=new BroadcastChannel(`syncstudy:${app.roomId}`);app.bus.onmessage=e=>handleDemo(e.data);
  const saved=JSON.parse(localStorage.getItem(`syncstudy_state:${app.roomId}`)||'null');app.state=saved||baseState();applyState(app.state,true);
  app.people=new Map([[uid,{name:app.name,user_id:uid}]]);app.bus.postMessage({type:'hello',person:{name:app.name,user_id:uid}});renderDemoPeople();setConnection(true,'Demo mode');
}
function baseState(){return{id:app.roomId,video_id:null,current_time:0,playback_speed:1,is_playing:false,last_action:'join',last_updated_at:new Date().toISOString(),last_actor_id:uid,event_id:crypto.randomUUID(),notes:'',timer_end_at:null,timer_duration:1500}}
function handleDemo(m){if(m.type==='state')receiveState(m.data);if(m.type==='chat')renderMessage(m.data);if(m.type==='hello'){app.people.set(m.person.user_id,m.person);app.bus.postMessage({type:'hello-reply',person:{name:app.name,user_id:uid}});renderDemoPeople()}if(m.type==='hello-reply'){app.people.set(m.person.user_id,m.person);renderDemoPeople()}}
function renderDemoPeople(){renderPeople([...app.people.values()])}
function setConnection(ok,label){$('#connection').className=`status ${ok?'connected':'offline'}`;$('#connection').innerHTML=`<i></i> ${label||(ok?'Live sync':'Offline')}`;if(app.demo)toast('Demo mode: open another tab to test sync')}

function renderPresence(){const all=Object.values(app.channel.presenceState()).flat();renderPeople(all)}
function renderPeople(people){$('#participant-count').textContent=people.length;$('#participants-list').innerHTML=people.map(p=>`<div class="participant"><span class="avatar" style="background:${color(p.name)}33;color:${color(p.name)}">${p.name[0].toUpperCase()}</span><div><div class="participant-name">${escapeHtml(p.name)}${p.user_id===uid?' (you)':''}</div><div class="participant-state">Studying now</div></div><i class="online"></i></div>`).join('')}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML}

async function updateState(patch,action){
  const next={...(app.state||baseState()),...patch,last_action:action,last_actor_id:uid,last_updated_at:new Date().toISOString(),event_id:crypto.randomUUID()};
  app.state=next;app.lastEvent=next.event_id;
  if(app.demo){localStorage.setItem(`syncstudy_state:${app.roomId}`,JSON.stringify(next));app.bus.postMessage({type:'state',data:next});applyState(next,false);return}
  const {data,error}=await app.sb.rpc('update_room_state',{p_room_id:app.roomId,p_event_id:next.event_id,p_actor_id:uid,p_video_id:next.video_id,p_current_time:next.current_time,p_playback_speed:next.playback_speed,p_is_playing:next.is_playing,p_last_action:action,p_notes:next.notes,p_timer_end_at:next.timer_end_at,p_timer_duration:next.timer_duration});
  if(error)return toast('Sync update failed');app.state=data;app.channel.send({type:'broadcast',event:'state',payload:data});applyState(data,false);
}
function receiveState(s){if(!s||s.event_id===app.lastEvent)return;if(app.state&&new Date(s.last_updated_at)<new Date(app.state.last_updated_at))return;app.state=s;applyState(s,true)}
function applyState(s,remote){
  if(!s)return;app.applying=true;$('#speed').value=s.playback_speed;$('#notes').value=s.notes||'';renderTimer();
  if(app.ready&&s.video_id){
    $('#player-empty').classList.add('hidden');const loaded=app.player.getVideoData?.().video_id;
    if(loaded!==s.video_id)app.player.loadVideoById({videoId:s.video_id,startSeconds:currentProjected(s)});
    app.player.setPlaybackRate(s.playback_speed);const drift=Math.abs(app.player.getCurrentTime()-currentProjected(s));if(remote&&drift>1.5)app.player.seekTo(currentProjected(s),true);
    if(s.is_playing&&app.player.getPlayerState()!==1)app.player.playVideo();if(!s.is_playing&&app.player.getPlayerState()===1)app.player.pauseVideo();
    const title=app.player.getVideoData?.().title;if(title)$('#video-title').textContent=title;
  }
  $('#play').textContent=s.is_playing?'❚❚':'▶';$('#sync-health').textContent=remote?'◎ Synced':'◎ Updated';setTimeout(()=>app.applying=false,350);
}

window.onYouTubeIframeAPIReady=()=>{app.player=new YT.Player('player',{height:'100%',width:'100%',playerVars:{controls:0,rel:0,modestbranding:1,playsinline:1,origin:location.origin},events:{onReady:e=>{app.ready=true;e.target.setVolume(+$('#volume').value);if(app.state)applyState(app.state,true);setInterval(tick,500);setInterval(driftCheck,5000)},onStateChange:onPlayerState,onPlaybackRateChange:onRateChange,onPlaybackQualityChange:e=>{$('#quality').value=e.data||'default'},onError:onPlayerError}})};
function onPlayerState(e){if(e.data===YT.PlayerState.CUED||e.data===YT.PlayerState.PLAYING)refreshQualityOptions();if(app.applying||Date.now()<app.suppressUntil)return;if(e.data===YT.PlayerState.PLAYING)updateState({current_time:app.player.getCurrentTime(),is_playing:true},'play');if(e.data===YT.PlayerState.PAUSED)updateState({current_time:app.player.getCurrentTime(),is_playing:false},'pause')}
function onRateChange(e){if(app.applying)return;updateState({current_time:app.player.getCurrentTime(),playback_speed:e.data},'speed')}
function onPlayerError(e){const msg={2:'Invalid video URL',5:'This video cannot be played in HTML5',100:'Video unavailable',101:'The owner disabled embedding',150:'The owner disabled embedding'}[e.data]||'This video cannot be played';toast(msg);$('#video-title').textContent=msg}
function tick(){if(!app.ready)return;const now=app.player.getCurrentTime()||0,dur=app.player.getDuration()||0;$('#time').textContent=`${fmt(now)} / ${fmt(dur)}`;if(!$('#seek').matches(':active'))$('#seek').value=dur?now/dur*1000:0;const t=app.player.getVideoData?.().title;if(t)$('#video-title').textContent=t}
function driftCheck(){if(!app.ready||!app.state||!app.state.is_playing)return;const drift=Math.abs(app.player.getCurrentTime()-currentProjected(app.state));if(drift>1.5){app.applying=true;app.player.seekTo(currentProjected(app.state),true);setTimeout(()=>app.applying=false,350);$('#sync-health').textContent='◎ Drift corrected'}}

$('#play').onclick=()=>{if(!app.ready||!app.state?.video_id)return toast('Load a video first');app.player.getPlayerState()===1?app.player.pauseVideo():app.player.playVideo()};
$('#rewind').onclick=()=>seekBy(-10);$('#forward').onclick=()=>seekBy(10);function seekBy(n){if(!app.ready)return;const t=Math.max(0,app.player.getCurrentTime()+n);app.suppressUntil=Date.now()+500;app.player.seekTo(t,true);updateState({current_time:t},'seek')}
$('#seek').onchange=e=>{const t=(+e.target.value/1000)*(app.player.getDuration()||0);app.suppressUntil=Date.now()+500;app.player.seekTo(t,true);updateState({current_time:t},'seek')};
$('#speed').onchange=e=>{const wanted=+e.target.value,rates=app.player?.getAvailablePlaybackRates?.()||[1];const nearest=rates.reduce((a,b)=>Math.abs(b-wanted)<Math.abs(a-wanted)?b:a,rates[0]);if(nearest!==wanted)toast(`${wanted}x is not supported for this video; using ${nearest}x`);app.player.setPlaybackRate(nearest);updateState({current_time:app.player.getCurrentTime(),playback_speed:nearest},'speed')};
$('#quality').onchange=e=>{if(!app.ready)return;const wanted=e.target.value;app.player.setPlaybackQuality?.(wanted);setTimeout(()=>{const actual=app.player.getPlaybackQuality?.()||'default';if(wanted!=='default'&&actual!==wanted)toast(`${qualityLabels[wanted]} is unavailable; YouTube selected ${qualityLabels[actual]||'Auto'}`);e.target.value=actual},500)};
$('#volume').oninput=e=>app.player?.setVolume(+e.target.value);$('#fullscreen').onclick=()=>$('.video-frame').requestFullscreen?.();
$('#load-video').onclick=()=>{const id=videoId($('#video-url').value.trim());if(!id)return toast('Paste a valid YouTube URL');updateState({video_id:id,current_time:0,is_playing:false,playback_speed:1},'video_change');$('#video-url').value=''};

async function sendChat(text){const m={id:crypto.randomUUID(),room_id:app.roomId,sender_id:uid,sender_name:app.name,message:text,created_at:new Date().toISOString()};if(app.demo)app.bus.postMessage({type:'chat',data:m});else{await app.sb.from('messages').insert(m);app.channel.send({type:'broadcast',event:'chat',payload:m})}renderMessage(m)}
$('#chat-form').onsubmit=e=>{e.preventDefault();const i=$('#chat-input'),v=i.value.trim();if(v){sendChat(v);i.value=''}};
function renderMessage(m){if(document.querySelector(`[data-message="${m.id}"]`))return;$('.welcome')?.remove();const d=document.createElement('div');d.className='message';d.dataset.message=m.id;d.innerHTML=`<div class="message-meta"><b>${escapeHtml(m.sender_name)}</b>${new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div><p>${escapeHtml(m.message)}</p>`;$('#messages').append(d);$('#messages').scrollTop=$('#messages').scrollHeight}
async function loadMessages(){const {data}=await app.sb.from('messages').select('*').eq('room_id',app.roomId).order('created_at').limit(100);data?.forEach(renderMessage)}

$('#notes').oninput=()=>{const s=$('#notes-state');s.textContent='Saving…';clearTimeout(app.notesTimer);app.notesTimer=setTimeout(()=>{updateState({notes:$('#notes').value},'notes');s.textContent='Saved'},700)};
$('#add-bookmark').onclick=async()=>{if(!app.ready||!app.state?.video_id)return toast('Load a video first');const b={id:crypto.randomUUID(),room_id:app.roomId,label:`Key moment at ${fmt(app.player.getCurrentTime())}`,video_time:app.player.getCurrentTime(),created_by_name:app.name};if(app.demo){app.bookmarks=app.bookmarks||[];app.bookmarks.push(b);renderBookmarks(app.bookmarks)}else{await app.sb.from('bookmarks').insert(b);app.channel.send({type:'broadcast',event:'bookmark',payload:{}});loadBookmarks()}};
async function loadBookmarks(){const {data}=await app.sb.from('bookmarks').select('*').eq('room_id',app.roomId).order('created_at');renderBookmarks(data||[])}
function renderBookmarks(items){$('#bookmarks').className=items.length?'':'empty-list';$('#bookmarks').innerHTML=items.length?items.map(b=>`<div class="bookmark"><span>${escapeHtml(b.label)}</span><button data-time="${b.video_time}">Sync jump · ${fmt(b.video_time)}</button></div>`).join(''):'No bookmarks yet';$('#bookmarks').querySelectorAll('button').forEach(b=>b.onclick=()=>{const t=+b.dataset.time;app.player.seekTo(t,true);updateState({current_time:t},'bookmark_seek')})}

$('#timer-toggle').onclick=()=>{const running=app.state?.timer_end_at&&new Date(app.state.timer_end_at)>new Date();updateState({timer_end_at:running?null:new Date(Date.now()+(app.state?.timer_duration||1500)*1000).toISOString()},running?'timer_pause':'timer_start')};
$('#timer-reset').onclick=()=>updateState({timer_end_at:null,timer_duration:1500},'timer_reset');setInterval(renderTimer,1000);
function renderTimer(){const s=app.state;if(!s)return;const left=s.timer_end_at?Math.max(0,Math.ceil((new Date(s.timer_end_at)-Date.now())/1000)):s.timer_duration||1500;$('#timer-display').textContent=fmt(left);$('#timer-toggle').textContent=s.timer_end_at&&left>0?'Pause':'Start focus'}
function copyLink(){navigator.clipboard.writeText(location.href);toast('Invitation link copied')}
$('#copy-link').onclick=copyLink;$('#copy-invite').onclick=copyLink;$('#leave-room').onclick=()=>{app.channel?.unsubscribe();location.href=basePath||'/'};
window.addEventListener('popstate',()=>location.reload());

