import { useEffect, useState } from 'react';
import { guideFacts } from '@socialprune/core/guide/check';
import type {
  DesktopBridge,
  DesktopBrowser,
  DesktopPlatform,
  DesktopProfileStatus,
} from '@socialprune/core/workspace/desktop-protocol';
import { guides } from '../app/guide.ts';
import { useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { command } from './bridge.ts';
import styles from './Desktop.module.css';
import { browserMessages } from './messages.ts';

export function DesktopGuide({
  bridge,
  locale,
  failed,
}: {
  bridge: DesktopBridge;
  locale: Locale;
  failed: (error: unknown) => void;
}) {
  const t = useT();
  const [platform, setPlatform] = useState<DesktopPlatform>('x');
  const guide = guides.find((guide) => guide.platform === platform)!;
  return (
    <section aria-labelledby="desktop-guide-title" className={styles.panel}>
      <h2 id="desktop-guide-title">{t('nav.guide')}</h2>
      <label className={styles.field}>
        {t('guide.choose')}
        <select
          value={platform}
          onChange={(event) =>
            setPlatform(event.target.value as DesktopPlatform)
          }
        >
          <option value="x">{t('guide.x')}</option>
          <option value="instagram">{t('guide.instagram')}</option>
        </select>
      </label>
      <p>{t('guide.notChecked')}</p>
      <ol>
        {guideFacts(guide).map((fact) => (
          <li key={fact.id} data-fact-id={fact.id}>
            <p>{fact.text[locale]}</p>
            <button
              onClick={() => {
                void command(bridge, {
                  type: 'openLink',
                  link: {
                    kind: 'guide-source',
                    platform,
                    factId: fact.id,
                    locale,
                  },
                }).catch(failed);
              }}
            >
              {t('guide.help', {
                platform: t(platform === 'x' ? 'guide.x' : 'guide.instagram'),
              })}
            </button>
          </li>
        ))}
      </ol>
      <button
        onClick={() => {
          void command(bridge, {
            type: 'openLink',
            link: { kind: 'guide-report' },
          }).catch(failed);
        }}
      >
        {t('guide.report')}
      </button>
    </section>
  );
}

export function Setup({
  bridge,
  locale,
  changeLocale,
  browser,
  changeBrowser,
  imported,
  failed,
}: {
  bridge: DesktopBridge;
  locale: Locale;
  changeLocale: (locale: Locale) => void;
  browser: DesktopBrowser;
  changeBrowser: (browser: DesktopBrowser) => void;
  imported: () => void;
  failed: (error: unknown) => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [browsers, setBrowsers] = useState<DesktopBrowser[]>([]);
  const [profiles, setProfiles] = useState<DesktopProfileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [storeBuild, setStoreBuild] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void command(bridge, { type: 'dataFolderInfo' })
      .then((reply) => {
        if (active && reply.type === 'dataFolderInfo')
          setStoreBuild(reply.folder.storeBuild);
      })
      .catch(failed);
    return () => {
      active = false;
    };
  }, [bridge, failed]);
  async function advance() {
    setBusy(true);
    try {
      if (step === 0) {
        const reply = await command(bridge, { type: 'browsers' });
        if (reply.type === 'browsersFound') {
          setBrowsers(reply.browsers);
          changeBrowser(
            reply.browsers.includes('edge')
              ? 'edge'
              : (reply.browsers[0] ?? 'edge'),
          );
        }
      }
      if (step === 1) {
        const results = await Promise.all(
          (['x', 'instagram'] as const).map((platform) =>
            command(bridge, { type: 'profileStatus', platform }),
          ),
        );
        setProfiles(
          results.flatMap((reply) =>
            reply.type === 'profileStatus' ? [reply.profile] : [],
          ),
        );
      }
      setStep((value) => value + 1);
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  async function profileAction(
    platform: DesktopPlatform,
    action: 'profileSetup' | 'profileAdopt' | 'profileForget',
  ) {
    setBusy(true);
    try {
      const reply =
        action === 'profileAdopt'
          ? await command(bridge, {
              type: 'profileAdopt',
              platform: 'instagram',
            })
          : action === 'profileSetup'
            ? await command(bridge, { type: 'profileSetup', platform, browser })
            : await command(bridge, { type: 'profileForget', platform });
      if ('profile' in reply)
        setProfiles((values) =>
          values.map((value) =>
            value.platform === platform ? reply.profile : value,
          ),
        );
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  async function importExport() {
    setBusy(true);
    try {
      const reply = await command(bridge, { type: 'importExport' });
      if (reply.type !== 'exportImported') return;
      if (reply.result.status === 'cancelled')
        setNotice(t('desktop.cancelled'));
      else {
        setNotice(
          t('desktop.imported', reply.result) +
            (reply.result.partial ? ` ${t('desktop.partial')}` : ''),
        );
        imported();
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-testid="desktop-setup">
      <div className={styles.panel}>
        {step === 0 && (
          <label className={styles.field}>
            {t('settings.language')}
            <select
              value={locale}
              onChange={(event) => changeLocale(event.target.value as Locale)}
            >
              <option value="en">{t('desktop.language.en')}</option>
              <option value="de">{t('desktop.language.de')}</option>
            </select>
          </label>
        )}
        {step === 1 && (
          <label className={styles.field}>
            {t('desktop.browser')}
            <select
              value={browser}
              disabled={!browsers.length}
              onChange={(event) =>
                changeBrowser(event.target.value as DesktopBrowser)
              }
            >
              {browsers.map((value) => (
                <option key={value} value={value}>
                  {t(browserMessages[value])}
                </option>
              ))}
            </select>
            {!browsers.length && <p>{t('desktop.token.BROWSER_NOT_FOUND')}</p>}
          </label>
        )}
        {step === 2 && (
          <>
            <h2>{t('desktop.profiles')}</h2>
            <p>{t('desktop.profileIntro')}</p>
            {profiles.map((profile) => (
              <section
                key={profile.platform}
                aria-label={t(
                  profile.platform === 'x' ? 'guide.x' : 'guide.instagram',
                )}
              >
                <h3>
                  {t(profile.platform === 'x' ? 'guide.x' : 'guide.instagram')}
                </h3>
                <p>
                  {t(
                    profile.inUse
                      ? 'desktop.profile.inUse'
                      : profile.ready
                        ? 'desktop.profile.ready'
                        : profile.exists
                          ? 'desktop.profile.incomplete'
                          : 'desktop.profile.missing',
                  )}
                </p>
                <div className={styles.actions}>
                  <button
                    disabled={busy || profile.inUse}
                    onClick={() => {
                      void profileAction(profile.platform, 'profileSetup');
                    }}
                  >
                    {t('desktop.profileSetup')}
                  </button>
                  {profile.platform === 'instagram' && profile.canAdopt && (
                    <button
                      disabled={busy || profile.inUse}
                      onClick={() => {
                        void profileAction('instagram', 'profileAdopt');
                      }}
                    >
                      {t('desktop.profileAdopt')}
                    </button>
                  )}
                  {profile.exists && (
                    <button
                      disabled={busy || profile.inUse}
                      onClick={() => {
                        void profileAction(profile.platform, 'profileForget');
                      }}
                    >
                      {t('desktop.profileForget')}
                    </button>
                  )}
                </div>
                <p>{t('desktop.profileSignOut')}</p>
              </section>
            ))}
          </>
        )}
        {step === 4 && (
          <>
            <h2>{t('nav.import')}</h2>
            <p>{t('desktop.importHint')}</p>
            {storeBuild !== null && (
              <p>
                {t(storeBuild ? 'desktop.storeNote' : 'desktop.directNote')}
              </p>
            )}
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => {
                void importExport();
              }}
            >
              {t('desktop.import')}
            </button>
          </>
        )}
        {step < 4 && (
          <div className={styles.actions}>
            {step > 0 && (
              <button
                disabled={busy}
                onClick={() => setStep((value) => value - 1)}
              >
                {t('desktop.back')}
              </button>
            )}
            <button
              disabled={
                busy ||
                (step === 1 && !browsers.length) ||
                profiles.some((profile) => profile.inUse)
              }
              onClick={() => {
                void advance();
              }}
            >
              {t('desktop.next')}
            </button>
          </div>
        )}
        <p role="status">{busy ? t('desktop.busy') : notice}</p>
      </div>
      {step === 3 && (
        <DesktopGuide bridge={bridge} locale={locale} failed={failed} />
      )}
    </section>
  );
}
