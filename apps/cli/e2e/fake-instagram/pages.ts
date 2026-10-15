import type { Item } from '@socialprune/core';
import { IG_FIXTURE } from './fixture.ts';
import type { Variant } from './fixture.ts';
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
window.events={inputs:[],clicks:[],added:[]};
for(const event of ['input','beforeinput','textInput','keydown','keyup','keypress'])document.addEventListener(event,e=>{window.events.inputs.push(e.type)},true);
document.addEventListener('click',e=>{const target=e.target.closest('button,[role=button]');window.events.clicks.push(target?.getAttribute('aria-label')||target?.textContent||e.target.tagName)},true);
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
    '<button>Sort &amp; filter</button><button>Select</button><div id="list"></div>';
  const script =
    instrumentation +
    `
const rows=${json(records)}, variant=${json(variant)}, zone=${zoneHours};let oldest=false,start=null,end=null,loads=0;
const list=document.getElementById('list');
function render(){mutate(()=>{list.replaceChildren();let chosen=rows.filter(row=>{const day=new Date(Date.parse(row.at)+zone*3600000).toISOString().slice(0,10);return(!start||day>=start)&&(!end||day<=end)});if(variant==='no-row')chosen=chosen.map(row=>({...row,text:'Different generated row'}));if(variant==='window-full')chosen=Array.from({length:120},(_,i)=>({...rows[0],text:'Window filler '+i})).slice(0,10*(loads+1));if(!oldest)chosen=chosen.slice().reverse();for(const row of chosen){const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Comment row');node.innerHTML='<img alt="" src="/thumb.png">';node.append(document.createTextNode(row.username+' '+row.text+' 1w'));node.onclick=()=>location.href='/${variant === 'reel' ? 'reel' : 'p'}/'+row.code+'/';list.append(node)}})};
list.addEventListener('wheel',()=>{if(oldest){loads++;render()}});render();
document.querySelector('body>button').onclick=()=>mutate(()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<button>Oldest to newest</button><button>Newest to oldest</button><button>Start date</button><button>End date</button><button>Apply</button>';document.body.append(dialog);dialog.showModal();dialog.querySelectorAll('button')[0].onclick=()=>{oldest=true};dialog.querySelectorAll('button')[1].onclick=()=>{oldest=false};for(const [index,key]of [[2,'start'],[3,'end']])dialog.querySelectorAll('button')[index].onclick=()=>calendar(dialog,key);dialog.querySelectorAll('button')[4].onclick=()=>mutate(()=>{dialog.close();dialog.remove();loads=0;render()})});
function calendar(filter,key){mutate(()=>{const calendar=document.createElement('dialog');let year=2026,month=9;calendar.innerHTML='<button>Choose year</button><button>Choose month</button><div id="choices"></div>';document.body.append(calendar);calendar.showModal();const choices=calendar.querySelector('#choices');function days(){mutate(()=>{choices.replaceChildren();for(let day=1;day<=new Date(Date.UTC(year,month+1,0)).getUTCDate();day++){const b=document.createElement('button');const value=year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');b.textContent=value;b.onclick=()=>mutate(()=>{if(key==='start')start=value;else end=value;calendar.close();calendar.remove()});choices.append(b)}})}calendar.querySelectorAll('button')[0].onclick=()=>mutate(()=>{choices.replaceChildren();for(let value=1970;value<=2100;value++){const b=document.createElement('button');b.textContent=String(value);b.onclick=()=>{year=value;days()};choices.append(b)}});calendar.querySelectorAll('button')[1].onclick=()=>mutate(()=>{choices.replaceChildren();['January','February','March','April','May','June','July','August','September','October','November','December'].forEach((name,index)=>{const b=document.createElement('button');b.textContent=name;b.onclick=()=>{month=index;days()};choices.append(b)})});days()})};
fetch('/async/wbloks/fetch/',{method:'POST',headers:{'x-fb-friendly-name':'CommentsQuery'}}).then(r=>r.json()).catch(()=>{});
${['side-429', 'feedback-required', 'please-wait', 'checkpoint-required', 'spam', 'signal-metrics'].includes(variant) ? "fetch('/api/v1/generated/read/').then(r=>r.json()).catch(()=>{});" : ''}
${variant === 'signal-metrics' ? "fetch('/graphql/query?generated_secret=private').then(r=>r.json()).catch(()=>{});fetch('/api/v1/generated/error/').then(r=>r.json()).catch(()=>{});" : ''}
${variant === 'mutation' ? "fetch('/graphql/query',{method:'POST',headers:{'x-fb-friendly-name':'BackgroundMutation'}}).catch(()=>{});" : ''}
${variant === 'write-segment' ? "fetch('/api/v1/media/like/',{method:'POST'}).catch(()=>{});" : ''}
${variant === 'external' ? "fetch('http://127.0.0.1:4419/foreign',{method:'POST'}).catch(()=>{});new WebSocket('ws://127.0.0.1:4419/socket');" : ''}
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
