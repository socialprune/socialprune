import { createServer } from 'node:http';
import type { Item } from '@socialprune/core';
import { IG_FIXTURE, POST_NOTICE_FIXTURE } from './fixture.ts';
import type { Variant } from './fixture.ts';
import { listPage, postPage, postAnswer, answerResponse } from './pages.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { imageCase, imageCasePage, imageCasePng } from './image-cases.ts';
import type { ImageCaseName } from './image-cases.ts';
import { deletionPost } from './delete-page.ts';
import { addRepliesPage } from './replies-page.ts';
import { listProbePage } from './list-probe-page.ts';
import type { ListProbeCase } from './list-probe-page.ts';
import type { DeleteCase } from './delete-page.ts';

export async function fakeInstagram(port: number, items: readonly Item[]) {
  let variant: Variant = 'success',
    zone = 0,
    today = IG_FIXTURE.now.slice(0, 10),
    firstYear = 1919;
  const requests: { method: string; path: string }[] = [],
    events: {
      inputs: string[];
      choices: { type: string; side: string; unit: string; label: string }[];
      clicks: string[];
      added: string[];
      wheels: { area: string; x: number; y: number }[];
    }[] = [];
  let beforeNavigation: (() => Promise<void>) | undefined;
  const postVariants = new Map<number, Variant>();
  const hiddenPosts = new Set<number>();
  const slowPosts = new Map<number, number>();
  let emptyFilteredLists = 0;
  let replyCount = 0;
  let probeCase: ListProbeCase | undefined;
  let replyControlMalformed = false;
  let directPostAccount: 'expected' | 'other' | undefined;
  let windowLists:
    'populated-empty' | 'empty-empty' | 'populated-populated' | undefined;
  let delayedFilterClose = false;
  let clientSidePosts = false;
  let filteredPlaceholders: { count: number; status: boolean } | undefined;
  let imageOnlyList:
    | {
        indices: readonly number[];
        busy: boolean;
        mismatch: boolean;
        lateText: boolean;
        issue?: 'account' | 'language' | 'notice' | 'http-429';
      }
    | undefined;
  let imageShape: ImageCaseName | undefined;
  let deletion: DeleteCase | undefined;
  let listDecoration: 'caption' | 'comment' | 'dialog' | undefined;
  const deletedComments = new Set<string>();
  const deleteAttempts: string[] = [];
  let listFreshness:
    | 'retained'
    | 'sibling'
    | 'repeated'
    | 'readable-retained'
    | 'readable-repeated'
    | undefined;
  let likesCase: 'answer' | 'dom' | 'unknown' | undefined;
  const candidates = new Map<
    number,
    readonly { code: string; variant: Variant }[]
  >();
  const candidatePost = (code: string) => {
    for (const [index, posts] of candidates) {
      const post = posts.find((post) => post.code === code);
      if (post) return { index, ...post };
    }
    return undefined;
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, `http://127.0.0.1:${port}`),
        path = url.pathname;
      requests.push({ method: request.method!, path });
      response.setHeader('Cache-Control', 'no-store');
      if (deletion) {
        const deletePost = /^\/p\/(GeneratedDelete_(\d+))\/(?:c\/\d+\/)?$/.exec(
          path,
        );
        if (deletePost && items[Number(deletePost[2])]) {
          const index = Number(deletePost[2]);
          response.setHeader('Content-Type', 'text/html');
          response.end(
            deletionPost(
              items[index]!,
              index,
              deletePost[1]!,
              deletion,
              deletedComments.has(String(191919191919191919n + BigInt(index))),
            ),
          );
          return;
        }
        const deleteComment =
          /^\/api\/v1\/web\/comments\/987\/delete\/(\d+)\/$/.exec(path);
        if (deleteComment) {
          deleteAttempts.push(deleteComment[1]!);
          response.setHeader('Content-Type', 'application/json');
          if (deletion === 'http-429') response.statusCode = 429;
          const status = [
            'feedback_required',
            'please_wait',
            'spam',
            'checkpoint_required',
          ].includes(deletion)
            ? deletion
            : [
                  'http-429',
                  'Action Blocked',
                  'Try again later',
                  'generic-error',
                ].includes(deletion)
              ? 'fail'
              : 'ok';
          if (status === 'ok') deletedComments.add(deleteComment[1]!);
          response.end(
            JSON.stringify(
              deletion === 'extra-field' ? { status, x: 1 } : { status },
            ),
          );
          return;
        }
      }
      if (path === '/events') {
        let text = '';
        for await (const part of request) text += String(part);
        events.push(JSON.parse(text) as (typeof events)[number]);
        response.end('{}');
        return;
      }
      if (path === '/restored') {
        const operation =
          url.searchParams.get('mutation') === '1'
            ? 'RestoredMutation'
            : 'RestoredCommentsQuery';
        response.setHeader('Content-Type', 'text/html');
        const signal = url.searchParams.get('limit');
        response.end(
          `<!doctype html><html lang="en"><body>Generated restored tab<script>fetch('/startup-read${signal === '429' || signal === 'signal' ? '?limit=' + signal : ''}',{method:'POST',headers:{'x-fb-friendly-name':'${operation}'}}).then(r=>r.json()).then(()=>document.body.dataset.ready='yes',()=>document.body.dataset.ready='blocked');</script></body></html>`,
        );
        return;
      }
      if (path === '/startup-read') {
        response.setHeader('Content-Type', 'application/json');
        if (url.searchParams.get('limit') === '429') response.statusCode = 429;
        response.end(
          url.searchParams.get('limit') === 'signal'
            ? '{"status":"feedback_required"}'
            : '{}',
        );
        return;
      }
      const notice = POST_NOTICE_FIXTURE.cases.find(
        (entry) =>
          entry.variant === url.searchParams.get('generated_case') &&
          entry.path === path,
      );
      if (notice) {
        const body =
          'padding' in notice
            ? Buffer.alloc(notice.padding, 32)
            : Buffer.from(notice.body);
        response.writeHead(404, {
          'Content-Type': notice.type,
          'Content-Length': String(body.length),
          ...('encoding' in notice
            ? { 'Content-Encoding': notice.encoding }
            : {}),
        });
        response.end(body);
        return;
      }
      if (path.startsWith('/api/v1/generated/post-notice/')) {
        const status = Number(path.split('/').at(-2));
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'generated-read-error' }));
        return;
      }
      if (path === '/api/v1/generated/read/') {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Retry-After', IG_FIXTURE.other.code);
        response.setHeader('X-RateLimit-Remaining', IG_FIXTURE.other.username);
        if (variant === 'side-429') response.writeHead(429);
        const signal =
          variant === 'feedback-required'
            ? 'feedback_required'
            : variant === 'please-wait'
              ? 'please_wait'
              : variant === 'checkpoint-required'
                ? 'checkpoint_required'
                : variant === 'spam'
                  ? 'spam'
                  : null;
        response.end(
          JSON.stringify(
            signal
              ? { data: { message: signal }, unrelated: IG_FIXTURE.other.text }
              : { status: 'ok' },
          ),
        );
        return;
      }
      if (variant === 'signal-metrics' && path === '/graphql/query') {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (variant === 'signal-metrics' && path === '/api/v1/generated/error/') {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (path === '/your_activity/interactions/comments') {
        if (probeCase) {
          response.setHeader('Content-Type', 'text/html');
          response.end(listProbePage(items, probeCase));
          return;
        }
        await beforeNavigation?.();
        response.writeHead(variant === '429' ? 429 : 200, {
          'Content-Type': 'text/html',
        });
        let html = listPage(
          items,
          variant,
          zone,
          { today, firstYear },
          candidates,
          postVariants,
          clientSidePosts,
        );
        if (windowLists) {
          const loop = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(loop))
            throw new Error('Generated window-list anchor missing');
          const emptyCondition =
            windowLists === 'empty-empty'
              ? 'true'
              : windowLists === 'populated-empty'
                ? 'start&&end'
                : 'false';
          html = html.replace(
            loop,
            `if(${emptyCondition})chosen=[];if(!chosen.length){const empty=document.createElement('p');empty.textContent='No results';list.append(empty);}` +
              loop,
          );
          if (delayedFilterClose) {
            html = html.replace(
              "const apply=document.createElement('div');",
              "const image=document.createElement('img');dialog.append(image);const apply=document.createElement('div');",
            );
            html = html.replace(
              'outer.remove();loads=0;render()',
              'if(start&&end){setTimeout(()=>mutate(()=>outer.remove()),500)}else outer.remove();loads=0;render()',
            );
          }
        }
        if (listDecoration === 'dialog')
          html = html.replace(
            '<body>',
            '<body><div role="dialog">I will try again later! my action blocked the door</div>',
          );
        if (emptyFilteredLists > 0) {
          emptyFilteredLists--;
          const anchor = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(anchor))
            throw new Error('Generated filtered-list anchor missing');
          html = html.replace(anchor, 'if(start&&end)chosen=[];' + anchor);
        }
        if (filteredPlaceholders) {
          const anchor = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(anchor))
            throw new Error('Generated placeholder anchor missing');
          html = html.replace(
            anchor,
            `if(start&&end){chosen=[];for(let i=0;i<${filteredPlaceholders.count};i++)emptyImageButton();${filteredPlaceholders.status ? "const status=document.createElement('div');status.setAttribute('role','status');status.textContent='No generated comments in this window';list.append(status);" : "list.setAttribute('aria-busy','true');"}}` +
              anchor,
          );
        }
        if (imageOnlyList) {
          const anchor = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(anchor))
            throw new Error('Generated image-only anchor missing');
          const windows = imageOnlyList.indices.map((index) => [
            new Date(Date.parse(items[index]!.createdAt) - 86400000)
              .toISOString()
              .slice(0, 10),
            new Date(Date.parse(items[index]!.createdAt) + 86400000)
              .toISOString()
              .slice(0, 10),
          ]);
          html = html.replace(
            anchor,
            `if(start&&end&&${JSON.stringify(windows)}.some(pair=>${imageOnlyList.mismatch ? 'pair[1]===end' : 'pair[0]===start&&pair[1]===end'})){chosen=[];const otherRow=document.createElement('div');otherRow.setAttribute('role','button');otherRow.setAttribute('aria-label','Generated readable decoration');otherRow.textContent=other.username+' '+other.text+' 1w';list.append(otherRow);for(let i=0;i<3;i++){emptyImageButton();list.lastElementChild.setAttribute('aria-label','Generated window '+start+' '+i);}${imageOnlyList.busy ? "list.setAttribute('aria-busy','true');" : ''}${imageOnlyList.lateText ? "setTimeout(()=>mutate(()=>{list.lastElementChild.append(document.createTextNode(handle+' '+rows[0].text+' 1w'));list.lastElementChild.setAttribute('aria-label','Comment row');list.lastElementChild.onclick=()=>location.href='/p/'+rows[0].code;}),250);" : ''}}` +
              anchor,
          );
          if (imageOnlyList.issue) {
            const issue =
              imageOnlyList.issue === 'account'
                ? "document.querySelector('nav a').setAttribute('href','/generated_changed_account/');const own=document.createElement('div');own.setAttribute('role','button');own.setAttribute('aria-label','Generated own nonmatch');own.innerHTML='<img>';own.append(document.createTextNode(handle+' Generated unrelated own comment 1w'));list.append(own);"
                : imageOnlyList.issue === 'language'
                  ? "document.documentElement.lang='de';"
                  : imageOnlyList.issue === 'notice'
                    ? "const notice=document.createElement('p');notice.textContent='Something went wrong';list.append(notice);"
                    : "fetch('/api/v1/generated/post-notice/429/');";
            html = html.replace(anchor, `if(start&&end){${issue}}` + anchor);
          }
          if (imageOnlyList.mismatch) {
            const change = "const apply=document.createElement('div');";
            if (!html.includes(change))
              throw new Error('Generated combined readback anchor missing');
            html = html.replace(
              change,
              "controls.end.day.addEventListener('change',()=>{const first=controls.start.day;first.selectedIndex=(first.selectedIndex+1)%first.options.length});" +
                change,
            );
          }
        }
        if (listFreshness) {
          const opaque = listFreshness.startsWith('readable-')
            ? "function opaque(){document.querySelector('#generated-outside-row')?.remove();list.replaceChildren();emptyImageButton();const decoration=document.createElement('div');decoration.id='generated-outside-row';decoration.setAttribute('role','button');decoration.setAttribute('aria-label','Generated fixed readable decoration');decoration.innerHTML='<img>';decoration.append(document.createTextNode(handle+' Generated unrelated comment 1w'));document.body.append(decoration);}"
            : "function opaque(){list.replaceChildren();const decoration=document.createElement('div');decoration.setAttribute('role','button');decoration.setAttribute('aria-label','Generated fixed readable decoration');decoration.append(document.createTextNode(other.username+' '+other.text+' 1w'));list.append(decoration);for(let i=0;i<3;i++)emptyImageButton();}";
          html = html.replace(
            'function render(){',
            opaque + 'function render(){',
          );
          html = html.replace(
            "const apply=document.createElement('div');",
            "const dialogDecoy=document.createElement('div');dialogDecoy.setAttribute('role','button');dialogDecoy.setAttribute('aria-label','Generated filter decoration');dialogDecoy.innerHTML='<img>';dialog.append(dialogDecoy);const apply=document.createElement('div');",
          );
          if (listFreshness.endsWith('repeated')) {
            html = html.replace(
              'for(const [index,row]of chosen.entries())',
              'if(start&&end){opaque();chosen=[];}for(const [index,row]of chosen.entries())',
            );
          } else {
            html = html.replace(
              'dirty[side]=true;',
              'dirty[side]=true;if(dirty.start&&dirty.end)opaque();',
            );
            html = html.replace(
              'outer.remove();loads=0;render()',
              `outer.remove();loads=0;if(!start||!end)render();${listFreshness === 'sibling' ? "else{const sibling=document.createElement('section');sibling.id='generated-filter-result';for(const row of rows.filter(row=>row.at.slice(0,10)>=start&&row.at.slice(0,10)<=end)){const node=document.createElement('div');node.setAttribute('role','button');node.innerHTML='<img>';node.append(document.createTextNode(row.username+' '+row.text+' 1w'));const time=document.createElement('time');time.dateTime=row.at;node.append(time);sibling.append(node)}list.after(sibling)}" : ''}`,
            );
          }
        }
        response.end(html);
        return;
      }
      if (path.startsWith('/accounts/')) {
        response.end('<html lang="en"><h1>Login</h1></html>');
        return;
      }
      const post = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      if (post) {
        const candidate = candidatePost(post[1]!);
        if (candidate) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(
            postPage(
              items[candidate.index]!,
              candidate.index,
              candidate.variant,
              candidate.code,
              hiddenPosts.has(candidate.index),
            ),
          );
          return;
        }
        if (post[1]!.startsWith('Generated_wrong_candidate')) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(
            postPage(items[items.length > 1 ? 1 : 0]!, 0, 'time').replaceAll(
              IG_FIXTURE.code,
              post[1]!,
            ),
          );
          return;
        }
        const index = items.findIndex(
          (_, index) => `${IG_FIXTURE.code}${index || ''}` === post[1],
        );
        const slow = slowPosts.get(index) ?? 0;
        if (slow > 0) {
          slowPosts.set(index, slow - 1);
          await delay(6500);
        }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        let html = postPage(
          items[Math.max(0, index)]!,
          Math.max(0, index),
          postVariants.get(index) ?? variant,
          undefined,
          hiddenPosts.has(index),
        );
        if (directPostAccount)
          html = html.replace(
            '<body>',
            `<body><nav><a href="/${directPostAccount === 'expected' ? items[0]!.account.handle! : IG_FIXTURE.other.username}/">Generated signed-in profile</a></nav>`,
          );
        if (likesCase) {
          // Reply decorations are independent from like-count source cases.
          html = html.replace(
            '<div role="button">Reply</div>',
            '<div role="button">999 likes</div><div role="button">Reply</div>',
          );
          if (likesCase !== 'unknown') {
            const marker = `/c/${BigInt(IG_FIXTURE.commentId) + BigInt(index)}/`;
            const at = html.indexOf(marker);
            html =
              html.slice(0, at) +
              html
                .slice(at)
                .replace(
                  '<div role="button">Reply</div>',
                  '<div role="button">17 likes</div><div role="button">Reply</div>',
                );
          }
        }
        if (replyCount)
          html = addRepliesPage(
            html,
            replyCount,
            String(BigInt(IG_FIXTURE.commentId) + BigInt(Math.max(0, index))),
            post[1]!,
            items[Math.max(0, index)]!.createdAt,
          );
        if (replyControlMalformed)
          html = html.replace(
            'View replies</button>',
            'View replies</button><button>View replies</button>',
          );
        if (listDecoration === 'caption')
          html = html.replace(
            '<section>',
            '<section><div data-generated="caption">I will try again later! my action blocked the door</div>',
          );
        if (listDecoration === 'comment')
          html = html.replace(
            '<div id="comment-rows">',
            '<div id="comment-rows"><div data-generated="comment">I will try again later! my action blocked the door</div>',
          );
        response.end(
          imageShape
            ? imageCasePage(
                html,
                imageShape,
                items[Math.max(0, index)]!,
                `http://127.0.0.1:${port}`,
                post[1]!,
              )
            : html,
        );
        return;
      }
      if (path.startsWith('/ajax/')) {
        const index = items.findIndex(
          (_, index) => path === `/ajax/${IG_FIXTURE.code}${index || ''}.json`,
        );
        const selected = postVariants.get(index) ?? variant;
        const answer = answerResponse(
          postAnswer(
            items[Math.max(0, index)]!,
            Math.max(0, index),
            selected,
            `http://127.0.0.1:${port}`,
            false,
          ),
          selected,
        );
        response.writeHead(200, { 'Content-Type': answer.type });
        response.end(answer.body);
        return;
      }
      if (path.startsWith('/data/')) {
        const candidate = candidatePost(
          path.slice('/data/'.length, -'.json'.length),
        );
        if (candidate) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify(
              postAnswer(
                items[candidate.index]!,
                candidate.index,
                candidate.variant,
                `http://127.0.0.1:${port}`,
                url.searchParams.has('different'),
                candidate.code,
              ),
            ),
          );
          return;
        }
        const index = items.findIndex(
          (_, index) => path === `/data/${IG_FIXTURE.code}${index || ''}.json`,
        );
        response.writeHead(200, { 'Content-Type': 'application/json' });
        if (imageShape) {
          response.end(
            JSON.stringify(
              imageCase(
                imageShape,
                items[Math.max(0, index)]!,
                `http://127.0.0.1:${port}`,
                path.slice('/data/'.length, -'.json'.length),
              ).body,
            ),
          );
          return;
        }
        response.end(
          JSON.stringify(
            withLikes(
              postAnswer(
                items[Math.max(0, index)]!,
                Math.max(0, index),
                postVariants.get(index) ?? variant,
                `http://127.0.0.1:${port}`,
                url.searchParams.has('different'),
              ),
              Math.max(0, index),
            ),
          ),
        );
        return;
      }
      if (
        path.startsWith('/media/') ||
        path.startsWith('/profiles/') ||
        path === '/thumb.png'
      ) {
        const image =
          imageShape && path.startsWith('/media/')
            ? imageCasePng(path.endsWith('/second.png'))
            : Buffer.from(IG_FIXTURE.png, 'base64');
        response.writeHead(200, {
          'Content-Type': variant === 'image-type' ? 'text/plain' : 'image/png',
        });
        response.end(
          variant === 'image-large' && path.startsWith('/media/')
            ? Buffer.concat([image, Buffer.alloc(5 * 1024 ** 2)])
            : image,
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  function withLikes(answer: unknown, index: number) {
    if (likesCase !== 'answer' && !replyCount) return answer;
    const item = items[index]!;
    return {
      ...(answer as object),
      comments: [
        {
          pk: String(BigInt(IG_FIXTURE.commentId) + BigInt(index)),
          created_at: Date.parse(item.createdAt) / 1000,
          user: { username: item.account.handle },
          text: item.text,
          ...(likesCase === 'answer' ? { comment_like_count: 23 } : {}),
          ...(replyCount
            ? {
                child_comment_count: replyCount,
                preview_child_comments: Array.from(
                  { length: replyCount },
                  (_, ordinal) => ({
                    pk: String(900000 + ordinal),
                    parent_comment_id: String(
                      BigInt(IG_FIXTURE.commentId) + BigInt(index),
                    ),
                    created_at: Date.parse(item.createdAt) / 1000,
                    user: { username: `generated_reply_${ordinal}` },
                    text: `Generated reply ${ordinal} with local text`,
                    ...(ordinal === 1
                      ? {}
                      : { comment_like_count: ordinal + 2 }),
                  }),
                ),
              }
            : {}),
        },
      ],
    };
  }
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    deleteAttempts,
    deletionCase(value: DeleteCase) {
      deletion = value;
    },
    decorateList(value: 'caption' | 'comment' | 'dialog') {
      listDecoration = value;
    },
    events,
    get listening() {
      return server.listening;
    },
    setVariant(value: Variant) {
      variant = value;
    },
    setPostVariant(index: number, value: Variant) {
      if (!Number.isInteger(index) || !items[index])
        throw new Error('Invalid generated post index.');
      postVariants.set(index, value);
    },
    setImageCase(value: ImageCaseName) {
      imageShape = value;
    },
    listFreshness(value: NonNullable<typeof listFreshness>) {
      listFreshness = value;
    },
    likes(value: 'answer' | 'dom' | 'unknown') {
      likesCase = value;
    },
    slowPostOpens(index: number, count: number) {
      if (!items[index] || !Number.isInteger(count) || count < 0)
        throw new Error('Invalid generated slow opens');
      slowPosts.set(index, count);
    },
    clientSidePostOpens() {
      clientSidePosts = true;
    },
    emptyFilteredLists(count: number) {
      if (!Number.isInteger(count) || count < 0)
        throw new Error('Invalid generated empty-filtered-list count');
      emptyFilteredLists = count;
    },
    windowLists(value: NonNullable<typeof windowLists>, delayedClose = false) {
      windowLists = value;
      delayedFilterClose = delayedClose;
    },
    replies(count: number) {
      replyCount = count;
    },
    listProbe(value: ListProbeCase) {
      probeCase = value;
    },
    malformedReplyControls() {
      replyControlMalformed = true;
    },
    directPostAccount(value: 'expected' | 'other') {
      directPostAccount = value;
    },
    filteredListPlaceholders(count: number, status: boolean) {
      if (!Number.isInteger(count) || count < 0 || count > 20)
        throw new Error('Invalid generated placeholder count');
      filteredPlaceholders = { count, status };
    },
    filteredImageOnly(
      indices: readonly number[],
      options: {
        busy?: boolean;
        mismatch?: boolean;
        lateText?: boolean;
        issue?: 'account' | 'language' | 'notice' | 'http-429';
      } = {},
    ) {
      if (indices.some((index) => !Number.isInteger(index) || !items[index]))
        throw new Error('Invalid generated image-only indices');
      imageOnlyList = {
        indices,
        busy: options.busy ?? false,
        mismatch: options.mismatch ?? false,
        lateText: options.lateText ?? false,
        ...(options.issue ? { issue: options.issue } : {}),
      };
    },
    setPostHidden(index: number) {
      if (!items[index])
        throw new Error('Invalid generated hidden post index.');
      hiddenPosts.add(index);
    },
    setCandidates(index: number, variants: readonly Variant[]) {
      if (
        !Number.isInteger(index) ||
        !items[index] ||
        variants.length < 1 ||
        variants.length > IG_FIXTURE.candidateCodes.length
      )
        throw new Error('Invalid generated candidate rows.');
      candidates.set(
        index,
        variants.map((variant, candidate) => ({
          code: `${IG_FIXTURE.candidateCodes[candidate]}${index || ''}`,
          variant,
        })),
      );
    },
    setZone(value: number) {
      zone = value;
    },
    setToday(value: string) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new Error('Invalid generated current day.');
      today = value;
    },
    setFirstYear(value: number) {
      if (!Number.isInteger(value) || value < 1000 || value > 9999)
        throw new Error('Invalid generated first year.');
      firstYear = value;
    },
    beforeList(value: () => Promise<void>) {
      beforeNavigation = value;
    },
    close() {
      return (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })());
    },
  };
}
