import { useEffect, useState } from 'react';
import type { Original } from '@socialprune/core';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import styles from './Social.module.css';
import { originalDisplayText } from './originalText.ts';
const mediaMessages = {
  failed: 'originals.media.failed',
  refused: 'originals.media.refused',
  'too-large': 'originals.media.too-large',
  'hls-only': 'originals.media.hls-only',
  'no-variant': 'originals.media.no-variant',
  'run-cap': 'originals.media.run-cap',
  'not-stored': 'originals.media.not-stored',
  stored: 'originals.media.stored',
} as const;
export function StoredMedia({ original }: { original: Original }) {
  const t = useT(),
    [missing, setMissing] = useState<string | null>(null);
  const [playback, setPlayback] = useState<string | null>(null);
  return (
    <div
      className={styles.originalPhotos}
      data-has-video={original.media.some((media) => media.kind !== 'photo')}
    >
      {original.media.map((media) => (
        <div key={media.n}>
          {media.status === 'stored' && media.file ? (
            media.kind === 'photo' ? (
              <img
                src={`/originals/${original.id}/${media.file}`}
                alt={media.altText ?? t('originals.photo')}
                loading="lazy"
                onError={() => setMissing(media.file)}
              />
            ) : (
              <video
                controls
                preload="metadata"
                playsInline
                loop={media.kind === 'gif'}
                muted={media.kind === 'gif'}
                poster={
                  media.poster
                    ? `/originals/${original.id}/${media.poster}`
                    : undefined
                }
                src={`/originals/${original.id}/${media.file}`}
                onError={() => {
                  void fetch(`/originals/${original.id}/${media.file}`, {
                    method: 'HEAD',
                  })
                    .then((response) => {
                      if (response.status === 404) setMissing(media.file);
                      else setPlayback(media.file);
                    })
                    .catch(() => setPlayback(media.file));
                }}
              />
            )
          ) : (
            <>
              {media.poster && (
                <img
                  src={`/originals/${original.id}/${media.poster}`}
                  alt={media.altText ?? t('originals.photo')}
                  loading="lazy"
                  onError={() => setMissing(media.poster)}
                />
              )}
              <p className={styles.hint}>{t(mediaMessages[media.status])}</p>
            </>
          )}
          {missing === media.file && media.file && (
            <p className={styles.hint}>{t('originals.notInCopy')}</p>
          )}
          {playback === media.file && media.file && (
            <p className={styles.hint}>{t('originals.playbackUnavailable')}</p>
          )}
        </div>
      ))}
    </div>
  );
}
export function Conversation({
  id,
  client,
}: {
  id: string;
  client: WorkspaceClient;
}) {
  const t = useT(),
    [value, setValue] = useState<Awaited<
      ReturnType<WorkspaceClient['getConversation']>
    > | null>(null),
    [own, setOwn] = useState<Record<string, { text: string; handle: string }>>(
      {},
    );
  useEffect(() => {
    let active = true;
    void client
      .getConversation(id)
      .then(async (result) => {
        const own: Record<string, { text: string; handle: string }> = {};
        for (const link of result.chain)
          if (link.ownItemId) {
            const reply = await client.request({
              type: 'detail',
              requestId: crypto.randomUUID(),
              itemId: link.ownItemId,
            });
            if (reply.type === 'itemDetail')
              own[link.ownItemId] = {
                text: reply.item.text,
                handle: reply.item.account.handle ?? reply.item.account.key,
              };
          }
        if (active) {
          setValue(result);
          setOwn(own);
        }
      })
      .catch(() => {
        if (active) setValue(null);
      });
    return () => {
      active = false;
    };
  }, [id, client]);
  if (!value || !value.chain.length) return null;
  return (
    <details className={styles.conversation}>
      <summary>
        {t('originals.conversation', { count: value.chain.length })}
      </summary>
      {value.chain.map((link) => (
        <section key={link.id} className={styles.original}>
          {link.original ? (
            <>
              <strong>
                {link.original.authorName} @{link.original.authorHandle}
              </strong>
              <p className={styles.postText} dir="auto">
                {originalDisplayText(link.original) ?? t('originals.notFound')}
              </p>
              <StoredMedia original={link.original} />
            </>
          ) : (
            <>
              <strong>
                {t('originals.yourPost')} @
                {link.ownItemId ? own[link.ownItemId]?.handle : ''}
              </strong>
              <p dir="auto">
                {link.ownItemId ? own[link.ownItemId]?.text : ''}
              </p>
            </>
          )}
        </section>
      ))}
      {value.state === 'partial' && <p>{t('originals.chainPartial')}</p>}
    </details>
  );
}
