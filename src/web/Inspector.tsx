import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Network, RefreshCw } from 'lucide-react';
import { formatEther, zeroAddress, zeroHash, type Hex } from 'viem';
import { publicClient, verifyContracts } from './chain';
import { escrowAbi, registryAbi } from '../shared/contracts';
import type { FundedRequest, Peer } from '../shared/protocol';
import { parseInspectorContext, validInspectorRequestId } from './inspector-context';

type Observation = {
  requestId: string; request: FundedRequest; model: string; peer: Peer; configHash: Hex;
  blockNumber: bigint; blockTime: bigint; keyHash?: Hex; privateSession?: Hex; privacyStarted?: boolean; chainPrivacyValid?: boolean;
};
const date = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString();

export function Inspector() {
  const [initial] = useState(() => parseInspectorContext(window.location.search));
  const { context } = initial;
  const [requestId, setRequestId] = useState(context.requestId || '');
  const [observation, setObservation] = useState<Observation>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initial.error || '');
  const generation = useRef(0);
  const inFlight = useRef(false);
  const configured = !!context.registry && !!context.escrow && !initial.error;

  const read = async (id: string) => {
    if (inFlight.current || !configured) return;
    if (!validInspectorRequestId(id)) { setError('Enter a positive funded request ID.'); return; }
    const turn = ++generation.current;
    inFlight.current = true; setLoading(true); setError(''); setObservation(undefined);
    try {
      await verifyContracts(context);
      // All reads share one observed block. No node recovery/content endpoint is called.
      const block = await publicClient.getBlock();
      if (block.number === null) throw new Error('No confirmed block is available. Retry the chain read.');
      const at = { blockNumber: block.number };
      const [request, configHash] = await Promise.all([
        publicClient.readContract({ address: context.escrow!, abi: escrowAbi, functionName: 'getRequest', args: [BigInt(id)], ...at }),
        publicClient.readContract({ address: context.escrow!, abi: escrowAbi, functionName: 'requestPrivacyConfig', args: [BigInt(id)], ...at }),
      ]);
      if (request.consumer === zeroAddress || request.provider === zeroAddress || request.deposit === 0n) throw new Error('No funded request with this ID exists in the configured escrow.');
      if (context.provider && request.provider.toLowerCase() !== context.provider.toLowerCase()) throw new Error('This request belongs to a different provider. Open its inspector from that request or provider.');
      const [offer, peer] = await Promise.all([
        publicClient.readContract({ address: context.registry!, abi: registryAbi, functionName: 'getOffer', args: [request.offerId], ...at }),
        publicClient.readContract({ address: context.registry!, abi: registryAbi, functionName: 'getPeer', args: [request.provider], ...at }),
      ]);
      if (offer.provider.toLowerCase() !== request.provider.toLowerCase()) throw new Error('The funded offer does not match this provider. No request observation is shown.');
      const observed: Observation = { requestId: id, request: { ...request, expiresAt: BigInt(request.expiresAt) }, configHash, model: offer.model, peer, blockNumber: block.number, blockTime: block.timestamp };
      if (configHash !== zeroHash) {
        const [keyHash, privateSession, privacyStarted, chainPrivacyValid] = await Promise.all([
          publicClient.readContract({ address: context.escrow!, abi: escrowAbi, functionName: 'requestEncryptionKeyHash', args: [BigInt(id)], ...at }),
          publicClient.readContract({ address: context.escrow!, abi: escrowAbi, functionName: 'requestPrivateSession', args: [BigInt(id)], ...at }),
          publicClient.readContract({ address: context.escrow!, abi: escrowAbi, functionName: 'privacyStarted', args: [BigInt(id)], ...at }),
          publicClient.readContract({ address: context.registry!, abi: registryAbi, functionName: 'isPrivacyVerified', args: [request.provider, configHash, context.escrow!], ...at }),
        ]);
        Object.assign(observed, { keyHash, privateSession, privacyStarted, chainPrivacyValid });
      }
      if (turn === generation.current) setObservation(observed);
    } catch (e) {
      // Avoid displaying raw RPC payloads or arbitrary upstream errors.
      if (turn === generation.current) setError(e instanceof Error && !('details' in e) ? e.message : 'Could not read the configured Monad testnet contracts. Check setup in the app, then retry.');
    } finally { if (turn === generation.current) { setLoading(false); inFlight.current = false; } }
  };
  useEffect(() => {
    if (context.requestId) void read(context.requestId);
    return () => { generation.current++; inFlight.current = false; };
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); void read(requestId.trim()); };

  return <div className="app inspector-app">
    <header className="topbar"><a className="brand" href="/" aria-label="LLM Providers home"><span className="brand-mark"><Network size={21} aria-hidden="true" /></span>LLM Providers</a><span className="network-label">Request inspector · Monad testnet 10143</span></header>
    <main><div className="page-heading"><div><h1>Provider request inspector</h1><p>Public chain metadata. Node activity and content are not connected to this view.</p></div><a className="text-link" href="/">Return to app</a></div>
      <section className="inspector-truth" aria-labelledby="content-boundary"><h2 id="content-boundary">Standard suppliers can access prompts and responses.</h2><p>The standard paid API node processes plaintext in both directions. Leaving content out of this inspector does not prevent the supplier from reading it. Hashes are integrity records, not proof of confidentiality.</p><p><strong>Private demo unavailable.</strong> No approved private configuration or live attested gateway is deployed. Matching hardware, Action and key evidence is missing. The upstream LLM would still receive plaintext in a future approved private flow.</p></section>
      <section className="inspector-observation" aria-labelledby="observation-heading"><div className="panel-title"><h2 id="observation-heading">Inspect a funded request</h2><span>Read only</span></div>
        {!configured ? <p className="inspector-empty">{initial.error || 'Contract setup is missing. Configure the registry and escrow in the app, then reopen this inspector.'}</p> : <form className="inspector-form" onSubmit={submit}><label className="field"><span>Request ID</span><input inputMode="numeric" pattern="[1-9][0-9]{0,76}" maxLength={77} value={requestId} onChange={e => { setRequestId(e.target.value); setObservation(undefined); setError(''); }} placeholder="ID from a funded request" required disabled={loading} /></label><button className="button secondary" type="submit" disabled={loading || !validInspectorRequestId(requestId.trim())}><RefreshCw size={15} aria-hidden="true" className={loading ? 'spin' : ''} />{loading ? 'Reading chain…' : observation ? 'Refresh chain record' : 'Read chain record'}</button></form>}
        {error && configured && <p className="inspector-error" role="alert">{error}</p>}
        {loading && <p role="status" className="helper">Reading public request metadata. No inference or wallet signature is requested.</p>}
        {!loading && !observation && configured && !error && <p className="inspector-empty">Enter a funded request ID. No request or serving event has been observed.</p>}
        {observation && <>
          <p className="inspector-checked" role="status">Contract linkage and chain 10143 checked. Observed at block {observation.blockNumber.toString()} · {date(observation.blockTime)}. This does not verify hardware, upstream models or metering.</p>
          <dl className="inspector-facts">
            <div><dt>Execution mode</dt><dd>{observation.configHash === zeroHash ? 'Standard · supplier can access content' : 'Privacy binding recorded · execution protection unverified'}</dd></div>
            <div><dt>Request</dt><dd>#{observation.requestId}</dd></div>
            <div><dt>Funding state at observed block</dt><dd>{observation.request.closed ? 'Closed on-chain · settlement/refund outcome not read' : observation.request.expiresAt <= observation.blockTime ? 'Open · deadline passed' : 'Open · funded'}</dd></div>
            <div><dt>Exact listed model</dt><dd className="model-id">{observation.model}</dd></div>
            <div><dt>Provider-owner wallet</dt><dd className="model-id">{observation.request.provider}</dd></div>
            <div><dt>Registered operator</dt><dd className="model-id">{observation.peer.operator}</dd></div>
            <div><dt>Consumer wallet</dt><dd className="model-id">{observation.request.consumer}</dd></div>
            <div><dt>Offer ID</dt><dd className="model-id">{observation.request.offerId}</dd></div>
            <div><dt>Funded prompt hash / commitment</dt><dd className="model-id">{observation.request.promptHash}</dd></div>
            <div><dt>Capped deposit</dt><dd>{formatEther(observation.request.deposit)} test MON</dd></div>
            <div><dt>Input / output test MON per 1M tokens</dt><dd>{formatEther(observation.request.inputPrice)} / {formatEther(observation.request.outputPrice)}</dd></div>
            <div><dt>Request deadline</dt><dd>{date(observation.request.expiresAt)}</dd></div>
          </dl>
          {observation.configHash !== zeroHash && <details className="inspector-binding"><summary>Recorded privacy bindings · not a live privacy demonstration</summary><dl className="inspector-facts"><div><dt>Configuration hash</dt><dd className="model-id">{observation.configHash}</dd></div><div><dt>Funded key fingerprint</dt><dd className="model-id">{observation.keyHash}</dd></div><div><dt>Recorded session hash</dt><dd className="model-id">{observation.privateSession}</dd></div><div><dt>Privacy acceptance recorded</dt><dd>{observation.privacyStarted ? 'Yes' : 'No'}</dd></div><div><dt>Registry validity predicate at observed block</dt><dd>{observation.chainPrivacyValid ? 'Returns true; independent hardware/key evidence not checked' : 'Returns false'}</dd></div></dl><p className="helper">These chain values do not establish a trusted runtime, confidential execution or a verified protected channel. This app has no approved private release.</p></details>}
        </>}
        <details className="inspector-binding"><summary>Public lookup context</summary><dl className="inspector-facts"><div><dt>Registry</dt><dd className="model-id">{context.registry || 'Not configured'}</dd></div><div><dt>Escrow</dt><dd className="model-id">{context.escrow || 'Not configured'}</dd></div><div><dt>Provider filter</dt><dd className="model-id">{context.provider || 'No provider selected'}</dd></div></dl><p className="helper">URL context is a lookup hint, not proof of registration or a request. No prompts, credentials, authorization tokens or response content are passed between tabs.</p></details>
      </section>
      <section className="inspector-telemetry" aria-labelledby="telemetry-heading"><h2 id="telemetry-heading">Node telemetry · not connected</h2><p>Serving activity, received payloads, response commitments and runtime evidence are unavailable. A funded chain record does not show whether a node is currently processing it.</p><p className="helper">Integration requires a provider-owner-authenticated metadata feed with request identity, explicit execution mode and independently verifiable evidence. The existing consumer recovery endpoint returns response content and is not used here. No node telemetry endpoint has been added.</p></section>
    </main><footer><span>Read-only provider inspection</span><a href="/" className="text-link">Open marketplace <ExternalLink size={12} aria-hidden="true" /></a></footer>
  </div>;
}
