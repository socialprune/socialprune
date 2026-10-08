declare module 'virtual:sp-build-info' {
  export const buildId: string;
  export const base: string;
  export const workerURLs: string[];
}

declare module 'virtual:sp-demo-archives' {
  export const archives: { name: string; bytes: Uint8Array<ArrayBuffer> }[];
}
declare module 'virtual:sp-demo-assessments' {
  export const bytes: Uint8Array<ArrayBuffer>;
}
