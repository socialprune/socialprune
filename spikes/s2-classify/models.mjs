export const mlcLibraryRevision = '025bcaf3780fa8254f5e5efd3bfea0a5397248f4';
export const webModels = {
  'Qwen3-0.6B-q4f16_1-MLC': { repository: 'mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
    revision: '8c14ce481d4c692769976ad52afea453a102df19', library: 'Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm' },
  'Qwen3-1.7B-q4f16_1-MLC': { repository: 'mlc-ai/Qwen3-1.7B-q4f16_1-MLC',
    revision: '80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc', library: 'Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm' },
};
export const nliModel = { repository: 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7',
  revision: 'b5113eb38ab63efdd7f280f8c144ea8b13f978ce', dtype: 'q8', device: 'wasm', license: 'MIT' };
