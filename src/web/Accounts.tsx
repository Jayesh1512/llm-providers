import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Blocks, KeyRound, Link2 } from 'lucide-react';
import type { Address } from 'viem';
import { requireWallet } from './chain';
import { LocalAccountClient } from './account-client';
import { boundedOAuthDiagnostic } from './oauth-diagnostic';
import type { ApiKeyConnection, ConnectedAccount, ManagedProviderModelConfig, OAuthDiagnostic } from '../shared/accounts';

type ApiProvider = 'anthropic' | 'openai' | 'compatible';
type ConnectionTab = 'api-keys' | 'oauth';
const providerName = { anthropic: 'Claude', openai: 'OpenAI', compatible: 'Compatible API' };
const origin = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', compatible: '' };
const usable = (a: ConnectedAccount) => ['connected', 'expired', 'rate_limited', 'quota_limited'].includes(a.status);
const statusLabel: Record<ConnectedAccount['status'], string> = {
  connected: 'Connected · identity validated', expired: 'Session expired · refresh on use', refreshing: 'Refreshing session',
  reconnect_required: 'Reconnect required', permission_required: 'Usage permission required', signed_out: 'Signed out',
  rate_limited: 'Rate limited · try later', quota_limited: 'Plan quota limited', unavailable: 'Upstream unavailable', restricted: 'Account restricted',
};

const catalogErrors = {
  invalid_credentials: 'OpenAI rejected this key. Remove it and add a valid key.',
  forbidden: 'This key cannot read the model catalog. Check its OpenAI permissions, then retry.',
  rate_limited: 'OpenAI limited the catalog request. Wait, then retry.',
  unavailable: 'OpenAI’s catalog is unavailable. Retry without saving the key again.',
  invalid_catalog: 'OpenAI returned an unsupported catalog response. Retry later.',
};
function catalogNotice(c: ApiKeyConnection) {
  return c.catalog?.status === 'ready'
    ? `Key saved. ${c.catalog.models.length} supported text models returned by OpenAI. Inference access is unverified.`
    : 'Key saved locally. Model discovery did not complete; retry from the saved account below.';
}

function ApiKeyModels({ credential: c, busy, onPrepare, onDiscover }: {
  credential: ApiKeyConnection; busy: boolean;
  onPrepare: (config: ManagedProviderModelConfig) => void; onDiscover: () => void;
}) {
  const [selectedModel, setSelectedModel] = useState('');
  const modelLabelId = useId();
  const catalog = c.catalog;
  const available = catalog ? catalog.status === 'ready' ? catalog.models : [] : [];
  const selectedConfig = catalog
    ? available.find(m => m.model === selectedModel)?.providerModelConfig
    : c.providerModelConfig;
  useEffect(() => { setSelectedModel(''); }, [catalog]);
  return <div className="api-key-models">
    {catalog ? <>
      <div className="catalog-heading"><h4>Supported text models</h4><span>{catalog.status === 'ready' ? `${available.length} in catalog` : 'Catalog unavailable'}</span></div>
      <p className="helper">Returned by OpenAI for this key and supported by this app’s text adapter. Catalog visibility does not verify inference access or quota.</p>
      {catalog.discoveredAt && <p className="helper">Catalog checked {new Date(catalog.discoveredAt * 1000).toLocaleString()}.</p>}
      {catalog.status === 'failed' && <p className="warning-text" role="status">{catalog.error ? catalogErrors[catalog.error] : 'Discovery failed. Retry with the saved key.'}</p>}
      {available.length ? <label className="field"><span id={modelLabelId}>Model to offer</span><select aria-labelledby={modelLabelId} value={selectedModel} disabled={busy} onChange={e => setSelectedModel(e.target.value)}><option value="">Choose an exact model</option>{available.map(m => <option key={m.model} value={m.model}>{m.upstreamModel}</option>)}</select></label> : <p className="helper">{catalog.status === 'ready' ? 'No supported text models were returned. Check the excluded models below or retry discovery.' : 'No models ready to offer. Retry discovery; your key is already saved.'}</p>}
      {selectedConfig && <p className="helper">Marketplace ID: <code>{selectedConfig.model}</code></p>}
      {!!catalog.unsupported.length && <details className="model-config"><summary>{catalog.unsupported.length} excluded models</summary><p className="helper">These catalog entries cannot be offered through this app’s text adapter.</p><ul className="exact-model-list">{catalog.unsupported.map(m => <li key={m.id}><code>{m.id}</code><span>{m.reason === 'fine_tune' ? 'Fine-tuned model' : m.reason === 'non_text_or_specialized' ? 'Non-text or specialized model' : 'Unsupported by text adapter'}</span></li>)}</ul></details>}
    </> : c.model && c.upstreamModel && c.providerModelConfig ? <dl className="account-models"><div><dt>Configured upstream model</dt><dd className="model-id">{c.upstreamModel}</dd></div><div><dt>Marketplace model ID</dt><dd className="model-id">{c.model}</dd></div></dl> : <p className="helper">No model configuration available. {c.provider === 'openai' ? 'Load the catalog to choose a model.' : 'Remove this key and add a configured model.'}</p>}
    <div className="action-row"><button className="button secondary" disabled={busy || !selectedConfig} onClick={() => { if (selectedConfig) onPrepare(selectedConfig); }}>Prepare offer</button>{c.provider === 'openai' && <button className="text-button" disabled={busy} onClick={onDiscover}>{catalog?.status === 'ready' ? 'Refresh model catalog' : 'Load model catalog'}</button>}</div>
    {!catalog && c.provider === 'openai' && <p className="helper">Loading the catalog replaces this manual model binding. Existing aliases must match a returned exact model ID.</p>}
    {selectedConfig && <details className="model-config"><summary>Node configuration & account reference</summary><p className="helper">Use the same <code>ACCOUNT_STATE_DIR</code> on helper and provider. The management wallet must match the provider-owner wallet. Add this model entry to <code>PROVIDER_MODELS_JSON</code>, then start or restart the node. Multiple model entries reuse this one saved key.</p><pre>{JSON.stringify(selectedConfig, null, 2)}</pre><p className="helper">Endpoint: <span className="model-id">{c.baseUrl}</span>. Publish only the model ID and prices. This local config contains no API key.</p></details>}
  </div>;
}

export function Accounts({ wallet, chainId, onPrepareOffer, onInvalidateOffer }: { wallet?: Address; chainId?: number; onPrepareOffer: (model: string, kind: number, credentialRef: string) => void; onInvalidateOffer: (credentialRef?: string) => void }) {
  const client = useRef(new LocalAccountClient());
  const epoch = useRef(0);
  const operation = useRef(false);
  const [unlocked, setUnlocked] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [credentials, setCredentials] = useState<ApiKeyConnection[]>([]);
  const [connectionTab, setConnectionTab] = useState<ConnectionTab>('api-keys');
  const [adding, setAdding] = useState<ApiProvider>();
  const [secret, setSecret] = useState('');
  const [upstreamModel, setUpstreamModel] = useState('');
  const [publicModel, setPublicModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [removeRef, setRemoveRef] = useState('');
  const [selected, setSelected] = useState('');
  const [models, setModels] = useState<{ slug: string; displayName: string }[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [maximum, setMaximum] = useState('1024');
  const [answer, setAnswer] = useState<{ text: string; inputTokens: number; outputTokens: number }>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string>();
  const [oauthDiagnostic, setOAuthDiagnostic] = useState<OAuthDiagnostic>();
  const addTrigger = useRef<HTMLButtonElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const personalHeading = useRef<HTMLHeadingElement>(null);
  const walletReady = !!wallet && chainId === 10143;
  const current = accounts.find(a => a.credentialRef === selected);

  const clearUsage = () => { setSelected(''); setModels([]); setModel(''); setPrompt(''); setAnswer(undefined); };
  const clearManagement = () => { onInvalidateOffer(); setUnlocked(false); setAccounts([]); setCredentials([]); setPending(undefined); setOAuthDiagnostic(undefined); setRemoveRef(''); clearUsage(); };
  useEffect(() => {
    epoch.current++; operation.current = false; void client.current.lock(); clearManagement();
    setSecret(''); setAdding(undefined); setBusy(''); setError(''); setNotice('');
  }, [wallet, chainId]);
  useEffect(() => () => { epoch.current++; void client.current.lock(); }, []);
  useEffect(() => { if (adding) formHeading.current?.focus(); }, [adding]);
  const refresh = async () => {
    const generation = epoch.current;
    const [oauth, keys] = await Promise.all([client.current.status(), client.current.apiKeys()]);
    if (generation !== epoch.current) return;
    for (const previous of credentials) {
      const updated = keys.credentials.find(key => key.credentialRef === previous.credentialRef);
      if (!updated || JSON.stringify(updated.catalog ?? updated.providerModelConfig) !== JSON.stringify(previous.catalog ?? previous.providerModelConfig)) onInvalidateOffer(previous.credentialRef);
    }
    setAccounts(oauth.accounts); setCredentials(keys.credentials);
  };
  const unlock = async () => {
    const generation = epoch.current;
    if (client.current.isUnlocked()) return;
    if (!wallet) throw new Error('Connect the account-management wallet using the header.');
    const signer = await requireWallet(wallet);
    if (generation !== epoch.current) throw new Error('Wallet changed. Start the connection again.');
    await client.current.unlock(wallet, request => signer.signTypedData({ account: wallet, ...request }));
    setUnlocked(true);
  };
  const act = async (label: string, task: () => Promise<void>) => {
    if (operation.current) return;
    const generation = epoch.current; operation.current = true; setBusy(label); setError(''); setNotice('');
    try { await task(); }
    catch (e) {
      if (generation !== epoch.current) return;
      setError(e instanceof Error ? e.message : 'Account operation failed. Retry after checking the local helper.');
      if (!client.current.isUnlocked()) clearManagement();
    } finally { if (generation === epoch.current) { operation.current = false; setBusy(''); } }
  };
  useEffect(() => {
    if (!pending || !unlocked) return;
    let stopped = false, running = false; const generation = epoch.current;
    const timer = setInterval(() => {
      if (running || stopped) return;
      running = true;
      void client.current.attempt(pending).then(async result => {
        if (stopped || generation !== epoch.current) return;
        if (result.status !== 'pending') {
          setOAuthDiagnostic(result.status === 'rejected' ? boundedOAuthDiagnostic(result.diagnostic) : undefined);
          setPending(undefined); await refresh();
          if (generation === epoch.current) setNotice(result.status === 'connected' ? 'OpenAI identity validated. Load its available models for personal use.' : 'OpenAI connection rejected. No connected account was confirmed for this attempt.');
        }
      }).catch(e => {
        if (!stopped && generation === epoch.current) { setPending(undefined); setError(e instanceof Error ? e.message : 'Connection check failed. Refresh account status.'); if (!client.current.isUnlocked()) clearManagement(); }
      }).finally(() => { running = false; });
    }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [pending, unlocked]);
  const connect = (ref?: string) => void act('Starting official OpenAI consent…', async () => {
    setOAuthDiagnostic(undefined);
    const popup = window.open('about:blank', '_blank');
    if (!popup) throw new Error('Allow a new tab, then choose Connect OpenAI / ChatGPT again.');
    popup.opener = null;
    try {
      await unlock(); const result = await client.current.connect(ref);
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize' || url.searchParams.has('id_token_hint')) throw new Error('The helper returned an invalid consent destination.');
      popup.location.href = url.toString(); setPending(result.attemptId);
      setNotice('Finish vendor sign-in and permissions in the new tab. Waiting for consent…');
    } catch (e) { popup.close(); throw e; }
  });
  const startAdd = (provider: ApiProvider, trigger: HTMLButtonElement) => {
    addTrigger.current = trigger;
    setSecret(''); setUpstreamModel(''); setPublicModel(''); setBaseUrl(origin[provider]); setAdding(provider); setError(''); setNotice('');
    requestAnimationFrame(() => formHeading.current?.focus());
  };
  const finishAdd = () => { setAdding(undefined); setSecret(''); requestAnimationFrame(() => addTrigger.current?.focus()); };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    const provider = adding;
    void act('Saving API key on your local helper…', async () => {
      const key = secret; setSecret('');
      await unlock();
      const result = await client.current.saveApiKey(provider === 'openai' ? { provider, baseUrl: 'https://api.openai.com', apiKey: key, discoverModels: true } : { provider, model: publicModel.trim() || `${provider}/${upstreamModel.trim()}`, upstreamModel: upstreamModel.trim(), baseUrl: baseUrl.trim(), apiKey: key });
      setNotice(provider === 'openai' ? catalogNotice(result.credential) : 'API key saved locally. Access is unverified; no inference or billed validation was run.');
      await refresh(); finishAdd();

    });
  };
  const choose = (ref: string) => void act('Loading available OpenAI models…', async () => {
    clearUsage(); setSelected(ref);
    const result = await client.current.models(ref); setModels(result.models);
    setNotice(result.models.length ? 'Choose an exact model for personal use.' : 'OpenAI returned no available models. Check account permissions or reconnect.');
    await refresh(); personalHeading.current?.focus();
  });
  const lock = () => void act('Locking account management…', async () => {
    await client.current.lock(); clearManagement(); setSecret(''); setAdding(undefined); setNotice('Account management locked. Saved credentials remain on the helper.');
  });
  const changeConnectionTab = (tab: ConnectionTab) => {
    setConnectionTab(tab); setAdding(undefined); setSecret('');
  };
  const connectionTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'api-keys' : e.key === 'End' ? 'oauth' : connectionTab === 'api-keys' ? 'oauth' : 'api-keys';
    changeConnectionTab(next); document.getElementById(`${next}-connect-tab`)?.focus();
  };
  const keyStatus = (provider: ApiProvider) => {
    if (!unlocked) return 'Unlock to view saved keys';
    const count = credentials.filter(c => c.provider === provider).length;
    return count ? `${count} ${count === 1 ? 'key' : 'keys'} saved · unverified` : 'No keys saved';
  };
  const oauthStatus = !unlocked ? 'Unlock to view connections' : pending ? 'Waiting for consent' :
    accounts.some(a => a.status === 'connected') ? `${accounts.filter(a => a.status === 'connected').length} connected` :
    accounts.some(a => a.status !== 'signed_out') ? 'Connection needs attention' : 'No connections';

  return <section className="accounts-section" aria-label="Upstream accounts" aria-busy={!!busy}>
    <div className="connection-tabs" role="tablist" aria-label="Connection method">
      {(['api-keys', 'oauth'] as const).map(tab => <button key={tab} id={`${tab}-connect-tab`} role="tab" aria-selected={connectionTab === tab} aria-controls={`${tab}-connect-panel`} tabIndex={connectionTab === tab ? 0 : -1} onClick={() => changeConnectionTab(tab)} onKeyDown={connectionTabKey}>
        {tab === 'api-keys' ? <KeyRound size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{tab === 'api-keys' ? 'API keys' : 'OAuth'}
      </button>)}
    </div>
    <div id="api-keys-connect-panel" role="tabpanel" aria-labelledby="api-keys-connect-tab" hidden={connectionTab !== 'api-keys'} tabIndex={0}>
      <p className="connection-intro">Connect a paid API account to supply models. Keys stay on your local machine.</p>
      <div className="connector-grid">
        {(['anthropic', 'openai', 'compatible'] as const).map(provider => <article className="connector-tile" key={provider}>
          <div className="connector-heading"><span className="connector-icon">{provider === 'compatible' ? <Blocks size={23} aria-hidden="true" /> : <KeyRound size={23} aria-hidden="true" />}</span><div><h2>{providerName[provider]}</h2><span>{provider === 'compatible' ? 'Other paid APIs' : 'API key'}</span></div></div>
          <p className="connector-description">{provider === 'anthropic' ? 'Use your Anthropic Console key and configure an exact Claude model.' : provider === 'openai' ? 'Paste one OpenAI API key, then choose from its supported text models.' : 'Add a paid HTTPS endpoint that supports OpenAI-compatible Chat Completions.'}</p>
          <div className="connector-footer"><span className="connector-status">{keyStatus(provider)}</span><button id={`add-${provider}-key`} className={`button${provider === 'compatible' ? ' secondary' : ''}`} disabled={!!busy} onClick={e => startAdd(provider, e.currentTarget)}>{provider === 'compatible' ? 'Add compatible API key' : `Add ${providerName[provider]} API key`}</button></div>
        </article>)}
      </div>
    </div>
    <div id="oauth-connect-panel" role="tabpanel" aria-labelledby="oauth-connect-tab" hidden={connectionTab !== 'oauth'} tabIndex={0}>
      <p className="connection-intro">Connect through official sign-in. Personal plan usage stays separate from supplier offers.</p>
      <div className="connector-grid">
        <article className="connector-tile">
          <div className="connector-heading"><span className="connector-icon"><Link2 size={23} aria-hidden="true" /></span><div><h2>OpenAI / ChatGPT</h2><span>OAuth · personal use</span></div></div>
          <p className="connector-description">Opens OpenAI’s official consent flow. Personal local use only; subscription quota cannot supply marketplace offers.</p>
          <div className="connector-footer"><span className="connector-status">{oauthStatus}</span><button className="button" disabled={!!busy || !!pending || !walletReady} onClick={() => connect()}>Connect OpenAI / ChatGPT</button></div>
        </article>
        <article className="connector-tile">
          <div className="connector-heading"><span className="connector-icon"><Link2 size={23} aria-hidden="true" /></span><div><h2>Claude</h2><span>OAuth</span></div></div>
          <p className="connector-description" id="claude-oauth-reason">Claude OAuth is unavailable: no authorized third-party connection is available. Connect a Claude API key instead.</p>
          <div className="connector-footer"><span className="connector-status">Unavailable</span><div className="action-row"><button className="button secondary" disabled aria-describedby="claude-oauth-reason">Connect Claude</button><button className="text-button" disabled={!!busy} onClick={() => { changeConnectionTab('api-keys'); requestAnimationFrame(() => { const trigger = document.getElementById('add-anthropic-key'); if (trigger instanceof HTMLButtonElement) startAdd('anthropic', trigger); }); }}>Use Claude API key</button></div></div>
        </article>
      </div>
    </div>
    {!walletReady && <p className="account-prerequisite">Connect the management wallet on Monad testnet to save keys or start consent. <span>Use “Connect wallet” in the header.</span></p>}
    {error && <div className="banner error" role="alert"><div><strong>Account needs attention</strong><span>{error}</span></div></div>}
    {oauthDiagnostic && <div className="banner error" role="alert"><div><strong>OpenAI connection rejected</strong><span>Stage: <code>{oauthDiagnostic.stage}</code> · Reason: <code>{oauthDiagnostic.reason}</code></span></div></div>}
    {(busy || notice) && <div className="notice" role="status">{busy || notice}</div>}
    {pending && <div className="consent-pending"><p>Waiting for OpenAI consent. The attempt expires in five minutes.</p><button className="text-button" disabled={!!busy} onClick={lock}>Cancel connection & lock</button></div>}
    {adding && <form className="api-key-form" onSubmit={save}>
      <div className="panel-title"><h3 ref={formHeading} tabIndex={-1}>Add {providerName[adding]} API key</h3><button type="button" className="text-button" disabled={!!busy} onClick={finishAdd}>Cancel</button></div>
      <label className="field"><span>API key</span><input type="password" minLength={12} maxLength={8192} pattern="[!-~]{12,8192}" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} required disabled={!!busy} spellCheck={false} autoCapitalize="none" /><small>Sent to your wallet-authenticated local helper. Never stored in the browser or published on-chain.</small></label>
      {adding !== 'openai' && <label className="field"><span>Exact upstream model ID</span><input maxLength={128} value={upstreamModel} onChange={e => setUpstreamModel(e.target.value)} placeholder="Model ID from your API account" required disabled={!!busy} spellCheck={false} /><small>You configure this model; saving a key does not verify access.</small></label>}
      {adding === 'compatible' && <label className="field"><span>Paid API base URL</span><input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-paid-api.example" required disabled={!!busy} /><small>Your key and prompts will be sent to this endpoint only when you explicitly run your node.</small></label>}
      {adding !== 'openai' && <details className="model-config"><summary>Advanced model naming</summary><label className="field"><span>Public marketplace model ID</span><input maxLength={128} value={publicModel} onChange={e => setPublicModel(e.target.value)} placeholder={`${adding}/${upstreamModel || '<exact-model-id>'}`} disabled={!!busy} spellCheck={false} /><small>Defaults to {adding}/ followed by the exact upstream ID. Must match your node configuration.</small></label></details>}
      <button type="submit" className="button" disabled={!!busy || !walletReady || !secret.trim() || (adding !== 'openai' && !upstreamModel.trim())}>{adding === 'openai' ? 'Save key & load models' : 'Save API key'}</button><p className="helper">{adding === 'openai' ? 'Loads model metadata from OpenAI. No inference or billed validation call.' : 'No billed validation call.'} You may need to sign a wallet message to unlock management.</p>
    </form>}
    <div className="account-heading"><h2>Your upstream accounts</h2><div className="action-row">
      <button className="text-button" disabled={!!busy || !walletReady} onClick={() => void act('Reading saved accounts…', async () => { await unlock(); await refresh(); })}>{unlocked ? 'Refresh status' : 'Unlock saved accounts'}</button>
      {unlocked && <button className="text-button" disabled={!!busy} onClick={lock}>Lock</button>}
    </div></div>
    {!unlocked ? <p className="account-empty">Saved account details are locked. Unlock with the configured management wallet to view them.</p> : <>
      {!credentials.length && !accounts.length && <p className="account-empty">No accounts saved. Add a Claude or OpenAI API key above to get started.</p>}
      <div className="account-list">
        {credentials.map(c => <article className="account-card" key={c.credentialRef}>
          <div className="account-card-title"><h3>{providerName[c.provider]} <span>API key</span></h3><span className="connection-state">Saved locally · unverified</span></div>
          <p className="helper">{c.credentialLabel} · paid API credits · access has not been tested</p>
          <ApiKeyModels credential={c} busy={!!busy} onPrepare={config => onPrepareOffer(config.model, config.apiKind, c.credentialRef)} onDiscover={() => void act('Loading OpenAI model catalog…', async () => {
            onInvalidateOffer(c.credentialRef);
            const result = await client.current.discoverApiKey(c.credentialRef);
            setCredentials(list => list.map(key => key.credentialRef === c.credentialRef ? result.credential : key));
            setNotice(catalogNotice(result.credential));
          })}/>
          <button className="text-button" disabled={!!busy} onClick={() => setRemoveRef(c.credentialRef)}>Remove key</button>
          {removeRef === c.credentialRef && <div className="remove-confirm"><p>Remove this saved key? Nodes using its reference will need another key. Published offers remain listed until you pause them.</p><div className="action-row"><button className="button secondary" disabled={!!busy} onClick={() => void act('Removing saved key…', async () => { await client.current.removeApiKey(c.credentialRef); onInvalidateOffer(c.credentialRef); setRemoveRef(''); await refresh(); setNotice('Key removed locally. Pause any affected offers below.'); })}>Confirm removal</button><button className="text-button" disabled={!!busy} onClick={() => setRemoveRef('')}>Keep key</button></div></div>}
        </article>)}
        {accounts.map(a => <article className="account-card" key={a.credentialRef}>
          <div className="account-card-title"><h3>OpenAI / ChatGPT <span>OAuth</span></h3><span className="connection-state">{statusLabel[a.status]}</span></div>
          <p className="helper">{a.accountLabel} · {a.workspaceLabel}</p><p className="helper">Personal local use · plan / credits allowed in your ChatGPT settings. No supplier resale.</p>
          {a.retryAt && <p className="helper">Retry after {new Date(a.retryAt * 1000).toLocaleString()}.</p>}
          <div className="action-row"><button className="button secondary" disabled={!!busy || !!pending || !usable(a)} onClick={() => choose(a.credentialRef)}>Load available models</button><button className="text-button" disabled={!!busy || !!pending} onClick={() => connect(a.credentialRef)}>Reconnect</button><button className="text-button" disabled={!!busy} onClick={() => void act('Disconnecting OpenAI account…', async () => { const result = await client.current.disconnect(a.credentialRef); if (selected === a.credentialRef) clearUsage(); await refresh(); setNotice(result.remoteRevocationConfirmed ? 'Local tokens removed and remote session revoked.' : 'Local tokens removed. Remote revocation was not confirmed; remove app access in ChatGPT settings.'); })}>Disconnect</button></div>
          {selected === a.credentialRef && <><p className="helper">Available model IDs from OpenAI:</p><ul className="exact-model-list">{models.map(m => <li key={m.slug}><code>{m.slug}</code><span>{m.displayName}</span></li>)}</ul>{!models.length && <p className="helper">No available models returned. Check account permissions or reconnect.</p>}</>}
        </article>)}
      </div>
    </>}
    {current && <section className="personal-use"><h2 ref={personalHeading} tabIndex={-1}>Use your own ChatGPT account</h2><p className="section-description">Your local helper and OpenAI receive this content. This uses your personal plan / permitted credits, with no test MON payment. Private OAuth is unavailable.</p>
      <label className="field"><span>Exact available model</span><select disabled={!models.length || !!busy} value={model} onChange={e => { setModel(e.target.value); setAnswer(undefined); }}><option value="">Choose a model</option>{models.map(m => <option key={m.slug} value={m.slug}>{m.slug} · {m.displayName}</option>)}</select></label>
      <label className="field"><span>Prompt</span><textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!!busy} /><small>Kept in memory only. Your ChatGPT settings control plan and credit usage.</small></label>
      <label className="field"><span>Maximum output tokens</span><input type="number" min={1} max={8192} step={1} value={maximum} onChange={e => setMaximum(e.target.value)} disabled={!!busy} /></label>
      <button className="button" disabled={!!busy || !!pending || !usable(current) || !model || !prompt.trim()} onClick={() => void act('Using your personal ChatGPT plan…', async () => { const max = Number(maximum); if (!Number.isSafeInteger(max) || max < 1 || max > 8192) throw new Error('Choose an output limit from 1 to 8192.'); setAnswer(undefined); try { const result = await client.current.infer(selected, model, prompt, max); setAnswer(result.result); setNotice('Response received from OpenAI. Usage is from its completed response.'); } finally { await refresh(); } })}>Send using my ChatGPT plan</button>
      {answer && <><div className="response-text">{answer.text}</div><p className="helper">Upstream input: {answer.inputTokens.toLocaleString()} tokens · output: {answer.outputTokens.toLocaleString()} tokens. Remaining plan quota is unknown.</p></>}
      <a className="text-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage and app access</a>
    </section>}
    <details className="account-helper-setup"><summary>Local account helper setup</summary><p className="helper"><code>npm run dev</code> starts the local helper with this app. On a fresh, empty setup, an explicit wallet signature pins your connected wallet as the account-management owner. Existing setups require their saved owner’s wallet.</p><p className="helper">Optionally set <code>ACCOUNT_OPERATOR_ADDRESS</code> to preselect the owner. Use <code>ACCOUNT_STATE_DIR</code> for a protected local directory and <code>ACCOUNT_ALLOWED_ORIGINS</code> for this page’s exact loopback origin. You can also run the helper separately with <code>npm run accounts</code>. Management sessions last ten minutes and stay only in memory.</p></details>
  </section>;
}
