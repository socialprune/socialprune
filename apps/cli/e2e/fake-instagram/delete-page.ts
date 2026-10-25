import type { Item } from '@socialprune/core';
import { postPage } from './pages.ts';

export type DeleteCase =
  | 'success'
  | 'ambiguous'
  | 'extra-field'
  | 'notice-caption'
  | 'notice-comment'
  | 'notice-dialog'
  | 'http-429'
  | 'feedback_required'
  | 'please_wait'
  | 'spam'
  | 'checkpoint_required'
  | 'Action Blocked'
  | 'Try again later'
  | 'generic-error'
  | 'wrong-id'
  | 'wrong-time'
  | 'wrong-owner'
  | 'wrong-account'
  | 'wrong-language'
  | 'login'
  | 'challenge'
  | 'second-write';
export function deletionPost(
  item: Item,
  index: number,
  code: string,
  scenario: DeleteCase,
  removed: boolean,
): string {
  const id = String(191919191919191919n + BigInt(index));
  let html = postPage(item, index, 'success', code);
  if (scenario === 'login' || scenario === 'challenge')
    return `<!doctype html><html lang="en"><body><script>location.href='/accounts/${scenario}/';</script></body></html>`;
  html = html.replaceAll(
    "fetch('/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(window.events)}).catch(()=>{})",
    'void 0',
  );
  html = html.replace(
    '<body>',
    `<body><nav><a href="/${item.account.handle}/">Profile</a></nav>${scenario === 'notice-dialog' ? '<div role="dialog">I will try again later! my action blocked the door</div>' : ''}`,
  );
  if (scenario === 'notice-caption')
    html = html.replace(
      '<section>',
      '<section><div data-generated="caption">I will try again later! my action blocked the door</div>',
    );
  if (scenario === 'notice-comment')
    html = html.replace(
      '<div id="comment-rows">',
      '<div id="comment-rows"><div data-generated="comment">I will try again later! my action blocked the door</div>',
    );
  html = html.replace(
    '</body>',
    `<script>
  history.replaceState(null,'','/p/${code}/c/${id}/');
  const marker=document.querySelector('a[href="/p/${code}/c/${id}/"]');
  const block=marker?.parentElement?.parentElement?.parentElement;
  const row=block?.parentElement;
  if(row){
    const options=document.createElement('button');options.textContent='Options';row.append(options);
    options.onclick=()=>{
      const menu=document.createElement('div');menu.setAttribute('role','dialog');
      const del=document.createElement('button');del.textContent='Delete';menu.append(del);document.body.append(menu);
      del.onclick=async()=>{
        const response=await fetch('/api/v1/web/comments/987/delete/${id}/',{method:'POST'});
        const body=await response.json();
        if(${JSON.stringify(scenario)}==='second-write')fetch('/api/v1/web/comments/987/delete/${id}/',{method:'POST'}).catch(()=>{});
        if(body.status==='ok'&&${JSON.stringify(scenario)}!=='ambiguous'){
          row.remove();menu.remove();const status=document.createElement('div');status.setAttribute('role','status');status.textContent='Comment deleted';document.body.append(status);
        }else if(${JSON.stringify(scenario)}==='Action Blocked'||${JSON.stringify(scenario)}==='Try again later'){
          const message=document.createElement('h2');message.setAttribute('role','alert');message.textContent=${JSON.stringify(scenario)};document.body.append(message);
        }else if(${JSON.stringify(scenario)}==='generic-error'){
          const message=document.createElement('h2');message.textContent='Something went wrong';document.body.append(message);
        }
      };
    };
    ${removed ? 'row.remove();' : ''}
    ${scenario === 'wrong-id' ? `marker.setAttribute('href','/p/${code}/c/777/');` : ''}
    ${scenario === 'wrong-time' ? `marker.querySelector('time').setAttribute('datetime','2020-01-01T00:00:00.000Z');` : ''}
  }
  </script></body>`,
  );
  if (scenario === 'wrong-language')
    html = html.replace('lang="en"', 'lang="de"');
  if (scenario === 'wrong-account')
    html = html.replaceAll(
      `href="/${item.account.handle}/"`,
      'href="/generated_foreign/"',
    );
  if (scenario === 'wrong-owner')
    html = html.replaceAll(
      item.reference.ownerHandle!,
      'generated_wrong_owner',
    );
  return html;
}
