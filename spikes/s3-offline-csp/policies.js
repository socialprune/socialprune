export const connections = {
  V1: "'none'",
  V2: "'self'",
  V3: "'self' https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://cas-bridge.xethub.hf.co https://us.aws.cdn.hf.co",
  V4: "'none'",
  V5: "'none'",
};

export function policy(variant) {
  const scripts = variant === 'V4' ? "'self' blob: 'wasm-unsafe-eval'" :
    variant === 'V5' ? "'self'" : "'self' 'wasm-unsafe-eval'";
  return `default-src 'none'; script-src ${scripts}; worker-src 'self'; connect-src ${connections[variant]}; style-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}
