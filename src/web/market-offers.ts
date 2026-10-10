import type { OfferWithId } from '../shared/protocol';

// Discovery shortcuts only. Availability always comes from exact registry offers.
// IDs checked against the vendors' public model catalogs on 2026-10-10:
// https://platform.claude.com/docs/en/models/overview
// https://developers.openai.com/api/docs/models
// https://ai.google.dev/gemini-api/docs/models
// https://api-docs.deepseek.com/
// https://www.alibabacloud.com/help/en/model-studio/models
export const popularModels = [
  { id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'anthropic/claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'anthropic/claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'compatible/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
  { id: 'compatible/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'compatible/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
  { id: 'compatible/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'compatible/deepseek-flash', label: 'DeepSeek Flash' },
  { id: 'compatible/qwen3.8-max', label: 'Qwen 3.8 Max' },
  { id: 'compatible/qwen3.7-plus', label: 'Qwen 3.7 Plus' },
  { id: 'compatible/qwen3.8-flash', label: 'Qwen 3.8 Flash' },
];

/** Catalog entries never create offers or merge aliases, snapshots, or namespaces. */
export function consumerModels(offers: OfferWithId[], selectedModel = '') {
  const active = activeSupplierOffers(offers);
  const catalog = new Map(popularModels.map(m => [m.id, { ...m, group: 'Popular models' }]));
  for (const id of [...new Set([...active.map(o => o.model), ...(selectedModel ? [selectedModel] : [])])].sort()) {
    if (!catalog.has(id)) catalog.set(id, { id, label: id, group: 'More listed models' });
  }
  return [...catalog.values()].map(m => {
    const supplierCount = new Set(active.filter(o => o.model === m.id).map(o => o.provider.toLowerCase())).size;
    return { ...m, supplierCount, group: supplierCount ? 'Available models' : m.group };
  });
}

export function activeSupplierOffers(offers: OfferWithId[]) {
  return offers.filter(o => o.active && o.peer.active && (o.peer.roles & 1) !== 0);
}

/** Exact model matching never chooses a supplier or substitutes another model. */
export function matchingSupplierOffers(offers: OfferWithId[], model: string, sort: 'input' | 'output') {
  if (!model) return [];
  return activeSupplierOffers(offers).filter(o => o.model === model).sort((a, b) => {
    const left = sort === 'output' ? a.outputPrice : a.inputPrice;
    const right = sort === 'output' ? b.outputPrice : b.inputPrice;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
