import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Blocks, KeyRound, Link2, ArrowUpRight, LockKeyhole } from 'lucide-react';
import type { Address } from 'viem';
import { requireWallet } from '../../src/web/chain';
import { LocalAccountClient } from '../../src/web/account-client';
import {boundedOAuthDiagnostic} from '../../src/web/oauth-diagnostic';
import type { ApiKeyConnection, ConnectedAccount, ManagedProviderModelConfig } from '../../src/shared/accounts';

type ApiProvider = 'anthropic' | 'openai' | 'compatible';
type ConnectionTab = 'api-keys' | 'oauth';
const providerName = { anthropic: 'Claude', openai: 'OpenAI', compatible: 'Compatible API' };
const origin = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', compatible: '' };
const apiKind = { anthropic: 1, openai: 2, compatible: 3 };
const usable = (a: ConnectedAccount) => ['connected', 'expired', 'rate_limited', 'quota_limited'].includes(a.status);
const statusLabel: Record<ConnectedAccount['status'], string> = {
  connected: 'Connected · identity validated', expired: 'Session expired · refresh on use', refreshing: 'Refreshing session',
  reconnect_required: 'Reconnect required', permission_required: 'Usage permission required', signed_out: 'Signed out',
  rate_limited: 'Rate limited · try later', quota_limited: 'Plan quota limited', unavailable: 'Upstream unavailable', restricted: 'Account restricted',
};

export function Accounts({ active, wallet, chainId, onPrepareOffer, onAvailableConfigs }: { active: boolean; wallet?: Address; chainId?: number; onPrepareOffer: (config: ManagedProviderModelConfig) => void; onAvailableConfigs: (configs: ManagedProviderModelConfig[]) => void }) {
  const client = useRef(new LocalAccountClient());
  const epoch = useRef(0);
  const configCallback = useRef(onAvailableConfigs); configCallback.current = onAvailableConfigs;
  const operation = useRef(false);
  const usageEpoch = useRef(0);
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
  const addTrigger = useRef<HTMLButtonElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const personalHeading = useRef<HTMLHeadingElement>(null);
  const localWorkspace = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  const walletReady = localWorkspace && !!wallet && chainId === 10143;
  const current = accounts.find(a => a.credentialRef === selected);

  const clearUsage = () => { usageEpoch.current++; setSelected(''); setModels([]); setModel(''); setPrompt(''); setAnswer(undefined); };
  const clearManagement = () => { configCallback.current([]); setUnlocked(false); setAccounts([]); setCredentials([]); setPending(undefined); setRemoveRef(''); clearUsage(); };
  useEffect(() => {
    epoch.current++; operation.current = false; void client.current.lock(); clearManagement();
    setSecret(''); setAdding(undefined); setBusy(''); setError(''); setNotice('');
  }, [wallet, chainId]);
  useEffect(() => { if(!active) {usageEpoch.current++;setSecret('');setAdding(undefined);setPrompt('');setAnswer(undefined);setModel('');} }, [active]);
  useEffect(() => () => { epoch.current++; void client.current.lock(); }, []);
  useEffect(() => { if (adding) formHeading.current?.focus(); }, [adding]);
  const refresh = async () => {
    const generation = epoch.current;
    const [oauth, keys] = await Promise.all([client.current.status(), client.current.apiKeys()]);
    if (generation !== epoch.current) return;
    setAccounts(oauth.accounts); setCredentials(keys.credentials);
    configCallback.current(keys.credentials.flatMap(c => c.catalog ? c.catalog.models.map(m => m.providerModelConfig) : c.providerModelConfig ? [c.providerModelConfig] : []));
  };
  const unlock = async () => {
    const generation = epoch.current;
    if (client.current.isUnlocked()) return;
    if (!localWorkspace) throw new Error('Account management requires the local workspace at http://127.0.0.1:5174/.');
    if (!wallet) throw new Error('Connect the account-management wallet using the header.');
    const signer = await requireWallet(wallet);
    if (generation !== epoch.current) throw new Error('Wallet changed. Start the connection again.');
    await client.current.unlock(wallet, request => signer.signTypedData({ account: wallet, ...request }));
    if (generation !== epoch.current) {await client.current.lock();throw new Error('Wallet changed. Unlock again.');}
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
          const diagnostic=boundedOAuthDiagnostic(result.diagnostic); setPending(undefined); await refresh();
          if (generation === epoch.current) setNotice(result.status === 'connected' ? 'OpenAI identity validated. Load its available models for personal use.' : diagnostic ? `OpenAI consent rejected. Stage: ${diagnostic.stage}. Reason: ${diagnostic.reason}.` : 'Consent was rejected or expired. Check helper diagnostics before another attempt.');
        }
      }).catch(e => {
        if (!stopped && generation === epoch.current) { setPending(undefined); setError(e instanceof Error ? e.message : 'Connection check failed. Refresh account status.'); if (!client.current.isUnlocked()) clearManagement(); }
      }).finally(() => { running = false; });
    }, 1500);
    return () => { stopped = true; clearInterval(timer); };
  }, [pending, unlocked]);
  const connect = (ref?: string) => void act('Starting official OpenAI consent…', async () => {
    const popup = window.open('about:blank', '_blank');
    if (!popup) throw new Error('Allow a new tab, then choose Connect OpenAI / ChatGPT again.');
    popup.opener = null;
    try {
      const generation=epoch.current; await unlock(); if(generation!==epoch.current)throw new Error('Wallet changed. Start consent again.'); const result = await client.current.connect(ref);
      if(generation!==epoch.current)throw new Error('Wallet changed. Start consent again.');
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
      const generation=epoch.current; const key = secret; setSecret('');
      await unlock();
      if(generation!==epoch.current)throw new Error('Wallet changed. Enter the key again.');
      const result = await client.current.saveApiKey(provider === 'openai' ? {provider:'openai',baseUrl:'https://api.openai.com',apiKey:key,discoverModels:true} : { provider, model: publicModel.trim() || `${provider}/${upstreamModel.trim()}`, upstreamModel: upstreamModel.trim(), baseUrl: baseUrl.trim(), apiKey: key });
      if(generation!==epoch.current)return; await refresh(); if(generation!==epoch.current)return; finishAdd();
      setNotice(result.credential.catalog?.status === 'ready' ? 'Key saved once. Supported text models below come from OpenAI catalog metadata. No inference was run and no offers were published.' : result.credential.catalog?.status === 'failed' ? 'Key saved locally, but catalog discovery failed. Retry discovery below without entering the key again.' : 'API key saved locally. Access and model availability are unverified; no inference or billed validation was run.');
    });
  };
  const choose = (ref: string) => void act('Loading available OpenAI models…', async () => {
    const generation=epoch.current; clearUsage(); const request=usageEpoch.current; setSelected(ref);
    const result = await client.current.models(ref); if(generation!==epoch.current||request!==usageEpoch.current)return; setModels(result.models);
    setNotice(result.models.length ? 'Choose an exact model for personal use.' : 'OpenAI returned no available models. Check account permissions or reconnect.');
    await refresh(); if(generation===epoch.current&&request===usageEpoch.current)personalHeading.current?.focus();
  });
  const lock = () => void act('Locking account management…', async () => {
    const generation=epoch.current; await client.current.lock(); if(generation!==epoch.current)return; clearManagement(); setSecret(''); setAdding(undefined); setNotice('Account management locked. Saved credentials remain on the helper.');
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
    {!localWorkspace && <div className="local-only-notice" role="status"><strong>Connect accounts in your local workspace.</strong><p>API keys and personal OpenAI consent stay with the helper on your machine. Account management is unavailable on this hosted page.</p><a className="text-link" href="http://127.0.0.1:5174/">Open local workspace<ArrowUpRight size={14}/></a></div>}
    <div className="connection-tabs" role="tablist" aria-label="Connection method">
      {(['api-keys', 'oauth'] as const).map(tab => <button key={tab} id={`${tab}-connect-tab`} role="tab" aria-selected={connectionTab === tab} aria-controls={`${tab}-connect-panel`} tabIndex={connectionTab === tab ? 0 : -1} onClick={() => changeConnectionTab(tab)} onKeyDown={connectionTabKey}>
        {tab === 'api-keys' ? <KeyRound size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{tab === 'api-keys' ? 'API keys' : 'OAuth'}
      </button>)}
    </div>
    <div id="api-keys-connect-panel" role="tabpanel" aria-labelledby="api-keys-connect-tab" hidden={connectionTab !== 'api-keys'} tabIndex={0}>
      <p className="connection-intro">Connect a paid API account to supply models. Keys stay on your local machine.</p>
      <div className="connector-grid">
        {(['anthropic', 'openai'] as const).map(provider => <article className="connector-tile" key={provider}>
          <div className="connector-heading"><span className="connector-icon">{<span className={`provider-monogram ${provider}`}>{provider==='anthropic'?'A':'O'}</span>}</span><div><h2>{providerName[provider]}</h2><span>{'Paid API key'}</span></div></div>
          <p className="connector-description">{provider === 'anthropic' ? 'Connect your Anthropic Console key. Your node serves the exact Claude model you configure.' : 'Save one OpenAI API key. Discover its supported text models, then choose which offers to price and publish.'}</p>
          <div className="connector-footer"><span className="connector-status">{keyStatus(provider)}</span><button id={`add-${provider}-key`} className={`button${''}`} disabled={!!busy || !localWorkspace} onClick={e => startAdd(provider, e.currentTarget)}>{`Add ${providerName[provider]} API key`}</button></div>
        </article>)}
      </div>
      <details className="compatible-connector"><summary><Blocks size={17}/>Other compatible paid APIs<span>OpenAI-compatible Chat Completions</span></summary><p className="helper">Use an explicitly configured paid HTTPS endpoint. No local model or subscription resale.</p><button className="button secondary" disabled={!!busy || !localWorkspace} onClick={e=>startAdd('compatible',e.currentTarget)}>Add compatible API key<ArrowUpRight size={15}/></button></details>
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
          <div className="connector-footer"><span className="connector-status">Unavailable</span><div className="action-row"><button className="button secondary" disabled aria-describedby="claude-oauth-reason">Connect Claude</button><button className="text-button" disabled={!!busy || !localWorkspace} onClick={() => { changeConnectionTab('api-keys'); requestAnimationFrame(() => { const trigger = document.getElementById('add-anthropic-key'); if (trigger instanceof HTMLButtonElement) startAdd('anthropic', trigger); }); }}>Use Claude API key</button></div></div>
        </article>
      </div>
    </div>
    {localWorkspace && !walletReady && <p className="account-prerequisite">Connect the management wallet on Monad testnet to save keys or start consent. <span>Use “Connect wallet” in the header.</span></p>}
    {error && <div className="banner error" role="alert"><div><strong>Account needs attention</strong><span>{error} Check that the helper permits this exact origin: {location.origin}.</span></div></div>}
    {(busy || notice) && <div className="notice" role="status">{busy || notice}</div>}
    {pending && <div className="consent-pending"><p>Waiting for OpenAI consent. The attempt expires in five minutes.</p><button className="text-button" disabled={!!busy} onClick={lock}>Cancel connection & lock</button></div>}
    {adding && <form className="api-key-form" onSubmit={save}>
      <div className="panel-title"><h3 ref={formHeading} tabIndex={-1}>Add {providerName[adding]} API key</h3><button type="button" className="text-button" disabled={!!busy} onClick={finishAdd}>Cancel</button></div>
      <label className="field"><span>API key</span><input type="password" minLength={12} maxLength={8192} pattern="[!-~]{12,8192}" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} required disabled={!!busy} spellCheck={false} autoCapitalize="none" /><small>Sent to your wallet-authenticated local helper. Never stored in the browser or published on-chain.</small></label>
      {adding !== 'openai' && <><label className="field"><span>Exact upstream model ID</span><input maxLength={128} value={upstreamModel} onChange={e => setUpstreamModel(e.target.value)} placeholder="Model ID from your API account" required disabled={!!busy} spellCheck={false} /><small>You configure this model; saving a key does not verify access.</small></label>
      {adding === 'compatible' && <label className="field"><span>Paid API base URL</span><input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-paid-api.example" required disabled={!!busy} /><small>Your key and prompts will be sent to this endpoint only when you explicitly run your node.</small></label>}
      <details className="model-config"><summary>Advanced model naming</summary><label className="field"><span>Public marketplace model ID</span><input maxLength={128} value={publicModel} onChange={e => setPublicModel(e.target.value)} placeholder={`${adding}/${upstreamModel || '<exact-model-id>'}`} disabled={!!busy} spellCheck={false} /><small>Defaults to {adding}/ followed by the exact upstream ID. Must match your node configuration.</small></label></details></>}
      <button type="submit" className="button" disabled={!!busy || !walletReady || !secret.trim() || (adding !== 'openai' && !upstreamModel.trim())}>Save API key{adding === 'openai' ? ' & load models' : ''}</button><p className="helper">{adding === 'openai' ? 'This explicitly requests OpenAI catalog metadata. It does not run inference, check billing or publish offers.' : 'No billed validation call.'} A fresh helper asks you to sign initialization; an existing helper asks its owner to unlock.</p>
    </form>}
    <div className="account-heading"><h2><LockKeyhole size={17}/>Your saved accounts</h2><div className="action-row">
      <button className="text-button" disabled={!!busy || !walletReady} onClick={() => void act('Reading saved accounts…', async () => { await unlock(); await refresh(); })}>{unlocked ? 'Refresh status' : 'Unlock saved accounts'}</button>
      {unlocked && <button className="text-button" disabled={!!busy} onClick={lock}>Lock</button>}
    </div></div>
    {!unlocked ? <p className="account-empty">Sign to initialize a fresh helper or unlock with its existing owner wallet. Masked accounts and catalogs appear after authorization.</p> : <>
      {!credentials.length && !accounts.length && <p className="account-empty">No accounts saved. Add a Claude or OpenAI API key above to get started.</p>}
      <div className="account-list">
        {credentials.map(c => <article className="account-card" key={c.credentialRef}>
          <div className="account-card-title"><h3>{providerName[c.provider]} <span>API key</span></h3><span className="connection-state">Saved locally · unverified</span></div>
          <p className="helper">{c.credentialLabel} · paid API credits · access has not been tested</p>
          {c.catalog ? <section className="key-catalog" aria-label="OpenAI key model catalog">
            <div className="panel-title"><h4>Supported text models <span>{c.catalog.models.length}</span></h4><button className="text-button" disabled={!!busy} onClick={() => void act('Discovering OpenAI catalog metadata…', async () => {const generation=epoch.current; await client.current.discoverApiKey(c.credentialRef);if(generation!==epoch.current)return;await refresh();if(generation!==epoch.current)return;setNotice('Catalog refreshed. Model listing does not validate inference access or billing. No offers were published.');})}>Refresh catalog</button></div>
            <p className="helper">{c.catalog.status === 'ready' ? 'Catalog-visible · inference unverified. Access can change with project permissions and billing.' : c.catalog.status === 'failed' ? `Discovery failed (${c.catalog.error || 'unavailable'}). Key remains saved; retry without re-entering it.` : 'Catalog has not been requested. Refresh catalog to discover models.'}</p>
            {c.catalog.discoveredAt && <p className="helper">Discovered {new Date(c.catalog.discoveredAt * 1000).toLocaleString()}</p>}
            {c.catalog.status === 'ready' && !c.catalog.models.length && <p className="simple-empty">No supported text models returned. Nothing is selected or publishable from this catalog.</p>}
            <div className="catalog-models">{c.catalog.models.map(m => <div className="catalog-model" key={m.model}><div><strong className="model-id">{m.upstreamModel}</strong><small className="model-id">{m.model}</small></div><button className="button secondary" disabled={!!busy} onClick={() => onPrepareOffer(m.providerModelConfig)} aria-label={`Prepare offer for ${m.upstreamModel}`}>Price & prepare<ArrowUpRight size={14}/></button></div>)}</div>
            {!!c.catalog.unsupported.length && <details className="unsupported-models"><summary>Other catalog entries · {c.catalog.unsupported.length}</summary><p className="helper">These are not supported by this text marketplace adapter.</p><ul className="exact-model-list">{c.catalog.unsupported.map(m => <li key={m.id}><code>{m.id}</code><span>{m.reason.replaceAll('_',' ')}</span></li>)}</ul></details>}
            <details className="model-config"><summary>Node configuration for catalog models</summary><p className="helper">All entries share this one saved credential. Add the models you explicitly choose to <code>PROVIDER_MODELS_JSON</code> using the same protected <code>ACCOUNT_STATE_DIR</code> and owner wallet. No secret is included here.</p><pre>{JSON.stringify(c.catalog.models.map(m => m.providerModelConfig), null, 2)}</pre></details>
          </section> : c.model && c.providerModelConfig && <><dl className="account-models"><div><dt>Configured upstream model</dt><dd className="model-id">{c.upstreamModel}</dd></div><div><dt>Marketplace model ID</dt><dd className="model-id">{c.model}</dd></div></dl><button className="button secondary" disabled={!!busy} onClick={() => onPrepareOffer(c.providerModelConfig!)}>Prepare offer</button></>}
          {!c.catalog && c.provider === 'openai' && <div className="legacy-discovery"><p className="helper">This is an existing manual model binding. Discovering a catalog replaces manual aliases with exact openai/&lt;returned ID&gt; bindings.</p><button className="text-button" disabled={!!busy} onClick={() => void act('Discovering OpenAI catalog metadata…',async()=>{await client.current.discoverApiKey(c.credentialRef);await refresh();})}>Discover models with this key</button></div>}
          <button className="text-button" disabled={!!busy} onClick={() => setRemoveRef(c.credentialRef)}>Remove key</button>
          {removeRef === c.credentialRef && <div className="remove-confirm"><p>Remove this saved key? Nodes using its reference will need another key. Published offers remain listed until you pause them.</p><div className="action-row"><button className="button secondary" disabled={!!busy} onClick={() => void act('Removing saved key…', async () => { const generation=epoch.current; await client.current.removeApiKey(c.credentialRef);if(generation!==epoch.current)return; setRemoveRef(''); await refresh();if(generation!==epoch.current)return; setNotice('Key removed locally. Pause any affected offers below.'); })}>Confirm removal</button><button className="text-button" disabled={!!busy} onClick={() => setRemoveRef('')}>Keep key</button></div></div>}
          {c.providerModelConfig && !c.catalog && <details className="model-config"><summary>Node configuration & account reference</summary><p className="helper">Use the same <code>ACCOUNT_STATE_DIR</code> on helper and provider. The management wallet must match the provider-owner wallet. Select this account in <code>PROVIDER_MODELS_JSON</code>; then start or restart your node.</p><pre>{JSON.stringify(c.providerModelConfig, null, 2)}</pre><p className="helper">Endpoint: <span className="model-id">{c.baseUrl}</span>. The reference is local; publish only the model ID and prices. This config contains no API key.</p></details>}
        </article>)}
        {accounts.map(a => <article className="account-card" key={a.credentialRef}>
          <div className="account-card-title"><h3>OpenAI / ChatGPT <span>OAuth</span></h3><span className="connection-state">{statusLabel[a.status]}</span></div>
          <p className="helper">{a.accountLabel} · {a.workspaceLabel}</p><p className="helper">Personal local use · plan / credits allowed in your ChatGPT settings. No supplier resale.</p>
          {a.retryAt && <p className="helper">Retry after {new Date(a.retryAt * 1000).toLocaleString()}.</p>}
          <div className="action-row"><button className="button secondary" disabled={!!busy || !!pending || !usable(a)} onClick={() => choose(a.credentialRef)}>Load available models</button><button className="text-button" disabled={!!busy || !!pending} onClick={() => connect(a.credentialRef)}>Reconnect</button><button className="text-button" disabled={!!busy} onClick={() => void act('Disconnecting OpenAI account…', async () => { const generation=epoch.current; const result = await client.current.disconnect(a.credentialRef);if(generation!==epoch.current)return; if (selected === a.credentialRef) clearUsage(); await refresh();if(generation!==epoch.current)return; setNotice(result.remoteRevocationConfirmed ? 'Local tokens removed and remote session revoked.' : 'Local tokens removed. Remote revocation was not confirmed; remove app access in ChatGPT settings.'); })}>Disconnect</button></div>
          {selected === a.credentialRef && <><p className="helper">Available model IDs from OpenAI:</p><ul className="exact-model-list">{models.map(m => <li key={m.slug}><code>{m.slug}</code><span>{m.displayName}</span></li>)}</ul>{!models.length && <p className="helper">No available models returned. Check account permissions or reconnect.</p>}</>}
        </article>)}
      </div>
    </>}
    {current && <section className="personal-use"><h2 ref={personalHeading} tabIndex={-1}>Use your own ChatGPT account</h2><p className="section-description">Your local helper and OpenAI receive this content. This uses your personal plan / permitted credits, with no test MON payment. Private OAuth is unavailable.</p>
      <label className="field"><span>Exact available model</span><select disabled={!models.length || !!busy} value={model} onChange={e => { usageEpoch.current++; setModel(e.target.value); setAnswer(undefined); }}><option value="">Choose a model</option>{models.map(m => <option key={m.slug} value={m.slug}>{m.slug} · {m.displayName}</option>)}</select></label>
      <label className="field"><span>Prompt</span><textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!!busy} /><small>Kept in memory only. Your ChatGPT settings control plan and credit usage.</small></label>
      <label className="field"><span>Maximum output tokens</span><input type="number" min={1} max={8192} step={1} value={maximum} onChange={e => setMaximum(e.target.value)} disabled={!!busy} /></label>
      <button className="button" disabled={!!busy || !!pending || !usable(current) || !model || !prompt.trim()} onClick={() => void act('Using your personal ChatGPT plan…', async () => { const generation=epoch.current,request=usageEpoch.current; const max = Number(maximum); if (!Number.isSafeInteger(max) || max < 1 || max > 8192) throw new Error('Choose an output limit from 1 to 8192.'); setAnswer(undefined); try { const result = await client.current.infer(selected, model, prompt, max);if(generation!==epoch.current||request!==usageEpoch.current)return; setAnswer(result.result); setNotice('Response received from OpenAI. Usage is from its completed response.'); } finally { if(generation===epoch.current&&request===usageEpoch.current)await refresh(); } })}>Send using my ChatGPT plan</button>
      {answer && <><div className="response-text">{answer.text}</div><p className="helper">Upstream input: {answer.inputTokens.toLocaleString()} tokens · output: {answer.outputTokens.toLocaleString()} tokens. Remaining plan quota is unknown.</p></>}
      <a className="text-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT usage and app access</a>
    </section>}
    <details className="account-helper-setup"><summary>Local account helper setup</summary><p className="helper">This alternate frontend does not start or reconfigure your helper. Run <code>npm run accounts</code> from the project root. Set <code>ACCOUNT_ALLOWED_ORIGINS</code> to include <code>http://127.0.0.1:5174</code>. Keep the existing origin entries. On a fresh, empty helper, an explicit wallet signature pins its first account-management owner. Existing setups require their saved owner’s wallet.</p><p className="helper">Optionally preselect the owner with <code>ACCOUNT_OPERATOR_ADDRESS</code>. Use a protected <code>ACCOUNT_STATE_DIR</code>. Sessions last ten minutes, are bound to this exact origin, and stay only in memory.</p></details>
  </section>;
}
