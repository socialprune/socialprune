import type { Item } from '@socialprune/core';
import { IG_FIXTURE } from './fixture.ts';
import type { Variant } from './fixture.ts';
import { CONTEXT_ORIGINS } from './ports.ts';
const escape = (input: string) =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const json = (value: unknown) =>
  JSON.stringify(value).replaceAll('<', '\\u003c');
function doc(body: string, script: string, lang = 'en'): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:12px}article{width:500px;background:white}article>img{width:160px;height:100px}li{list-style:none}#list{height:420px;overflow:auto}button,[role=button]{padding:10px;border:1px solid #888;margin:2px}#list>[role=button]{height:70px}dialog{max-height:500px;overflow:auto}</style></head><body>${body}<script>${script}</script></body></html>`;
}
const instrumentation = `
window.events={inputs:[],choices:[],clicks:[],added:[]};window.filterSelects=new Map();
for(const event of ['input','change','beforeinput','textInput','keydown','keyup','keypress'])document.addEventListener(event,e=>{const control=window.filterSelects.get(e.target);if((e.type==='input'||e.type==='change')&&control&&e.target.isConnected&&document.querySelectorAll('[role=dialog] select').length===6)window.events.choices.push({type:e.type,...control,label:e.target.selectedOptions[0]?.textContent||''});else window.events.inputs.push(e.type);setTimeout(report,0)},true);
document.addEventListener('click',e=>{const target=e.target.closest('select,button,[role=button]');window.events.clicks.push(target?.tagName==='SELECT'?'SELECT':target?.getAttribute('aria-label')||target?.textContent||e.target.tagName)},true);
window.ownMutation=false;
new MutationObserver(records=>{if(!window.ownMutation)for(const record of records)for(const node of record.addedNodes)window.events.added.push(node.nodeName);fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(window.events)}).catch(()=>{})}).observe(document,{subtree:true,childList:true});
function mutate(fn){window.ownMutation=true;fn();queueMicrotask(()=>window.ownMutation=false)};
function report(){fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(window.events)}).catch(()=>{})};
document.addEventListener('click',()=>setTimeout(report,0));
`;
export function listPage(
  items: readonly Item[],
  variant: Variant,
  zoneHours: number,
  filter = { today: IG_FIXTURE.now.slice(0, 10), firstYear: 1919 },
): string {
  const handle = items[0]!.account.handle!;
  const records = items.map((item, index) => ({
    text: item.text,
    at: item.createdAt,
    code: `${IG_FIXTURE.code}${index || ''}`,
    username:
      variant === 'account-mismatch' ? IG_FIXTURE.other.username : handle,
  }));
  if (variant === 'second-candidate' || variant === 'four-candidates') {
    records.unshift({
      ...records[items.length > 1 ? 1 : 0]!,
      code: 'Generated_wrong_candidate',
    });
    if (variant === 'four-candidates') {
      records.unshift(
        { ...records[0]!, code: 'Generated_wrong_candidate2' },
        { ...records[0]!, code: 'Generated_wrong_candidate3' },
      );
    }
  }
  const body =
    '<div role="button" tabindex="0">Sort &amp; filter</div><button>Select</button><div id="list"></div>';
  const script =
    instrumentation +
    `
const rows=${json(records)}, variant=${json(variant)}, zone=${zoneHours}, filter=${json(filter)};let oldest=false,start=null,end=null,loads=0;
const list=document.getElementById('list');
function emptyImageButton(){const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Generated image decoration');node.innerHTML='<img alt="" src="/thumb.png">';list.append(node)};
function render(){mutate(()=>{list.replaceChildren();const empty=['empty-image-buttons','year-empty-rows'].includes(variant);if(empty)emptyImageButton();let chosen=rows.filter(row=>{const day=new Date(Date.parse(row.at)+zone*3600000).toISOString().slice(0,10);return(!start||day>=start)&&(!end||day<=end)});if(variant==='no-row')chosen=chosen.map(row=>({...row,text:'Different generated row'}));if(variant==='window-full')chosen=Array.from({length:120},(_,i)=>({...rows[0],text:'Window filler '+i})).slice(0,10*(loads+1));if(!oldest)chosen=chosen.slice().reverse();for(const [index,row]of chosen.entries()){const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Comment row');node.innerHTML='<img alt="" src="/thumb.png">';const age=variant==='unknown-age'?'8q':oldest&&['year-rows','year-empty-rows','year-word-rows'].includes(variant)?(variant==='year-word-rows'?${json(IG_FIXTURE.expected.fullYearAge)}:${json(IG_FIXTURE.expected.yearAge)}):index%2===0?'1w':'2d';node.append(document.createTextNode(row.username+' '+row.text+'\\n'+age));node.onclick=()=>location.href='/${variant === 'reel' ? 'reel' : 'p'}/'+row.code+'/';list.append(node)}if(empty)for(let index=1;index<${IG_FIXTURE.expected.emptyImageButtons};index++)emptyImageButton()})};
list.addEventListener('wheel',()=>{if(oldest){loads++;render()}});render();
document.querySelector('body>[role=button]').onclick=()=>mutate(()=>{
  const outer=document.createElement('div'),dialog=document.createElement('div');outer.setAttribute('role','dialog');dialog.setAttribute('role','dialog');outer.append(dialog);
  dialog.innerHTML='<div role="button" tabindex="0">Oldest to newest</div><div role="button" tabindex="0">Newest to oldest</div>';document.body.append(outer);
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'],now=new Date(filter.today+'T12:00:00Z');
  const state={start:{year:now.getUTCFullYear(),month:1,day:1},end:{year:now.getUTCFullYear(),month:now.getUTCMonth()+1,day:now.getUTCDate()}},dirty={start:false,end:false},controls={start:{},end:{}};
  function options(select,labels,values,wanted){select.replaceChildren(...labels.map((label,i)=>{const option=document.createElement('option');option.textContent=label;option.value=String(values[i]);option.selected=values[i]===wanted;return option}))}
  function refresh(side){const value=state[side],group=controls[side],limit=side==='end'&&value.year===now.getUTCFullYear();const maxMonth=limit?now.getUTCMonth()+1:12;value.month=Math.min(value.month,maxMonth);const maxDay=limit&&value.month===now.getUTCMonth()+1?now.getUTCDate():new Date(Date.UTC(value.year,value.month,0)).getUTCDate();value.day=Math.min(value.day,maxDay);const years=Array.from({length:now.getUTCFullYear()-filter.firstYear+1},(_,i)=>filter.firstYear+i);options(group.year,years.map(String),years,value.year);options(group.month,months.slice(0,maxMonth),Array.from({length:maxMonth},(_,i)=>i+1),value.month);const days=Array.from({length:maxDay},(_,i)=>i+1);options(group.day,days.map(String),days,value.day)}
  for(const side of ['start','end']){const heading=document.createElement('h3');heading.textContent=side==='start'?'Start Date':'End Date';dialog.append(heading);for(const unit of variant==='filter-reordered'?['day','year','month']:['month','day','year']){const select=document.createElement('select');controls[side][unit]=select;window.filterSelects.set(select,{side,unit});dialog.append(select);select.onchange=()=>mutate(()=>{const value=state[side],previous=value[unit];value[unit]=Number(select.value);dirty[side]=true;if(variant==='filter-readback')value[unit]=previous;refresh(side)})}refresh(side);if(variant==='filter-no-'+side)heading.remove()}
  if(variant==='filter-five')controls.end.year.remove();if(variant==='filter-seven')dialog.append(document.createElement('select'));
  if(variant==='filter-duplicate-option')controls.start.year.append(controls.start.year.options[0].cloneNode(true));
  if(variant==='filter-unknown-month')controls.start.month.options[0].textContent='Generated unknown month';
  if(variant==='filter-wrong-group')controls.start.day.replaceChildren(...[...controls.start.year.options].map(option=>option.cloneNode(true)));
  const apply=document.createElement('div');apply.setAttribute('role','button');apply.setAttribute('tabindex','0');apply.setAttribute('aria-disabled','true');apply.textContent='Apply';dialog.append(apply);
  dialog.querySelectorAll('[role=button]')[0].onclick=()=>{oldest=true;apply.setAttribute('aria-disabled','false')};dialog.querySelectorAll('[role=button]')[1].onclick=()=>{oldest=false;apply.setAttribute('aria-disabled','false')};
  function day(value){return value.year+'-'+String(value.month).padStart(2,'0')+'-'+String(value.day).padStart(2,'0')}
  apply.onclick=()=>{if(apply.getAttribute('aria-disabled')==='true')return;mutate(()=>{if(dirty.start)start=day(state.start);if(dirty.end)end=day(state.end);outer.remove();loads=0;render()})};
});
fetch('/async/wbloks/fetch/',{method:'POST',headers:{'x-fb-friendly-name':'CommentsQuery'}}).then(r=>r.json()).catch(()=>{});
${['side-429', 'feedback-required', 'please-wait', 'checkpoint-required', 'spam', 'signal-metrics'].includes(variant) ? "fetch('/api/v1/generated/read/').then(r=>r.json()).catch(()=>{});" : ''}
${variant === 'signal-metrics' ? "fetch('/graphql/query?generated_secret=private').then(r=>r.json()).catch(()=>{});fetch('/api/v1/generated/error/').then(r=>r.json()).catch(()=>{});" : ''}
${variant === 'mutation' ? "fetch('/graphql/query',{method:'POST',headers:{'x-fb-friendly-name':'BackgroundMutation'}}).catch(()=>{});" : ''}
${variant === 'write-segment' ? "fetch('/api/v1/media/like/',{method:'POST'}).catch(()=>{});" : ''}
${variant === 'external' ? `fetch(${json(CONTEXT_ORIGINS.foreign + '/foreign')},{method:'POST'}).catch(()=>{});new WebSocket(${json(CONTEXT_ORIGINS.foreign.replace('http:', 'ws:') + '/socket')});` : ''}
`;
  if (['login', 'challenge', 'checkpoint'].includes(variant))
    return doc(`<h1>${variant}</h1>`, `location.href='/accounts/${variant}/';`);
  if (variant === 'lock' || variant === 'limit' || variant === 'error')
    return doc(
      `<p>${variant === 'lock' ? 'Your account has been locked' : variant === 'limit' ? 'Try again later' : 'Something went wrong'}</p>`,
      '',
    );
  if (variant === 'never') return doc('<p>Loading</p>', '');
  return doc(body, script, variant === 'de' ? 'de' : 'en');
}
export function postPage(item: Item, index: number, variant: Variant): string {
  if (variant === 'unavailable')
    return doc("<p>Sorry, this page isn't available.</p>", '');
  const code = `${IG_FIXTURE.code}${index || ''}`,
    kind = variant === 'reel' ? 'reel' : 'p';
  const username =
    variant === 'other-author'
      ? IG_FIXTURE.other.username
      : item.account.handle!;
  const text = variant === 'edited' ? 'Generated edited comment' : item.text;
  const time = new Date(
    Date.parse(item.createdAt) + (variant === 'time' ? 120000 : 0),
  ).toISOString();
  const owner =
    variant === 'owner'
      ? IG_FIXTURE.other.username
      : item.reference.ownerHandle!;
  const comment = `<li><a href="/${escape(username)}/">${escape(username)}</a><span>${escape(text)}</span><a href="/${kind}/${code}/c/${BigInt(IG_FIXTURE.commentId) + BigInt(index)}/"><time datetime="${time}">1w</time></a></li>`;
  const other = `<li><a href="/${IG_FIXTURE.other.username}/">${IG_FIXTURE.other.username}</a><span>${IG_FIXTURE.other.text}</span><a href="/${kind}/${code}/c/987654321/"><time datetime="${IG_FIXTURE.other.time}">1w</time></a></li>`;
  const caption =
    variant === 'empty-caption'
      ? ''
      : variant === 'cut-caption'
        ? IG_FIXTURE.caption.slice(0, 24) + '...'
        : IG_FIXTURE.caption;
  const body = `<article><header><a href="/${owner}/">${owner}</a>${variant === 'collaboration' ? '<a href="/collaborator_decoy/">collaborator_decoy</a>' : ''}</header>${variant === 'video' ? '<video></video>' : `<img src="/media/${code}.png?signature=generated-secret" alt="generated media">`}<div><a href="/${owner}/">${owner}</a><span>${caption}</span>${variant === 'cut-caption' ? '<button>more</button>' : ''}</div><a href="/${kind}/${code}/"><time datetime="${IG_FIXTURE.postAt}">1w</time></a><ul>${other}${variant === 'hidden' ? '' : comment}${variant === 'several' ? comment.replace(IG_FIXTURE.commentId, '282828282828282828') : ''}</ul>${variant === 'hidden' ? '<button>Load more comments</button>' : ''}<button>Like</button><button>Reply</button><button>Follow</button><button>Delete</button><input></article>`;
  const script =
    instrumentation +
    `let expansions=0;const comment=${json(comment)};function expand(){mutate(()=>{expansions++;document.querySelector('article>button').remove();if(expansions<3){const button=document.createElement('button');button.textContent=expansions===1?'View replies':'Load more comments';button.onclick=expand;document.querySelector('article').prepend(button)}else document.querySelector('ul').insertAdjacentHTML('beforeend',comment)})}const load=[...document.querySelectorAll('button')].find(b=>b.textContent==='Load more comments');if(load)load.onclick=expand;
${variant === 'no-json' ? '' : `fetch('/data/${code}.json').then(r=>r.json()).catch(()=>{});`}
${variant === 'two-answers' ? `fetch('/data/${code}.json?different=1').then(r=>r.json()).catch(()=>{});` : ''}
`;
  const duplicate = comment.replace(
    `</li>`,
    `<a href="/${kind}/${code}/c/282828282828282828/"><time datetime="${time}">1w</time></a></li>`,
  );
  const decorated =
    variant === 'multi-permalink'
      ? body.replace('</ul>', duplicate + '</ul>')
      : body;
  const decoy =
    variant === 'post-decoy'
      ? '<button role="button" aria-label="Generated post decoration"><img src="/thumb.png" alt="">Not a list row</button>'
      : variant === 'post-decoy-foreign'
        ? `<button role="button" aria-label="Generated post decoration"><img src="/thumb.png" alt="">${IG_FIXTURE.other.username} ${IG_FIXTURE.other.text} 1w</button>`
        : '';
  return doc(decorated + decoy, script);
}
export function postAnswer(
  item: Item,
  index: number,
  variant: Variant,
  origin: string,
  different: boolean,
): unknown {
  const code = `${IG_FIXTURE.code}${index || ''}`;
  const value: Record<string, unknown> = {
    code,
    user: {
      username:
        variant === 'different-owner' || different
          ? IG_FIXTURE.other.username
          : item.reference.ownerHandle,
    },
    taken_at:
      Date.parse(IG_FIXTURE.postAt) / 1000 +
      (variant === 'different-time' ? 1 : 0),
    caption:
      variant === 'empty-caption'
        ? null
        : {
            text:
              variant === 'different-caption'
                ? IG_FIXTURE.other.text
                : IG_FIXTURE.caption,
          },
    image_versions2: {
      candidates: [
        {
          url: `${origin}/media/${variant === 'different-image' ? IG_FIXTURE.other.code : code}.png?signature=generated-secret`,
        },
      ],
    },
  };
  if (variant === 'missing-owner') delete value.user;
  if (variant === 'missing-time') delete value.taken_at;
  if (variant === 'missing-caption') delete value.caption;
  if (variant === 'missing-image') delete value.image_versions2;
  return {
    data: { items: [value] },
    unrelated: {
      username: IG_FIXTURE.other.username,
      text: IG_FIXTURE.other.text,
      [IG_FIXTURE.other.code]: IG_FIXTURE.other.time,
    },
  };
}
