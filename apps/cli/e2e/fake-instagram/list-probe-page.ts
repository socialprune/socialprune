import type { Item } from '@socialprune/core';
import { listPage } from './pages.ts';

export type ListProbeCase =
  | 'below-first'
  | 'other-date'
  | 'absent'
  | 'newest-unsettled'
  | 'newest-selected'
  | 'newest-noop'
  | 'newest-default'
  | 'newest-default-ascending'
  | 'newest-default-tied'
  | 'newest-default-unknown'
  | 'newest-default-short';
export const PROBE_CLIENT_HEIGHT = 160;
/** Synthetic rows and filter semantics, no account-derived material. */
export function listProbePage(
  items: readonly Item[],
  probe: ListProbeCase,
): string {
  let source = listPage(items, 'success', 0)
    .replace('#list{height:420px;', `#list{height:${PROBE_CLIENT_HEIGHT}px;`)
    .replace(
      'let oldest=false,',
      "let oldest=sessionStorage.getItem('probe-oldest')==='true',",
    )
    .replace(
      'const mode=accountVariant(),mixed=',
      `const target=rows[0], fillers=Array.from({length:6},(_,i)=>({...target,text:'Generated unrelated probe row '+i}));chosen=${JSON.stringify(probe)}==='below-first'&&start?fillers.slice(0,Math.min(6,3*(loads+1))).map((row,i)=>i===4?target:row):${JSON.stringify(probe)}==='other-date'&&!start&&!oldest?[...fillers.slice(0,3),target]:fillers.slice(0,3);const mode=accountVariant(),mixed=`,
    )
    .replace(
      'oldest=true;apply.setAttribute',
      "oldest=true;dialog.querySelectorAll('[role=button]')[0].setAttribute('aria-pressed','true');dialog.querySelectorAll('[role=button]')[1].setAttribute('aria-pressed','false');apply.setAttribute",
    )
    .replace(
      'oldest=false;apply.setAttribute',
      "oldest=false;dialog.querySelectorAll('[role=button]')[1].setAttribute('aria-pressed','true');dialog.querySelectorAll('[role=button]')[0].setAttribute('aria-pressed','false');apply.setAttribute",
    )
    .replace(
      'applied=true;if(dirty.start)',
      "applied=true;sessionStorage.setItem('probe-oldest',String(oldest));if(dirty.start)",
    );
  if (probe === 'newest-unsettled')
    source = source
      .replace(
        'const mode=accountVariant(),mixed=',
        "if(sessionStorage.getItem('probe-newest-unsettled')==='true')chosen=[];const mode=accountVariant(),mixed=",
      )
      .replace(
        'applied=true;sessionStorage',
        "applied=true;if(!oldest)sessionStorage.setItem('probe-newest-unsettled','true');sessionStorage",
      );
  if (probe === 'newest-selected')
    source = source
      .replace(
        "let oldest=sessionStorage.getItem('probe-oldest')==='true',",
        'let oldest=false,',
      )
      .replace(
        "'other-date'&&!start&&!oldest",
        "'newest-selected'&&!start&&!oldest",
      )
      .replace(
        "const apply=document.createElement('div');",
        "dialog.querySelectorAll('[role=button]')[1].setAttribute('aria-pressed',String(!oldest));const apply=document.createElement('div');",
      )
      .replace(
        'oldest=false;dialog.querySelectorAll',
        'if(!oldest)return;oldest=false;dialog.querySelectorAll',
      );
  if (probe === 'newest-noop')
    source = source.replace(
      "oldest=false;dialog.querySelectorAll('[role=button]')[1].setAttribute('aria-pressed','true');dialog.querySelectorAll('[role=button]')[0].setAttribute('aria-pressed','false');apply.setAttribute('aria-disabled','false')",
      'return',
    );
  if (probe.startsWith('newest-default')) {
    source = source
      .replace(
        "let oldest=sessionStorage.getItem('probe-oldest')==='true',",
        'let oldest=false,',
      )
      .replace(
        "oldest=false;dialog.querySelectorAll('[role=button]')[1].setAttribute('aria-pressed','true');dialog.querySelectorAll('[role=button]')[0].setAttribute('aria-pressed','false');apply.setAttribute('aria-disabled','false')",
        'return',
      )
      .replace(
        'for(const [index,row]of chosen.entries())',
        `for(const [index,row]of chosen.slice(0,${probe === 'newest-default-short' ? 2 : 3}).entries())`,
      )
      .replace(
        'node.onclick=()=>location.href=',
        `const dates=${JSON.stringify(probe === 'newest-default-ascending' ? ['2025-01-01', '2025-01-02', '2025-01-03'] : probe === 'newest-default-tied' ? ['2025-01-03', '2025-01-03', '2025-01-03'] : ['2025-01-03', '2025-01-02', '2025-01-01'])};const time=document.createElement('time');time.setAttribute('datetime',${JSON.stringify(probe)}==='newest-default-unknown'?'unreadable':dates[index]+'T12:00:00Z');node.append(time);node.onclick=()=>location.href=`,
      );
  }
  return source;
}
