import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { formatEther, keccak256, parseEther, parseEventLogs, type Address } from 'viem';
import { escrowAbi } from '../shared/contracts';
import { confirmTransaction, publicClient, requireWallet } from './chain';

type Saved = { passId: string; secret: string; provider: Address; endpoint: string };
type Chain = { spent: bigint; deposit: bigint; expiresAt: bigint; closed: boolean };
const CEILING = 2n; // price ceilings are 2x the offer's current rates: room for small raises, a hard stop for big ones
const storeKey = (escrow: Address, account: Address) => `llm-providers:passes:${escrow.toLowerCase()}:${account.toLowerCase()}`;
const load = (k: string): Saved[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const secretHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const mon = (v: bigint) => formatEther(v);

/** Prepaid API keys: one deposit, then any OpenAI-compatible client calls the supplier with no per-request wallet approval. */
export function ApiKeys({ account, escrow, provider, endpoint, inputPrice, outputPrice, model, walletReady, busy, act, onChanged }: {
  account: Address; escrow: Address; provider: Address; endpoint: string; inputPrice: bigint; outputPrice: bigint; model: string;
  walletReady: boolean; busy: string; act: (label: string, task: () => Promise<void>) => Promise<void> | void; onChanged: () => Promise<void>;
}) {
  const key = storeKey(escrow, account);
  const [passes, setPasses] = useState<Saved[]>(() => load(key));
  const [chain, setChain] = useState<Record<string, Chain>>({});
  const [deposit, setDeposit] = useState('0.5');
  const [callCap, setCallCap] = useState('0.05');
  const [days, setDays] = useState('7');
  const [copied, setCopied] = useState('');
  useEffect(() => { setPasses(load(key)); }, [key]);
  const refresh = useCallback(async () => {
    const next: Record<string, Chain> = {};
    await Promise.all(load(key).map(async p => { try { const v = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'getPass', args: [BigInt(p.passId)] }); next[p.passId] = { spent: v.spent, deposit: v.deposit, expiresAt: BigInt(v.expiresAt), closed: v.closed }; } catch {} }));
    setChain(next);
  }, [key, escrow]);
  useEffect(() => { void refresh(); }, [refresh, passes.length]);
  const bearer = (p: Saved) => `pt_${p.passId}_${p.secret}`;
  const copy = async (id: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1500); };

  const create = () => void act('Creating prepaid API key', async () => {
    const wallet = await requireWallet(account);
    const value = parseEther(deposit), cap = parseEther(callCap), d = Number(days);
    if (value <= 0n || cap <= 0n || cap > value) throw new Error('Per-call cap must be above 0 and no more than the deposit.');
    if (!Number.isInteger(d) || d < 1 || d > 30) throw new Error('Choose 1 to 30 days.');
    const secret = secretHex(), block = await publicClient.getBlock();
    const hash = await wallet.writeContract({ account, address: escrow, abi: escrowAbi, functionName: 'openPass', args: [provider, keccak256(`0x${secret}`), inputPrice * CEILING, outputPrice * CEILING, cap, block.timestamp + BigInt(d * 86400)], value });
    const receipt = await confirmTransaction(hash);
    const opened = parseEventLogs({ abi: escrowAbi, eventName: 'PassOpened', logs: receipt.logs })[0];
    if (!opened) throw new Error('The pass was created but its ID was not found. Check the escrow on-chain.');
    const next = [...load(key), { passId: opened.args.passId.toString(), secret, provider, endpoint }];
    localStorage.setItem(key, JSON.stringify(next)); setPasses(next); await onChanged();
  });
  const close = (p: Saved) => void act('Closing key and refunding unspent deposit', async () => {
    const wallet = await requireWallet(account);
    await confirmTransaction(await wallet.writeContract({ account, address: escrow, abi: escrowAbi, functionName: 'closePass', args: [BigInt(p.passId)] }));
    await refresh(); await onChanged();
  });
  const forget = (p: Saved) => { const next = load(key).filter(x => x.passId !== p.passId); localStorage.setItem(key, JSON.stringify(next)); setPasses(next); };
  const mine = passes.filter(p => p.provider.toLowerCase() === provider.toLowerCase());

  return <section className="api-keys">
    <h3><KeyRound size={15} aria-hidden="true" /> Prepaid API key</h3>
    <p className="helper">Deposit once, then use this supplier from any OpenAI-compatible app. No wallet approval per request. The supplier meters tokens and can charge only at its listed rates (up to 2× today's) and up to your per-call cap.</p>
    <div className="form-row">
      <label className="field"><span>Deposit (test MON)</span><input type="number" min="0" step="any" value={deposit} onChange={e => setDeposit(e.target.value)} /></label>
      <label className="field"><span>Max per call</span><input type="number" min="0" step="any" value={callCap} onChange={e => setCallCap(e.target.value)} /></label>
    </div>
    <label className="field"><span>Valid for (days, 1–30)</span><input type="number" min="1" max="30" step="1" value={days} onChange={e => setDays(e.target.value)} /></label>
    <button type="button" className="button full" onClick={create} disabled={!!busy || !walletReady}>Create API key</button>
    {mine.map(p => {
      const c = chain[p.passId], live = c && !c.closed && c.expiresAt * 1000n > BigInt(Date.now());
      const base = `${p.endpoint.replace(/\/$/, '')}/v1`;
      return <div className="api-key" key={p.passId}>
        <div className="request-facts">
          <div><span>Key #{p.passId}</span><strong>{!c ? '…' : c.closed ? 'Closed' : live ? 'Active' : 'Expired'}</strong></div>
          {c && <div><span>Used / deposit</span><strong>{mon(c.spent)} / {mon(c.deposit)} test MON</strong></div>}
          {c && !c.closed && <div><span>Expires</span><strong>{new Date(Number(c.expiresAt) * 1000).toLocaleString()}</strong></div>}
        </div>
        {!c?.closed && <>
          <div className="key-row"><span>Base URL</span><code>{base}</code><button type="button" className="text-button" onClick={() => void copy(`u${p.passId}`, base)} aria-label="Copy base URL">{copied === `u${p.passId}` ? <Check size={13} /> : <Copy size={13} />}</button></div>
          <div className="key-row"><span>API key</span><code>{bearer(p).slice(0, 14)}…</code><button type="button" className="text-button" onClick={() => void copy(`k${p.passId}`, bearer(p))} aria-label="Copy API key">{copied === `k${p.passId}` ? <Check size={13} /> : <Copy size={13} />}</button></div>
          {(() => { const curl = `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer ${bearer(p)}" -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`; return <><pre className="key-snippet">{curl}</pre><button type="button" className="text-button" onClick={() => void copy(`c${p.passId}`, curl)}>{copied === `c${p.passId}` ? <Check size={13} /> : <Copy size={13} />} Copy curl command</button></>; })()}
          <p className="helper">Anyone with this key can spend the remaining deposit. Close it to revoke and refund the rest.{p.endpoint.startsWith('http://127.0.0.1') || p.endpoint.startsWith('http://localhost') ? ' This endpoint is local: use an HTTPS tunnel or a public supplier endpoint to call it from other machines.' : ''}</p>
          <button type="button" className="button secondary" onClick={() => close(p)} disabled={!!busy || !walletReady}>{live ? 'Close key & refund unspent' : 'Refund unspent'}</button>
        </>}
        {c?.closed && <button type="button" className="text-button" onClick={() => forget(p)}>Remove from list</button>}
      </div>;
    })}
  </section>;
}
