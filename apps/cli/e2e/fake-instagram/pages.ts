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
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>body{font:16px system-ui;margin:12px}main{width:500px;background:white}main img{width:160px;height:100px}a>img{width:24px;height:24px}#list{height:420px;overflow:auto}button,[role=button]{padding:10px;border:1px solid #888;margin:2px}#list>[role=button]{height:70px}dialog{max-height:500px;overflow:auto}</style></head><body>${body}<script>${script}</script></body></html>`;
}
const instrumentation = `
window.events={inputs:[],choices:[],clicks:[],added:[],wheels:[]};window.filterSelects=new Map();
for(const event of ['input','change','beforeinput','textInput','keydown','keyup','keypress'])document.addEventListener(event,e=>{const control=window.filterSelects.get(e.target);if((e.type==='input'||e.type==='change')&&control&&e.target.isConnected&&document.querySelectorAll('[role=dialog] select').length===6)window.events.choices.push({type:e.type,...control,label:e.target.selectedOptions[0]?.textContent||''});else window.events.inputs.push(e.type);setTimeout(report,0)},true);
document.addEventListener('click',e=>{const target=e.target.closest('select,button,[role=button]');window.events.clicks.push(target?.tagName==='SELECT'?'SELECT':target?.getAttribute('aria-label')||target?.textContent||e.target.tagName)},true);
document.addEventListener('wheel',e=>{window.events.wheels.push({area:location.pathname==='/your_activity/interactions/comments'?'list':e.target.closest('#comments')?'post-comments':'other',x:e.deltaX,y:e.deltaY});setTimeout(report,0)},true);
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
  candidates: ReadonlyMap<number, readonly { code: string }[]> = new Map(),
): string {
  const handle = items[0]!.account.handle!;
  const records = items.flatMap((item, index) =>
    (
      candidates.get(index) ?? [{ code: `${IG_FIXTURE.code}${index || ''}` }]
    ).map(({ code }) => ({
      text: variant === 'list-cut' ? item.text.slice(0, 40) + '...' : item.text,
      at: item.createdAt,
      code,
      username:
        variant === 'account-mismatch' ? IG_FIXTURE.other.username : handle,
    })),
  );
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
const rows=${json(records)}, variant=${json(variant)}, zone=${zoneHours}, filter=${json(filter)};let oldest=false,start=null,end=null,loads=0,applied=false;
const list=document.getElementById('list');
function emptyImageButton(){const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Generated image decoration');node.innerHTML='<img alt="" src="/thumb.png">';list.append(node)};
function render(){mutate(()=>{list.replaceChildren();const empty=['empty-image-buttons','year-empty-rows'].includes(variant);if(empty)emptyImageButton();let chosen=rows.filter(row=>{const day=new Date(Date.parse(row.at)+zone*3600000).toISOString().slice(0,10);return(!start||day>=start)&&(!end||day<=end)});if(variant==='no-row')chosen=chosen.map(row=>({...row,text:'Different generated row'}));if(variant==='window-full')chosen=Array.from({length:120},(_,i)=>({...rows[0],text:'Window filler '+i})).slice(0,10*(loads+1));if(!oldest)chosen=chosen.slice().reverse();for(const [index,row]of chosen.entries()){const node=document.createElement('div');node.setAttribute('role','button');node.setAttribute('aria-label','Comment row');node.innerHTML='<img alt="" src="/thumb.png">';const age=variant==='unknown-age'?'8q':oldest&&['year-rows','year-empty-rows','year-word-rows'].includes(variant)?(variant==='year-word-rows'?${json(IG_FIXTURE.expected.fullYearAge)}:${json(IG_FIXTURE.expected.yearAge)}):index%2===0?'1w':'2d';node.append(document.createTextNode(row.username+' '+row.text+'\\n'+age));node.onclick=()=>location.href='/${variant === 'reel' ? 'reel' : 'p'}/'+row.code;list.append(node)}if(empty)for(let index=1;index<${IG_FIXTURE.expected.emptyImageButtons};index++)emptyImageButton()})};
list.addEventListener('wheel',()=>{if(oldest){loads++;render()}});render();
document.querySelector('body>[role=button]').onclick=()=>mutate(()=>{
  if(applied)return;
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
  apply.onclick=()=>{if(apply.getAttribute('aria-disabled')==='true')return;mutate(()=>{applied=true;if(dirty.start)start=day(state.start);if(dirty.end)end=day(state.end);outer.remove();loads=0;render()})};
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
export function postPage(
  item: Item,
  index: number,
  variant: Variant,
  code = `${IG_FIXTURE.code}${index || ''}`,
  hideComment = false,
): string {
  if (variant === 'unavailable')
    return doc("<p>Sorry, this page isn't available.</p>", '');
  const kind = variant === 'reel' ? 'reel' : 'p';
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
  const profile = (name: string) =>
    `<a href="/${escape(name)}/"><div><div><span dir="auto">${escape(name)}</span></div></div></a>`;
  const author = (name: string) =>
    `<span><span><div>${profile(name)}</div></span></span>`;
  const permalink = (id: string, at: string) =>
    `<a href="/${variant === 'reel-links' ? 'reel' : kind}/${code}/c/${id}/"><time datetime="${at}">1w</time></a>`;
  const textSpan = (content: string) => `<span dir="auto">${content}</span>`;
  const commentBlock = (
    name: string,
    content: string,
    id: string,
    at: string,
  ) =>
    `<div><div><span dir="auto">${author(name)}</span><span dir="auto">${permalink(id, at)}</span></div><div>${textSpan(content)}</div></div>`;
  const commentRow = (block: string, name: string) =>
    `<div><a href="/${escape(name)}/"><img src="/profiles/comment.png" alt=""></a><div><div><div>${block}</div><div><div><div role="button">Reply</div></div></div></div></div></div>`;
  const commentId = String(BigInt(IG_FIXTURE.commentId) + BigInt(index));
  let shownText = escape(text);
  if (variant === 'comment-hashtag')
    shownText += ` <a href="/explore/tags/generated_moss/">${IG_FIXTURE.commentTag}</a>`;
  if (variant === 'comment-mention')
    shownText += ` <a href="/${IG_FIXTURE.other.username}/">@${IG_FIXTURE.other.username}</a>`;
  let comment = commentBlock(username, shownText, commentId, time);
  if (variant === 'block-two-texts')
    comment = comment.replace(
      textSpan(shownText),
      textSpan(IG_FIXTURE.postDecoys.secondText) + textSpan(shownText),
    );
  if (variant === 'block-no-text')
    comment = comment.replace(textSpan(shownText), '');
  if (variant === 'block-text-in-link')
    comment = comment.replace(
      textSpan(shownText),
      `<a href="/explore/tags/generated/">${textSpan(shownText)}</a>`,
    );
  if (variant === 'block-two-profiles')
    comment = comment.replace(
      profile(username),
      profile(username) + profile(IG_FIXTURE.other.username),
    );
  if (variant === 'block-profile-label')
    comment = comment.replace(
      `>${escape(username)}</span>`,
      `>${IG_FIXTURE.other.username}</span>`,
    );
  if (variant === 'block-profile-image')
    comment = comment.replace(
      profile(username),
      profile(username).replace(
        '</a>',
        '<img src="/profiles/comment.png"></a>',
      ),
    );
  if (variant === 'block-time-count')
    comment = comment.replace(
      '</time>',
      `</time><time datetime="${time}">1w</time>`,
    );
  if (variant === 'block-wrong-depth')
    comment = comment.replace(
      permalink(commentId, time),
      `<div>${permalink(commentId, time)}</div>`,
    );
  if (variant === 'block-wrong-code')
    comment = comment.replace(
      `/${kind}/${code}/c/`,
      `/${kind}/${IG_FIXTURE.other.code}/c/`,
    );
  if (variant === 'block-query-permalink')
    comment = comment.replace(`/c/${commentId}/"`, `/c/${commentId}/?q=1"`);
  if (variant === 'block-text-time')
    comment = comment.replace(
      textSpan(shownText),
      textSpan(shownText + `<time datetime="${time}">1w</time>`),
    );
  if (variant === 'block-text-image')
    comment = comment.replace(
      textSpan(shownText),
      textSpan(shownText + '<img src="/profiles/comment.png">'),
    );
  if (variant === 'block-text-button')
    comment = comment.replace(
      textSpan(shownText),
      textSpan(shownText + '<div role="button">Reply</div>'),
    );
  if (variant === 'block-text-permalink')
    comment = comment.replace(
      textSpan(shownText),
      textSpan(shownText + permalink(commentId, time)),
    );
  if (variant === 'block-old-two-level')
    comment = `<div><span dir="auto"><span dir="auto"><span>${shownText}</span></span></span><div>${profile(username)}${permalink(commentId, time)}</div></div>`;
  const other = commentBlock(
    IG_FIXTURE.other.username,
    escape(IG_FIXTURE.other.text),
    '987654321',
    IG_FIXTURE.other.time,
  );
  const caption =
    variant === 'empty-caption'
      ? ''
      : variant === 'cut-caption'
        ? IG_FIXTURE.caption.slice(0, 24) + '...'
        : IG_FIXTURE.caption;
  const firstProfile =
    variant === 'owner-first-profile' ? IG_FIXTURE.other.username : owner;
  const ownLink = (name: string) =>
    `<a href="/${escape(name)}/${variant === 'reel-links' ? 'reel' : kind}/${variant === 'post-other-code' ? IG_FIXTURE.other.code : code}/">${variant === 'post-no-own-time' ? '1w' : `<time datetime="${IG_FIXTURE.postAt}">1w</time>`}</a>`;
  const extraOwnLink =
    variant === 'collaboration'
      ? ownLink(IG_FIXTURE.postDecoys.collaborator)
      : variant === 'same-owner-links'
        ? ownLink(owner.toUpperCase())
        : '';
  let captionText =
    variant === 'cut-caption'
      ? escape(caption)
      : `${escape(IG_FIXTURE.captionLine)}<br><a href="/explore/tags/generated_fern/">${IG_FIXTURE.captionTag}</a>`;
  if (variant === 'caption-text-button')
    captionText += '<div role="button">See translation</div>';
  let captionBlock = caption
    ? `<div><span dir="auto"><div><div>${author(owner)}<span><time datetime="${IG_FIXTURE.postAt}">1w</time></span></div><span>${captionText}</span></div></span><div><div role="button"><span dir="auto"><span>See translation</span></span></div>${variant === 'cut-caption' ? '<button>more</button>' : ''}</div></div>`
    : '';
  if (variant === 'caption-no-text')
    captionBlock = captionBlock.replace(`<span>${captionText}</span>`, '');
  if (variant === 'caption-extra-text')
    captionBlock = captionBlock.replace(
      `<span>${captionText}</span>`,
      `<span>${captionText}</span><span>${IG_FIXTURE.postDecoys.secondText}</span>`,
    );
  if (variant === 'caption-no-wrapper')
    captionBlock = captionBlock.replace('<span dir="auto">', '<span>');
  if (variant === 'caption-no-time')
    captionBlock = captionBlock.replace(
      `<time datetime="${IG_FIXTURE.postAt}">1w</time>`,
      '',
    );
  if (variant === 'caption-linked-time')
    captionBlock = captionBlock.replace(
      `<time datetime="${IG_FIXTURE.postAt}">1w</time>`,
      ownLink(owner),
    );
  const mediaDecoy =
    variant === 'media-decoys'
      ? commentRow(
          other.replace(
            textSpan(escape(IG_FIXTURE.other.text)),
            textSpan(
              escape(IG_FIXTURE.other.text) +
                '<img src="/profiles/comment.png">',
            ),
          ),
          IG_FIXTURE.other.username,
        )
      : '';
  const duplicate = comment.replace(
    permalink(commentId, time),
    permalink(commentId, time) + permalink('282828282828282828', time),
  );
  const scrolling =
    variant.startsWith('scroll-') || variant.startsWith('expansion-');
  const filler = (ordinal: number) =>
    commentRow(
      commentBlock(
        IG_FIXTURE.other.username,
        escape(IG_FIXTURE.other.text) + ' ' + ordinal,
        String(987650000 + ordinal),
        IG_FIXTURE.other.time,
      ),
      IG_FIXTURE.other.username,
    );
  const commentRows = scrolling
    ? Array.from({ length: 10 }, (_, ordinal) => filler(ordinal)).join('')
    : commentRow(other, IG_FIXTURE.other.username) +
      (hideComment || ['hidden', 'not-shown', 'list-cut'].includes(variant)
        ? ''
        : commentRow(
            variant === 'multi-permalink' ? duplicate : comment,
            username,
          )) +
      (variant === 'several'
        ? commentRow(comment.replace(commentId, '282828282828282828'), username)
        : '');
  const body = `<main><section><div><a href="/${escape(variant === 'owner-picture-profile' ? IG_FIXTURE.other.username : firstProfile)}/"><img src="/profiles/owner.png" alt=""></a>${profile(firstProfile)}</div>${mediaDecoy}${variant === 'video' ? '<video></video>' : `<img src="/media/${code}.png?signature=generated-secret" alt="generated media">`}</section><section>${ownLink(owner)}${extraOwnLink}${captionBlock}<div id="comments" style="overflow-y:${variant === 'scroll-no-column' ? 'visible' : 'auto'};max-height:240px"><div><div><div><div><div id="comment-rows">${commentRows}</div></div></div></div></div></div>${variant === 'hidden' ? '<button>Load more comments</button>' : ''}<button>Like</button><button>Follow</button><button>Delete</button><input></section></main>${variant === 'post-two-main' ? '<main></main>' : ''}`;
  const unsettled = `const own=document.querySelector('main>section:last-child>a');const parent=own.parentElement;mutate(()=>own.remove());${['own-link-flicker', 'expansion-link-flicker'].includes(variant) ? `setTimeout(()=>mutate(()=>parent.prepend(own)),700);` : ''}`;
  const script =
    instrumentation +
    `let expansions=0;const comment=${json(commentRow(comment, username))};function expand(event){mutate(()=>{expansions++;event.currentTarget.remove();if(expansions<3){const button=document.createElement('button');button.textContent=expansions===1?'View replies':'Load more comments';button.onclick=expand;document.querySelector('main>section:last-child').prepend(button)}else document.getElementById('comment-rows').insertAdjacentHTML('beforeend',comment)})}const load=[...document.querySelectorAll('button')].find(b=>b.textContent==='Load more comments');if(load)load.onclick=expand;
${variant.startsWith('own-link-') ? `setTimeout(()=>{${unsettled}},150);` : ''}
${variant.startsWith('expansion-link-') ? `document.getElementById('comments').addEventListener('wheel',()=>{if(window.unsettled)return;window.unsettled=true;${unsettled}},{passive:true});` : ''}
${['expansion-post-switch', 'expansion-kind-switch'].includes(variant) ? `document.getElementById('comments').addEventListener('wheel',()=>{if(window.switched)return;window.switched=true;const before=${json(`/${kind}/${code}`)},after=${json(variant === 'expansion-kind-switch' ? `/reel/${code}` : `/${kind}/${IG_FIXTURE.other.code}`)};mutate(()=>{for(const link of document.querySelectorAll('main a[href]'))link.setAttribute('href',link.getAttribute('href').replace(before,after));history.replaceState(null,'',after)})},{passive:true});` : ''}
${scrolling ? `let scrollLoads=0;const scrollFillers=${json(Array.from({ length: 12 }, (_, ordinal) => filler(100 + ordinal)))};document.getElementById('comments').addEventListener('wheel',e=>{if(e.deltaX!==0||e.deltaY!==700)return;scrollLoads++;mutate(()=>{const rows=document.getElementById('comment-rows');if((${json(variant)}==='scroll-first'||${json(variant)}==='expansion-link-flicker'||${json(variant)}==='expansion-link-vanishes')&&scrollLoads===${IG_FIXTURE.scroll.first}||${json(variant)}==='scroll-late'&&scrollLoads===${IG_FIXTURE.scroll.beyondLimit})rows.insertAdjacentHTML('beforeend',comment);else if(['scroll-late','scroll-ten'].includes(${json(variant)}))rows.insertAdjacentHTML('beforeend',scrollFillers[scrollLoads-1]||'')})},{passive:true});` : ''}
${variant === 'no-json' ? '' : `fetch('/data/${code}.json').then(r=>r.json()).catch(()=>{});`}
${variant === 'two-answers' ? `fetch('/data/${code}.json?different=1').then(r=>r.json()).catch(()=>{});` : ''}
`;
  const decoy =
    variant === 'post-decoy'
      ? '<button role="button" aria-label="Generated post decoration"><img src="/thumb.png" alt="">Not a list row</button>'
      : variant === 'post-decoy-foreign'
        ? `<button role="button" aria-label="Generated post decoration"><img src="/thumb.png" alt="">${IG_FIXTURE.other.username} ${IG_FIXTURE.other.text} 1w</button>`
        : '';
  return doc(body + decoy, script);
}
export function postAnswer(
  item: Item,
  index: number,
  variant: Variant,
  origin: string,
  different: boolean,
  code = `${IG_FIXTURE.code}${index || ''}`,
): unknown {
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
