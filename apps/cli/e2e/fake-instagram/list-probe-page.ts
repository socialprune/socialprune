import type { Item } from '@socialprune/core';
import { listPage } from './pages.ts';

export type ListProbeCase = 'below-first' | 'other-date' | 'absent';
export const PROBE_CLIENT_HEIGHT = 160;
/** Synthetic rows and filter semantics, no account-derived material. */
export function listProbePage(
  items: readonly Item[],
  probe: ListProbeCase,
): string {
  return listPage(items, 'success', 0)
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
}
