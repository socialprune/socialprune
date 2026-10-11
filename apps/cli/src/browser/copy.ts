export const BROWSER_WARNING = {
  en: "X's and Instagram's rules do not allow this kind of automation. They can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. Deleted posts and comments cannot be recovered. Neither the platform nor SocialPrune can bring them back. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.",
  de: 'Die Regeln von X und Instagram erlauben diese Art von Automatisierung nicht. Sie können dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Gelöschte Beiträge und Kommentare lassen sich nicht wiederherstellen. Weder die Plattform noch SocialPrune kann sie zurückholen. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.',
} as const;
export function profileWarning(handle: string): string {
  return `Signed in as @${handle}, a program can do anything the website can: post, like, follow, send messages, change settings and delete. It can also change this browser profile's cookies, site data, cache, history and settings. SocialPrune's code only does the steps listed for this run.`;
}
