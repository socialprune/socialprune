import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useIntl } from 'react-intl';
import type { InstagramContext, Item } from '@socialprune/core';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import styles from './InstagramPost.module.css';

export function InstagramPost({
  record,
  zone,
}: {
  record: InstagramContext;
  zone?: string;
}) {
  const t = useT(),
    intl = useIntl(),
    screenshotId = useId();
  const [showScreenshot, setShowScreenshot] = useState(false),
    [missingImage, setMissingImage] = useState(false),
    [missingScreenshot, setMissingScreenshot] = useState(false);
  const date = new Intl.DateTimeFormat(
    intl.locale === 'en' ? 'en-GB' : intl.locale,
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: zone,
    },
  ).format(new Date(record.confirmedAt));
  const base = `/context/instagram/${record.post.code}/`;
  return (
    <section
      className={styles.post}
      data-testid="instagram-post"
      aria-label={t('review.post')}
    >
      <div className={styles.byline}>
        <span className={styles.avatar} aria-hidden="true">
          {record.post.owner.slice(0, 2).toUpperCase()}
        </span>
        <strong>@{record.post.owner}</strong>
        {record.post.createdAt && (
          <time dateTime={record.post.createdAt}>
            {intl.formatDate(record.post.createdAt, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: zone,
            })}
          </time>
        )}
      </div>
      {record.post.caption && (
        <p className={styles.caption} dir="auto">
          {record.post.caption}
        </p>
      )}
      {!record.post.captionComplete && (
        <p className={styles.note}>{t('instagramContext.captionCut')}</p>
      )}
      {record.image.status === 'stored' && record.image.file ? (
        missingImage ? (
          <p className={styles.note}>{t('originals.notInCopy')}</p>
        ) : (
          <img
            className={styles.image}
            src={base + record.image.file}
            alt={t('review.post')}
            loading="lazy"
            onError={() => setMissingImage(true)}
          />
        )
      ) : (
        <p className={styles.note}>{t('instagramContext.imageNotKept')}</p>
      )}
      <div className={styles.actions}>
        {record.screenshot.status === 'stored' && record.screenshot.file && (
          <button
            type="button"
            aria-expanded={showScreenshot}
            aria-controls={screenshotId}
            onClick={() => setShowScreenshot((value) => !value)}
          >
            {t('instagramContext.showScreenshot')}
          </button>
        )}
        <a
          href={`https://www.instagram.com/${record.post.kind}/${record.post.code}/`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={16} aria-hidden="true" />
          {t('instagramContext.open')}
        </a>
      </div>
      <div id={screenshotId}>
        {showScreenshot &&
          record.screenshot.file &&
          (missingScreenshot ? (
            <p className={styles.note}>{t('originals.notInCopy')}</p>
          ) : (
            <img
              className={styles.image}
              src={base + record.screenshot.file}
              alt={t('instagramContext.screenshot', { date })}
              onError={() => setMissingScreenshot(true)}
            />
          ))}
      </div>
      <p className={styles.note}>
        {t(
          record.confirmedBy === 'list'
            ? 'instagramContext.foundInList'
            : 'instagramContext.found',
          { date },
        )}
      </p>
    </section>
  );
}

export function InstagramPostContext({
  item,
  client,
  zone,
  fallback,
}: {
  item: Item;
  client?: WorkspaceClient;
  zone?: string;
  fallback: ReactNode;
}) {
  const [stored, setStored] = useState<{
    client: WorkspaceClient;
    record: InstagramContext;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (client && item.platform === 'instagram' && item.kind === 'comment')
      void client
        .getInstagramContext([item.id])
        .then((records) => {
          const record = records.find(
            (entry) =>
              entry.itemId === item.id && entry.accountKey === item.account.key,
          );
          if (active) setStored(record ? { client, record } : null);
        })
        .catch(() => {
          if (active) setStored(null);
        });
    return () => {
      active = false;
    };
  }, [client, item.id, item.account.key, item.platform, item.kind]);
  const record =
    stored?.client === client &&
    stored?.record.itemId === item.id &&
    stored.record.accountKey === item.account.key
      ? stored.record
      : null;
  return record ? (
    <InstagramPost key={record.itemId} record={record} zone={zone} />
  ) : (
    fallback
  );
}
