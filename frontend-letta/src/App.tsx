import { cloneElement, isValidElement, useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ExternalLink, Network, Plus, RefreshCw, Settings, ShieldCheck, Wallet, X } from 'lucide-react';
import { formatEther, getAddress, isAddress, parseEther, verifyTypedData, zeroAddress, type Address, type Hex } from 'viem';
import type { ManagedProviderModelConfig } from '../../src/shared/accounts';
import { registryAbi, escrowAbi } from '../../src/shared/contracts';
import { MONAD_TESTNET_ID, contentHash, escrowDomain, identityDomain, identityTypes, inferenceTypes, invoiceDomain, invoiceTypes, quoteCost, usageTypes, validatePeerEndpoint, type FundedRequest, type InferenceResult, type OfferWithId, type Peer } from '../../src/shared/protocol';
import { authenticateGateway, privateInference } from '../../src/privacy/client';
import { commitment, contextHash, privateInferenceTypes, randomHash, type PrivacyContext } from '../../src/privacy/protocol';
import { connectWallet, confirmTransaction, fundedId, loadAddresses, publicClient, readNetwork, requireWallet, saveAddresses, switchNetwork, verifyContracts, walletChainId, type Addresses } from '../../src/web/chain';
import { Intro } from './Intro';
import { Accounts } from './Accounts';
import { consumerModels, matchingSupplierOffers } from '../../src/web/market-offers';

type Tab = 'providers' | 'consumers';
type Session = { privacy?:{configHash:Hex;salt:Hex;offerId:Hex}; requestId:string; owner:Address; escrow:Address; registry:Address; provider:Address; endpoint:string; operator:Address; model:string; promptHash:Hex; maxOutputTokens:number; expiresAt:number; deposit:string; inputPrice:string; outputPrice:string; phase:'funded'|'running'|'received'|'approved'|'settled'|'refunded'; result?:InferenceResult; approval?:Hex; txHash?:Hex };
type PendingFunding = { hash:Hex; offerId:Hex; context:Omit<Session,'requestId'> };
const sessionKey = 'llm-providers:letta:request:10143';
const pendingFundingKey = 'llm-providers:letta:pending-funding:10143';
const explorer = 'https://testnet.monadexplorer.com';
const apiLabels: Record<number,string> = {1:'Anthropic Messages',2:'OpenAI Responses',3:'Compatible Chat'};
const short = (value:string) => `${value.slice(0,6)}…${value.slice(-4)}`;
const mon = (value:bigint | string) => formatEther(BigInt(value));
function errorText(error:unknown) { return error instanceof Error ? error.message : String(error); }
function loadSession(): Session | undefined { try { return JSON.parse(localStorage.getItem(sessionKey) || 'null') || undefined; } catch { return undefined; } }
function loadPendingFunding(): PendingFunding | undefined { try { return JSON.parse(localStorage.getItem(pendingFundingKey) || 'null') || undefined; } catch { return undefined; } }
function Button({children,onClick,disabled=false,secondary=false,type='button',className=''}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;secondary?:boolean;type?:'button'|'submit';className?:string}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`${secondary?'button secondary':'button'} ${className}`}>{children}</button>;
}
function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}) { return <label className="field"><span>{label}</span>{isValidElement(children)?cloneElement(children as React.ReactElement<{ 'aria-label'?: string }>,{'aria-label':label}):children}{hint&&<small>{hint}</small>}</label>; }
function Empty({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}) { return <div className="empty"><Network size={28} aria-hidden="true"/><h3>{title}</h3><p>{children}</p>{action}</div>; }
function AddressLink({address}:{address:string}) { return <a className="address" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address}>{short(address)}<ExternalLink size={12}/></a>; }


function SupplierDetails({provider,operator,endpoint}:{provider:Address;operator:Address;endpoint:string}) {
  return <details className="supplier-details"><summary>Supplier identity & endpoint</summary><dl><div><dt>Provider-owner wallet</dt><dd className="model-id">{provider}</dd></div><div><dt>Node operator</dt><dd className="model-id">{operator}</dd></div><div><dt>Endpoint</dt><dd className="endpoint">{endpoint}</dd></div></dl></details>;
}

async function peerFetch(endpoint:string,path:string,body?:unknown) {
  const base = validatePeerEndpoint(endpoint);
  const url = `${base.toString().replace(/\/$/,'')}${path}`;
  const response = await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?180_000:15_000)});
  let data: Record<string,unknown>;
  try { data = await response.json(); } catch { throw new Error(`The peer returned a non-JSON response (${response.status}). Check its endpoint and CORS configuration.`); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Peer request failed (${response.status}).`);
  return data;
}
async function authenticatePeer(endpoint:string,provider:Address,operator:Address,registry:Address) {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const challenge = `0x${Array.from(random,b=>b.toString(16).padStart(2,'0')).join('')}` as Hex;
  const proof = await peerFetch(endpoint,`/identity?challenge=${challenge}`);
  if (String(proof.provider).toLowerCase() !== provider.toLowerCase() || String(proof.operator).toLowerCase() !== operator.toLowerCase() || typeof proof.signature !== 'string') throw new Error('The endpoint identity does not match the registered provider and operator.');
  if (!await verifyTypedData({address:operator,domain:identityDomain(MONAD_TESTNET_ID,registry),types:identityTypes,primaryType:'PeerIdentity',message:{challenge,provider,registry},signature:proof.signature as Hex})) throw new Error('The peer identity signature is invalid.');
}

export default function App() {
  const operation = useRef(false);
  const walletGeneration = useRef(0);
  const [tab,setTab] = useState<Tab>('providers');
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [selectedModel,setSelectedModel] = useState('');
  const [providerSetupOpen,setProviderSetupOpen] = useState(false);
  const [accountOffer,setAccountOffer] = useState(false);
  const [preparedConfig,setPreparedConfig] = useState<ManagedProviderModelConfig>();
  const [account,setAccount] = useState<Address>();
  const [chainId,setChainId] = useState<number>();
  const [addresses,setAddresses] = useState<Addresses>(loadAddresses);
  const [verified,setVerified] = useState(false);
  const [peers,setPeers] = useState<{address:Address;peer:Peer}[]>([]);
  const [offers,setOffers] = useState<OfferWithId[]>([]);
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [lastTx,setLastTx] = useState<Hex>();
  const [sort,setSort] = useState<'input'|'output'>('input');
  const [selectedId,setSelectedId] = useState<Hex>();
  const [prompt,setPrompt] = useState('');
  const [privacyMode,setPrivacyMode] = useState(false);
  const [privacyConfigInput,setPrivacyConfigInput] = useState('');
  const [budget,setBudget] = useState('0.01');
  const [maxOutput,setMaxOutput] = useState('1024');
  const [session,setSession] = useState<Session | undefined>(loadSession);
  const [pendingFunding,setPendingFunding] = useState<PendingFunding | undefined>(loadPendingFunding);
  const [credit,setCredit] = useState(0n);
  const [currentRequest,setCurrentRequest] = useState<FundedRequest>();
  const [clock,setClock] = useState(Date.now());
  const roles='3';
  const [endpoint,setEndpoint] = useState('http://127.0.0.1:8787');
  const [operator,setOperator] = useState('0xD4A0D64240e211e3688031De2cCf4e653149312B');
  const [metadata,setMetadata] = useState('');
  const [apiKind,setApiKind] = useState('1');
  const [model,setModel] = useState('');
  const [inputPrice,setInputPrice] = useState('');
  const [outputPrice,setOutputPrice] = useState('');
  const [registryInput,setRegistryInput] = useState(addresses.registry || '');
  const [escrowInput,setEscrowInput] = useState(addresses.escrow || '');
  const ready = verified && !!addresses.registry && !!addresses.escrow;
  const walletReady = !!account && chainId === MONAD_TESTNET_ID;
  const mine = peers.find(p=>p.address.toLowerCase() === account?.toLowerCase())?.peer;
  const modelChoices = consumerModels(ready ? offers : [], selectedModel);
  const visible = matchingSupplierOffers(offers,selectedModel,sort);
  const selected = ready ? visible.find(o=>o.id===selectedId) : undefined;
  useEffect(()=>{if(selectedId&&(!ready||!visible.some(o=>o.id===selectedId)))setSelectedId(undefined);},[selectedId,ready,offers,selectedModel]);
  const ownSession = session && account?.toLowerCase() === session.owner.toLowerCase() && addresses.escrow?.toLowerCase() === session.escrow.toLowerCase();
  const sessionOpen = ownSession && !['settled','refunded'].includes(session.phase) && !currentRequest?.closed;
  const expired = !!session && clock/1000 >= session.expiresAt;

  const persistSession = (value:Session | undefined) => { setSession(value); if(value)localStorage.setItem(sessionKey,JSON.stringify(value.privacy ? {...value,result:undefined} : value));else localStorage.removeItem(sessionKey); };
  const persistPendingFunding = (value:PendingFunding | undefined) => {setPendingFunding(value);if(value)localStorage.setItem(pendingFundingKey,JSON.stringify(value));else localStorage.removeItem(pendingFundingKey);};
  const refresh = useCallback(async () => {
    if (!addresses.registry || !addresses.escrow) {setVerified(false);setPeers([]);setOffers([]);return;}
    setLoading(true);
    try { const data = await readNetwork(addresses);setPeers(data.peers);setOffers(data.offers);setVerified(true); }
    catch (err) {setVerified(false);setError(`Could not read the registry: ${errorText(err)}`);}
    finally {setLoading(false);}
  },[addresses]);
  const refreshCredit = useCallback(async()=>{
    if(!account||!addresses.escrow||!verified){setCredit(0n);return;}
    setCredit(await publicClient.readContract({address:addresses.escrow,abi:escrowAbi,functionName:'credits',args:[account]}));
    if(session&&session.escrow.toLowerCase()===addresses.escrow.toLowerCase()&&session.owner.toLowerCase()===account.toLowerCase()){
      const request=await publicClient.readContract({address:addresses.escrow,abi:escrowAbi,functionName:'getRequest',args:[BigInt(session.requestId)]});
      setCurrentRequest({...request,expiresAt:BigInt(request.expiresAt)});
    } else setCurrentRequest(undefined);
  },[account,addresses.escrow,verified,session]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{void refreshCredit().catch(err=>setError(errorText(err)));},[refreshCredit]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const provider=window.ethereum as (typeof window.ethereum & {on?:(event:string,listener:(value:unknown)=>void)=>void;removeListener?:(event:string,listener:(value:unknown)=>void)=>void});
    if(!provider)return;
    const accountsChanged=(value:unknown)=>{const list=value as Address[];setAccount(list[0]);setError('');};
    const chainChanged=(value:unknown)=>setChainId(Number(value));
    provider.request({method:'eth_accounts'}).then(accountsChanged).catch(()=>{});
    provider.request({method:'eth_chainId'}).then(chainChanged).catch(()=>{});
    provider.on?.('accountsChanged',accountsChanged);provider.on?.('chainChanged',chainChanged);
    return()=>{provider.removeListener?.('accountsChanged',accountsChanged);provider.removeListener?.('chainChanged',chainChanged);};
  },[]);
  useEffect(()=>{walletGeneration.current++;setPreparedConfig(undefined);setAccountOffer(false);setModel('');setInputPrice('');setOutputPrice('');setPrompt('');setSelectedModel('');setSelectedId(undefined);setNotice('');setError('');setCurrentRequest(undefined);setCredit(0n);},[account,chainId]);
  useEffect(()=>{if(mine){setEndpoint(mine.endpoint);setMetadata(mine.metadataURI);}},[mine]);
  const act = async (label:string,task:()=>Promise<void>) => {
    if(operation.current)return;operation.current=true;const generation=walletGeneration.current;setBusy(label);setError('');setNotice('');setLastTx(undefined);
    try{await task();}catch(err){if(generation===walletGeneration.current)setError(errorText(err));}finally{operation.current=false;setBusy('');}
  };
  const openSettings = () => {setSettingsOpen(true);requestAnimationFrame(()=>{const el=document.getElementById('network-settings');el?.scrollIntoView({block:'start'});el?.querySelector('summary')?.focus();});};
  const prepareOffer = (config:ManagedProviderModelConfig) => {setPreparedConfig(config);setModel(config.model);setApiKind(String(config.apiKind));setInputPrice('');setOutputPrice('');setAccountOffer(true);const disclosure=document.querySelector<HTMLDetailsElement>('.offer-disclosure');if(disclosure)disclosure.open=true;requestAnimationFrame(()=>{document.getElementById('publish-offer')?.scrollIntoView({block:'start'});document.getElementById('offer-input-price')?.focus();});};
  const write = async (kind:'registry'|'escrow',functionName:string,args:readonly unknown[]=[],value?:bigint) => {
    const wallet=await requireWallet(account);
    if(!ready)throw new Error('Verify your Monad testnet contracts in Advanced settings first.');
    const hash=await wallet.writeContract({account:account!,address:addresses[kind]!,abi:kind==='registry'?registryAbi:escrowAbi,functionName,args,value} as Parameters<typeof wallet.writeContract>[0]);
    setLastTx(hash);setNotice('Transaction submitted. Waiting for confirmation…');
    return confirmTransaction(hash);
  };
  const connect = ()=>void act('Connecting wallet',async()=>{setAccount(await connectWallet());setChainId(await walletChainId());});
  const switchChain = ()=>void act('Switching network',async()=>{await switchNetwork();setChainId(await walletChainId());setNotice('Wallet is on Monad testnet.');});
  const registerConsumer = ()=>void act('Registering consumer',async()=>{await write('registry','register',[mine?.roles ? mine.roles|2 : 2,mine?.operator||zeroAddress,mine?.endpoint||'',mine?.metadataURI||'']);await refresh();setNotice('Consumer registration confirmed.');});
  const registerProvider = ()=>void act('Saving peer registration',async()=>{
    const selectedRoles=Number(roles);
    if(selectedRoles&1){validatePeerEndpoint(endpoint);if(!isAddress(operator)||operator===zeroAddress)throw new Error('Enter the node operator wallet address from your provider configuration.');}
    await write('registry','register',[selectedRoles,(selectedRoles&1)?getAddress(operator):zeroAddress,(selectedRoles&1)?endpoint:'',metadata]);await refresh();setNotice('Peer registration confirmed on Monad testnet.');
  });
  const saveOffer = ()=>void act('Publishing model offer',async()=>{
    if(!model.trim()||!model.includes('/'))throw new Error('Enter a namespaced model identifier, such as anthropic/<exact-model-id>.');
    const input=parseEther(inputPrice),output=parseEther(outputPrice);if(input<=0n||output<=0n)throw new Error('Both input and output token prices must be greater than zero.');
    await write('registry','setOffer',[model.trim(),Number(apiKind),input,output,true]);await refresh();setNotice('Model offer published. Match this public model ID in your provider node configuration.');
  });
  const completeFunding = async (pending:PendingFunding) => {
    if(account?.toLowerCase()!==pending.context.owner.toLowerCase()||addresses.escrow?.toLowerCase()!==pending.context.escrow.toLowerCase())throw new Error('Reconnect the wallet and escrow that submitted this funding transaction.');
    setLastTx(pending.hash);
    const receipt=await publicClient.waitForTransactionReceipt({hash:pending.hash});
    if(receipt.status!=='success'){persistPendingFunding(undefined);throw new Error('Funding transaction reverted. No request was funded; you can try again.');}
    const requestId=fundedId(receipt.logs).toString();
    const recovery:Session={...pending.context,requestId,txHash:receipt.transactionHash};
    persistSession(recovery);
    const funded=await publicClient.readContract({address:pending.context.escrow,abi:escrowAbi,functionName:'getRequest',args:[BigInt(requestId)]});
    if(funded.consumer.toLowerCase()!==pending.context.owner.toLowerCase()||funded.provider.toLowerCase()!==pending.context.provider.toLowerCase()||funded.offerId!==pending.offerId||funded.promptHash!==pending.context.promptHash)throw new Error('The funded request does not match this selection. Its request ID has been saved for recovery; do not send the prompt.');
    const privacyBinding=await publicClient.readContract({address:pending.context.escrow,abi:escrowAbi,functionName:'requestPrivacyConfig',args:[BigInt(requestId)]});
    if(privacyBinding!==(pending.context.privacy?.configHash||`0x${'0'.repeat(64)}`))throw new Error('Funded privacy configuration mismatch. No prompt was sent.');
    persistSession({...recovery,expiresAt:Number(funded.expiresAt),deposit:funded.deposit.toString(),inputPrice:funded.inputPrice.toString(),outputPrice:funded.outputPrice.toString()});
    persistPendingFunding(undefined);
    setNotice(funded.inputPrice.toString()!==pending.context.inputPrice||funded.outputPrice.toString()!==pending.context.outputPrice?'Request funded at updated supplier prices. Review the snapshotted rates below before sending.':'Request funded. Review your prompt, then send it directly to the peer.');
  };
  const fund = ()=>void act('Verifying peer and funding request',async()=>{
    if(pendingFunding)throw new Error('Recover the submitted funding transaction before funding another request.');
    if(!selected||!account||!addresses.registry||!addresses.escrow)throw new Error('Select a provider and connect your wallet first.');
    if(!prompt.trim())throw new Error('Write a prompt first.');
    const output=Number(maxOutput);if(!Number.isSafeInteger(output)||output<1||output>32_768)throw new Error('Output limit must be an integer from 1 to 32,768 tokens.');
    const deposit=parseEther(budget);if(deposit<=0n)throw new Error('Enter a positive test MON budget.');
    const wallet=await requireWallet(account);await verifyContracts(addresses);if(!privacyMode)await authenticatePeer(selected.peer.endpoint,selected.provider,selected.peer.operator,addresses.registry);
    let privacy:Session['privacy'];
    if(privacyMode){
      const configHash=await publicClient.readContract({address:addresses.registry,abi:registryAbi,functionName:'privacyConfigHash',args:[selected.provider]});
      if(!await publicClient.readContract({address:addresses.registry,abi:registryAbi,functionName:'isPrivacyVerified',args:[selected.provider,configHash,addresses.escrow]}))throw new Error('No valid on-chain hardware/action/key attestation. Private funding is blocked.');
      if(output>8192)throw new Error('The Lit private action supports at most 8192 output tokens.');
      privacy={configHash,salt:randomHash(),offerId:selected.id};
    }
    const hash=privacy?commitment('prompt',prompt,privacy.salt,privacy.configHash):contentHash(prompt);
    if(privacy){
      const gateway=await authenticateGateway(selected.peer.endpoint,{version:1,chainId:10143,registry:addresses.registry,escrow:addresses.escrow,provider:selected.provider,operator:selected.peer.operator,consumer:account,offerId:selected.id,configHash:privacy.configHash,requestId:'0',promptHash:hash,maxOutputTokens:output,challenge:randomHash()});
      const verifiedKey=await publicClient.readContract({address:addresses.registry,abi:registryAbi,functionName:'privacyEncryptionKeyHash',args:[selected.provider,privacy.configHash,addresses.escrow]});
      if(verifiedKey!==gateway.enclaveKeyHash)throw new Error('The gateway key differs from its on-chain hardware binding. Private funding is blocked.');
    }
    const block=await publicClient.getBlock();const expiresAt=Number(block.timestamp)+1800;
    const transactionHash=privacy
      ?await wallet.writeContract({account,address:addresses.escrow,abi:escrowAbi,functionName:'fundPrivate',args:[selected.id,hash,BigInt(expiresAt),privacy.configHash],value:deposit})
      :await wallet.writeContract({account,address:addresses.escrow,abi:escrowAbi,functionName:'fund',args:[selected.id,hash,BigInt(expiresAt)],value:deposit});
    const pending:PendingFunding={hash:transactionHash,offerId:selected.id,context:{privacy,owner:account,registry:addresses.registry,escrow:addresses.escrow,provider:selected.provider,endpoint:selected.peer.endpoint,operator:selected.peer.operator,model:selected.model,promptHash:hash,maxOutputTokens:output,expiresAt,deposit:deposit.toString(),inputPrice:selected.inputPrice.toString(),outputPrice:selected.outputPrice.toString(),phase:'funded'}};
    persistPendingFunding(pending);setNotice('Funding submitted. Waiting for confirmation…');
    await completeFunding(pending);
  });
  const infer = ()=>void act('Requesting inference from peer',async()=>{
    if(!session||!ownSession||!account)throw new Error('Connect the wallet that funded this request.');
    if((session.privacy?commitment('prompt',prompt,session.privacy.salt,session.privacy.configHash):contentHash(prompt))!==session.promptHash)throw new Error('Enter the original funded prompt. Prompts are not saved in this browser.');
    if(expired)throw new Error('This request expired. Recover its deposit below.');
    const wallet=await requireWallet(account);
    const funded=await publicClient.readContract({address:session.escrow,abi:escrowAbi,functionName:'getRequest',args:[BigInt(session.requestId)]});
    if(funded.closed||funded.consumer.toLowerCase()!==account.toLowerCase()||funded.provider.toLowerCase()!==session.provider.toLowerCase()||funded.promptHash!==session.promptHash)throw new Error('The on-chain request is closed or does not match this wallet and prompt. Refresh its status before continuing.');
    const boundPrivacy=await publicClient.readContract({address:session.escrow,abi:escrowAbi,functionName:'requestPrivacyConfig',args:[BigInt(session.requestId)]});
    if(boundPrivacy!==(session.privacy?.configHash||`0x${'0'.repeat(64)}`))throw new Error('Request privacy binding mismatch. No prompt was sent.');
    const priced={...session,deposit:funded.deposit.toString(),inputPrice:funded.inputPrice.toString(),outputPrice:funded.outputPrice.toString(),expiresAt:Number(funded.expiresAt)};
    const peer=await publicClient.readContract({address:session.registry,abi:registryAbi,functionName:'getPeer',args:[session.provider]});
    if(!peer.active||(peer.roles&1)===0)throw new Error('This provider is no longer active. Recover the deposit after expiry.');
    if(!session.privacy)await authenticatePeer(peer.endpoint,session.provider,peer.operator,session.registry);
    const context:Omit<PrivacyContext,'responseKeyHash'|'issuedAt'>|undefined=session.privacy?{version:1,chainId:10143,registry:session.registry,escrow:session.escrow,provider:session.provider,operator:peer.operator,consumer:account,offerId:session.privacy.offerId,configHash:session.privacy.configHash,requestId:session.requestId,promptHash:session.promptHash,maxOutputTokens:session.maxOutputTokens,challenge:randomHash()}:undefined;
    const gateway=context?await authenticateGateway(peer.endpoint,context):undefined;
    if(gateway){
      const pinnedKey=await publicClient.readContract({address:session.escrow,abi:escrowAbi,functionName:'requestEncryptionKeyHash',args:[BigInt(session.requestId)]});
      if(pinnedKey!==gateway.enclaveKeyHash)throw new Error('The verified gateway key differs from the funded request. No prompt was sent.');
    }
    const message={requestId:BigInt(session.requestId),promptHash:session.promptHash,maxOutputTokens:BigInt(session.maxOutputTokens)};
    const signature=context
      ?await wallet.signTypedData({account,domain:escrowDomain(MONAD_TESTNET_ID,session.escrow),types:privateInferenceTypes,primaryType:'PrivateInferenceRequest',message:{...message,contextHash:contextHash(gateway!.context),enclaveKeyHash:gateway!.enclaveKeyHash}})
      :await wallet.signTypedData({account,domain:escrowDomain(MONAD_TESTNET_ID,session.escrow),types:inferenceTypes,primaryType:'InferenceRequest',message});
    const pending={...priced,endpoint:peer.endpoint,operator:peer.operator,phase:'running' as const};persistSession(pending);
    const result=gateway&&session.privacy
      ?await privateInference(peer.endpoint,gateway,prompt,session.privacy.salt,signature)
      :await peerFetch(peer.endpoint,'/infer',{requestId:session.requestId,prompt,maxOutputTokens:session.maxOutputTokens,signature}) as unknown as InferenceResult;
    const expectedResponseHash=session.privacy?commitment('response',result.text,result.responseSalt!,session.privacy.configHash):contentHash(result.text);
    if(result.requestId!==session.requestId||typeof result.text!=='string'||!Number.isSafeInteger(result.inputTokens)||result.inputTokens<0||!Number.isSafeInteger(result.outputTokens)||result.outputTokens<0||result.outputTokens>session.maxOutputTokens||result.responseHash!==expectedResponseHash||String(result.provider).toLowerCase()!==session.provider.toLowerCase()||String(result.operator).toLowerCase()!==peer.operator.toLowerCase())throw new Error('The peer returned an invalid response or usage receipt. No payment has been approved.');
    const cost=quoteCost(BigInt(result.inputTokens),BigInt(result.outputTokens),funded.inputPrice,funded.outputPrice);
    if(cost<=0n||cost>funded.deposit||String(result.amountWei)!==cost.toString())throw new Error('The invoice does not match the funded token prices or exceeds the deposit. No payment has been approved.');
    if(!await verifyTypedData({address:peer.operator,domain:invoiceDomain(MONAD_TESTNET_ID,session.escrow),types:invoiceTypes,primaryType:'Invoice',message:{requestId:BigInt(session.requestId),responseHash:result.responseHash,inputTokens:BigInt(result.inputTokens),outputTokens:BigInt(result.outputTokens),amountWei:cost},signature:result.signature}))throw new Error('The provider invoice signature is invalid. No payment has been approved.');
    persistSession({...pending,phase:'received',result});setNotice('Response received. Operator signature, response hash, and token charge verified. Review it before approving payment.');
  });
  const settle = ()=>void act('Approving and settling usage',async()=>{
    if(!session?.result||!ownSession||!account)throw new Error('No verified invoice is available for this wallet.');
    if(expired)throw new Error('The request expired before settlement. Recover its deposit.');
    const wallet=await requireWallet(account);const result=session.result;
    const signature=session.approval||await wallet.signTypedData({account,domain:escrowDomain(MONAD_TESTNET_ID,session.escrow),types:usageTypes,primaryType:'UsageReceipt',message:{requestId:BigInt(session.requestId),inputTokens:BigInt(result.inputTokens),outputTokens:BigInt(result.outputTokens),responseHash:result.responseHash}});
    const approved={...session,approval:signature,phase:'approved' as const};persistSession(approved);
    if(session.privacy){
      const receipt=await write('escrow','settle',[BigInt(session.requestId),BigInt(result.inputTokens),BigInt(result.outputTokens),result.responseHash,signature]);
      persistSession({...approved,phase:'settled',txHash:receipt.transactionHash});setNotice('Private usage settled. Unused budget is withdrawable.');return;
    }
    const response=await peerFetch(session.endpoint,'/settle',{requestId:session.requestId,inputTokens:result.inputTokens,outputTokens:result.outputTokens,responseHash:result.responseHash,signature});
    const transactionHash=(response.txHash||response.transactionHash) as Hex;
    if(typeof transactionHash!=='string'||!/^0x[\da-f]{64}$/i.test(transactionHash))throw new Error('The peer did not return a valid settlement transaction hash. Check the request state before retrying.');
    setLastTx(transactionHash);await confirmTransaction(transactionHash);
    const request=await publicClient.readContract({address:session.escrow,abi:escrowAbi,functionName:'getRequest',args:[BigInt(session.requestId)]});
    if(!request.closed)throw new Error('The transaction confirmed but this request remains open. Check its events before retrying.');
    persistSession({...approved,phase:'settled',txHash:transactionHash});setNotice('Usage settled. Your unused deposit is available to withdraw.');
  });
  const directSettle = ()=>void act('Settling signed receipt directly',async()=>{
    if(!session?.result||!session.approval||!ownSession)throw new Error('Approve the verified usage receipt first.');
    const result=session.result;const receipt=await write('escrow','settle',[BigInt(session.requestId),BigInt(result.inputTokens),BigInt(result.outputTokens),result.responseHash,session.approval]);
    persistSession({...session,phase:'settled',txHash:receipt.transactionHash});setNotice('Receipt settled directly. The provider has been credited.');
  });
  const refund = ()=>void act('Recovering expired deposit',async()=>{
    if(!session||!ownSession)throw new Error('Connect the request consumer wallet.');
    await write('escrow','refundExpired',[BigInt(session.requestId)]);persistSession({...session,phase:'refunded'});setNotice('Expired deposit credited to your wallet. Withdraw it below.');
  });
  const withdraw = ()=>void act('Withdrawing test MON credit',async()=>{await write('escrow','withdraw');await refreshCredit();setNotice('Test MON credit withdrawn to your wallet.');});

  return <div className="app">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <div className="intro-surface">
    <header className="topbar"><a className="brand" href="/" aria-label="LLM Providers home"><span className="brand-mark"><Network size={22}/></span>LLM Providers</a><div className="wallet-area">{account?<Button secondary onClick={()=>void act('Refreshing wallet',async()=>{setAccount(await connectWallet());setChainId(await walletChainId());})} disabled={!!busy}><Wallet size={15}/>{short(account)}</Button>:<Button secondary onClick={connect} disabled={!!busy}><Wallet size={16}/>Connect wallet</Button>}<button className="settings-trigger" onClick={openSettings} aria-label="Open advanced settings"><Settings size={18}/></button></div></header>
    <Intro />
    </div>
    <div className="workspace" id="workspace">
    <div className="window-bar"><span className="window-mark"><Network size={14}/>Peer workspace</span><span className="network-label"><span className="status-dot muted-dot"/>Monad testnet<span className="chain-number">10143</span></span></div>
    <nav className="tabs" role="tablist" aria-label="Main navigation">{(['providers','consumers'] as const).map(value=><button key={value} id={`${value}-tab`} role="tab" aria-selected={tab===value} aria-controls={`${value}-panel`} tabIndex={tab===value?0:-1} className={tab===value?'active':''} onClick={()=>setTab(value)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'providers':e.key==='End'?'consumers':value==='providers'?'consumers':'providers';setTab(next);document.getElementById(`${next}-tab`)?.focus();}}>{value==='providers'?'Providers':'Consumers'}</button>)}<span className="testnet-note">Paid APIs · explicit approvals</span></nav>
    <main aria-busy={!!busy}>
      {account&&chainId!==MONAD_TESTNET_ID&&<div className="banner warning"><div><strong>Switch to Monad testnet</strong><span>Your wallet must use chain 10143 for all registrations and payments.</span></div><Button secondary onClick={switchChain} disabled={!!busy}>Switch network</Button></div>}
      {error&&<div className="banner error" role="alert"><div><strong>Action needs attention</strong><span>{error}</span></div><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={18}/></button></div>}
      {(busy||notice)&&<div className="notice" role="status"><span>{busy&&<span className="pending-dot"/>}{busy||notice}{busy&&notice&&<small>{notice}</small>}</span>{lastTx&&<a href={`${explorer}/tx/${lastTx}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13}/></a>}</div>}
      <section id="consumers-panel" role="tabpanel" aria-labelledby="consumers-tab" hidden={tab!=='consumers'} tabIndex={0}>
      {tab==='consumers'&&<>
        <div className="page-heading"><div><h2 className="surface-title">Your model. Your provider.</h2><p>Choose a model, choose its provider, then write your prompt.</p></div><Button secondary disabled={loading||!!busy||!addresses.registry||!addresses.escrow} onClick={()=>void refresh()}><RefreshCw size={15} className={loading?'spin':''}/>{loading?'Refreshing…':'Refresh providers'}</Button></div>
        <div className="consumer-layout"><section className="consumer-picker" aria-label="Choose model and provider">
          <div className="consumer-selectors">
            <label className="field model-choice"><span>Model</span><select value={selectedModel} disabled={!!sessionOpen||!!pendingFunding} onChange={e=>{setSelectedModel(e.target.value);setSelectedId(undefined);}}><option value="">Choose a model</option>{['Available models','Popular models','More listed models'].map(group=>modelChoices.some(m=>m.group===group)&&<optgroup label={group} key={group}>{modelChoices.filter(m=>m.group===group).map(m=><option key={m.id} value={m.id}>{m.label} · {!ready?'availability unchecked':m.supplierCount?`${m.supplierCount} ${m.supplierCount===1?'provider':'providers'}`:'no providers'}</option>)}</optgroup>)}</select><small>{selectedModel?<><span>Exact marketplace model: </span><code className="model-id">{selectedModel}</code></>:'Popular models and every model listed by active suppliers.'}</small></label>
            <label className="field provider-choice"><span>Provider</span><select value={selected?.id||''} disabled={!ready||!selectedModel||!visible.length||!!sessionOpen||!!pendingFunding} onChange={e=>setSelectedId(e.target.value ? e.target.value as Hex : undefined)}><option value="">{!selectedModel?'Choose a model first':!ready?'Provider availability unchecked':!visible.length?'No providers for this model':'Choose a provider'}</option>{ready&&visible.map(o=><option key={o.id} value={o.id}>{short(o.provider)} · input {mon(o.inputPrice)} / output {mon(o.outputPrice)}</option>)}</select><small>Rates in test MON per 1M tokens. You choose who receives your prompt.</small></label>
          </div>
          <p className="provider-discovery-state" role="status">{loading?'Refreshing registered providers…':!ready?'Connect this app to a verified registry to check provider availability.':!selectedModel?'Choose a model to see its providers.':!visible.length?'No registered provider currently lists this exact model. Choose another model or refresh providers.':`${visible.length} matching ${visible.length===1?'offer':'offers'}. Reachability is checked before funding.`}</p>
          {!addresses.registry||!addresses.escrow?<div className="consumer-setup"><p>Set up the Monad testnet registry and escrow to use marketplace providers.</p><Button secondary onClick={openSettings}>Set up network <ArrowRight size={15}/></Button></div>:!verified&&!loading?<div className="consumer-setup"><p>Provider discovery is unavailable. Check Advanced settings or retry.</p><Button secondary onClick={()=>void refresh()}>Retry provider discovery</Button></div>:ready&&visible.length>0&&<details className="supplier-comparison"><summary>Compare all provider rates <span>{visible.length} offers</span></summary>
            <div className="comparison-toolbar"><p>Test MON per 1M tokens</p><label className="sort"><span className="sr-only">Sort matching suppliers</span><select value={sort} onChange={e=>setSort(e.target.value as 'input'|'output')}><option value="input">Lowest input price</option><option value="output">Lowest output price</option></select><ChevronDown size={14}/></label></div>
            <div className="table-scroll" role="region" aria-label="Supplier price comparison" tabIndex={0}><table><thead><tr><th>Provider</th><th>API</th><th className="numeric">Input</th><th className="numeric">Output</th><th><span className="sr-only">Select peer</span></th></tr></thead><tbody>{visible.map(offer=><tr key={offer.id} className={selectedId===offer.id?'selected':''}><td><AddressLink address={offer.provider}/></td><td>{apiLabels[offer.apiKind]||'Unknown API'}</td><td className="numeric">{mon(offer.inputPrice)}</td><td className="numeric">{mon(offer.outputPrice)}</td><td><button className="select-peer" onClick={()=>setSelectedId(offer.id)} disabled={!!sessionOpen||!!pendingFunding} aria-label={`Select ${offer.model} from ${offer.provider}`}>{selectedId===offer.id?<Check size={18}/>:<ArrowRight size={18}/>}</button></td></tr>)}</tbody></table></div>
            <p className="helper">All offers match <code className="model-id">{selectedModel}</code>. Registration does not confirm reachability or model access.</p>
          </details>}
        </section>
        <aside className="request-panel"><div className="panel-title"><h2>Your request</h2>{session&&ownSession&&<span className="badge">#{session.requestId}</span>}</div>
          {pendingFunding&&<div className="funding-recovery"><strong>Funding transaction submitted</strong><p>Resolve this transaction before locking another budget. Recovery checks the existing hash and does not submit a second funding transaction.</p><a className="text-link" href={`${explorer}/tx/${pendingFunding.hash}`} target="_blank" rel="noreferrer">View funding transaction<ExternalLink size={12}/></a><Button secondary className="full" disabled={!!busy||!walletReady} onClick={()=>void act('Recovering funding transaction',()=>completeFunding(pendingFunding))}>Recover funding transaction</Button></div>}
          {session&&ownSession?<>
            <div className="peer-detail"><strong className="model-id">{session.model}</strong><AddressLink address={session.provider}/><SupplierDetails provider={session.provider} operator={session.operator} endpoint={session.endpoint}/><p className="helper">{session.privacy?'Private request · encrypted gateway required. Answers stay in memory; reload or a lost reply cannot recover them.':'Standard request · supplier can read prompts and answers.'}</p></div>
            <div className="request-facts"><div><span>Funded budget</span><strong>{mon(session.deposit)} test MON</strong></div><div><span>Input price / 1M</span><strong>{mon(session.inputPrice)} test MON</strong></div><div><span>Output price / 1M</span><strong>{mon(session.outputPrice)} test MON</strong></div><div><span>Output limit</span><strong>{session.maxOutputTokens.toLocaleString()} tokens</strong></div><div><span>Request deadline</span><strong>{new Date(session.expiresAt*1000).toLocaleTimeString()}</strong></div></div>
            <ol className="phases"><li className="done"><Check size={12}/>Funded</li><li className={session.result?'done':''}>{session.result?<Check size={12}/>:<span/>}Response</li><li className={session.phase==='settled'?'done':''}>{session.phase==='settled'?<Check size={12}/>:<span/>}Settled</li></ol>
            {!session.result&&sessionOpen&&<><Field label="Original funded prompt" hint="Prompts stay off-chain and are not saved in this browser."><textarea rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Enter the exact prompt used when funding this request"/></Field><Button className="full" onClick={infer} disabled={!!busy||!walletReady||expired||!prompt.trim()}>{session.phase==='running'?'Recover / retry this request':session.privacy?'Send encrypted through Lit':'Send directly to peer'}<ArrowRight size={15}/></Button>{session.phase==='running'&&<p className="helper warning-text">{session.privacy?'Private acceptance can execute once. A lost answer is not recovered from host storage; refund after expiry if unsettled.':'An earlier attempt may have reached the upstream API. Retry uses the same request ID; the node returns cached results or refuses uncertain execution.'}</p>}</>}
            {session.result&&<><div className="response-label"><span>Peer response</span><span><ShieldCheck size={13}/>Verified invoice</span></div><div className="response-text">{session.result.text}</div><div className="invoice"><div><span>Input / output tokens</span><strong>{session.result.inputTokens.toLocaleString()} / {session.result.outputTokens.toLocaleString()}</strong></div><div><span>Usage charge</span><strong>{mon(session.result.amountWei)} test MON</strong></div><div><span>Unused deposit</span><strong>{mon(BigInt(session.deposit)-BigInt(session.result.amountWei))} test MON</strong></div></div>{sessionOpen&&!expired&&<><Button className="full" onClick={settle} disabled={!!busy||!walletReady}>{session.approval?'Retry approved settlement':'Approve usage payment'}<Check size={15}/></Button>{session.approval&&<Button secondary className="full" onClick={directSettle} disabled={!!busy||!walletReady}>Settle receipt directly</Button>}<p className="helper">Approval authorizes the displayed charge. The contract verifies your signature and credits the provider.</p></>}</>}
            {sessionOpen&&expired&&<div className="refund-state"><strong>Request expired</strong><p>Recover the deposit if the request is still open.</p><Button secondary onClick={refund} disabled={!!busy||!walletReady}>Recover expired deposit</Button></div>}
            {(currentRequest?.closed||['settled','refunded'].includes(session.phase))&&<div className="completion"><Check size={16}/><span>{session.phase==='refunded'?'Deposit recovered.':'Request closed on-chain.'}</span><Button secondary onClick={()=>{persistSession(undefined);setPrompt('');setCurrentRequest(undefined);}} disabled={!!busy}>New request</Button></div>}
            <Button secondary className="full small-action" onClick={()=>void act('Checking request state',refreshCredit)} disabled={!!busy}>Refresh request status</Button>
          </>:selected?<>
            <div className="peer-detail"><strong className="model-id">{selected.model}</strong><AddressLink address={selected.provider}/><div className="selected-rates"><span>Input <strong>{mon(selected.inputPrice)}</strong></span><span>Output <strong>{mon(selected.outputPrice)}</strong></span><span>test MON / 1M tokens</span></div><SupplierDetails provider={selected.provider} operator={selected.peer.operator} endpoint={selected.peer.endpoint}/></div>
            {!account?<div className="inline-setup"><p>Connect your wallet to register as a consumer and fund a request.</p><Button onClick={connect} disabled={!!busy}>Connect wallet</Button></div>:!mine?.active||(mine.roles&2)===0?<div className="inline-setup"><p>Register this wallet as a consumer on the same registry.</p><Button onClick={registerConsumer} disabled={!!busy||!walletReady}>Register consumer</Button></div>:<>
              <Field label="Prompt"><textarea aria-describedby="consumer-prompt-visibility" rows={5} placeholder="What would you like this model to do?" value={prompt} onChange={e=>setPrompt(e.target.value)}/></Field><p id="consumer-prompt-visibility" className="prompt-visibility">The selected provider can read your prompt and answer.</p><Field label="Maximum budget (test MON)"><input type="number" min="0" step="any" value={budget} onChange={e=>setBudget(e.target.value)}/></Field><details className="request-options"><summary>Advanced request options</summary><Field label="Output token limit"><input type="number" min="1" max="32768" step="1" value={maxOutput} onChange={e=>setMaxOutput(e.target.value)}/></Field><Field label="Prompt privacy"><select value={privacyMode?'private':'plain'} onChange={e=>setPrivacyMode(e.target.value==='private')}><option value="plain">Standard · supplier can read prompts and answers</option><option value="private" disabled>Private mode unavailable · missing hardware evidence</option></select></Field>{privacyMode&&<p className="helper warning-text">Private funding is currently blocked: Lit does not expose the hardware-authenticated action/key binding required by our on-chain verifier. Runtime, action, TLS and upstream account review are also required. The enclave and upstream LLM process plaintext.</p>}</details><Button className="full" onClick={fund} disabled={!!busy||!walletReady||!ready||!prompt.trim()||!!pendingFunding||privacyMode}>Verify peer & fund request<ArrowRight size={15}/></Button><p className="helper">Verifies the selected execution path, then locks your maximum budget for 30 minutes. Sending the prompt and approving payment are separate steps.</p>
            </>}
          </>:<div className="selection-empty"><h3>{selectedModel?'Choose a provider':'Choose a model'}</h3><p>{selectedModel?'Select a provider above to write your prompt and set a maximum budget.':'Use the model dropdown above to get started.'}</p></div>}
          {session&&!ownSession&&<p className="helper warning-text">A saved request belongs to another wallet or escrow. Reconnect its wallet and network to recover it.</p>}
          {account&&ready&&<div className="credit"><div><span>Withdrawable credit</span><strong>{mon(credit)} test MON</strong></div><Button secondary onClick={withdraw} disabled={!!busy||!walletReady||credit===0n} aria-label="Withdraw available test MON credit"><ArrowDownToLine size={15}/>Withdraw</Button></div>}
        </aside></div>
        <div className="scope-note"><strong>Paid APIs, peer to peer.</strong><span>The supplier can read prompts and answers. Chain registration does not prove the upstream model or honest metering. Private mode is unavailable pending hardware evidence. You must approve usage to pay; withholding approval leaves the supplier unpaid.</span></div>
      </>}
      </section>
      <section id="providers-panel" role="tabpanel" aria-labelledby="providers-tab" hidden={tab!=='providers'} tabIndex={0}>
      <>
        <div className="page-heading"><div><h2 className="surface-title">Bring your API. Supply a peer.</h2><p>Add a paid API key or connect your own ChatGPT plan.</p></div></div>
        <Accounts active={tab==='providers'} wallet={account} chainId={chainId} onPrepareOffer={prepareOffer} onAvailableConfigs={configs=>{if(preparedConfig&&!configs.some(c=>JSON.stringify(c)===JSON.stringify(preparedConfig))){setPreparedConfig(undefined);setAccountOffer(false);setModel('');setInputPrice('');setOutputPrice('');}}}/>
        <details className="supplier-section offer-disclosure"><summary>Publish & manage marketplace offers<span>Node registration, exact models and rates</span></summary><section aria-labelledby="supplier-title"><div className="panel-title"><h2 id="supplier-title">Marketplace supplier offers</h2>{mine&&<span className="badge">{mine.active?'Peer registered':'Peer paused'}</span>}</div><p className="section-description">Paid API accounts can supply your peer node. Personal ChatGPT connections cannot be sold here.</p>
        <div className="provide-layout"><details id="provider-setup" className="advanced-disclosure provider-setup" open={providerSetupOpen} onToggle={e=>setProviderSetupOpen(e.currentTarget.open)}><summary><ChevronDown size={16} aria-hidden="true"/>Provider node & wallet registration{!mine&&<span className="helper">Required before publishing</span>}</summary><section className="form-section"><h2>Register as a provider</h2><ol className="setup-steps">{[[walletReady,"Connect your wallet on Monad testnet"],[ready,"Contracts verified (Advanced settings)"],[!!mine,"Enter your node endpoint and register"],[false,<>Start your node: <code>npm run provider</code></>],[false,"Publish a model offer below"]].map(([done,t],i)=><li key={i} className={done?"done":""}>{t}</li>)}</ol><p className="section-description">Enter the public URL of your node. Your wallet owns the listing.</p><Field label="Node endpoint" hint="Public HTTPS URL; localhost HTTP is fine for development."><input type="url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="https://your-peer.example.com"/></Field><Field label="Node operator address"><input value={operator} readOnly spellCheck={false}/></Field><Button onClick={registerProvider} disabled={!!busy||!walletReady||!ready}>{mine?'Update registration':'Register peer'}<ArrowRight size={15}/></Button>{!ready&&<p className="helper">Set up the registry and escrow in Advanced settings before registering.</p>}{mine&&<Button secondary onClick={()=>void act('Updating peer status',async()=>{await write('registry','setActive',[!mine.active]);await refresh();setNotice(mine.active?'Peer paused. Existing funded requests remain recoverable.':'Peer active.');})} disabled={!!busy||!walletReady}>{mine.active?'Pause peer':'Activate peer'}</Button>}</section></details>
          <section className="form-section" id="publish-offer"><h2>Publish a model offer</h2><p className="section-description">Choose “Prepare offer” on a saved API account above, or enter an existing node’s exact model ID.</p><Field label="Paid API format"><select disabled={accountOffer} value={apiKind} onChange={e=>{setApiKind(e.target.value);setAccountOffer(false);}}><option value="1">Anthropic Messages</option><option value="2">OpenAI Responses</option><option value="3">OpenAI-compatible Chat Completions</option></select></Field><Field label="Public model identifier" hint="Use an exact namespaced identifier; no generic Claude or Codex aliases."><input readOnly={accountOffer} value={model} onChange={e=>{setModel(e.target.value);setAccountOffer(false);}} placeholder={apiKind==='1'?'anthropic/<exact-model-id>':apiKind==='2'?'openai/<exact-model-id>':'compatible/<exact-model-id>'} spellCheck={false}/></Field><div className="form-row"><Field label="Input test MON / 1M tokens"><input id="offer-input-price" type="number" min="0" step="any" placeholder="Test MON" value={inputPrice} onChange={e=>setInputPrice(e.target.value)}/></Field><Field label="Output test MON / 1M tokens"><input type="number" min="0" step="any" placeholder="Test MON" value={outputPrice} onChange={e=>setOutputPrice(e.target.value)}/></Field></div><Button onClick={saveOffer} disabled={!!busy||!walletReady||!ready||!mine?.active||(mine.roles&1)===0}>Publish offer<Plus size={15}/></Button>{!walletReady?<p className="helper">Connect a wallet on Monad testnet to publish.</p>:!ready?<p className="helper">Contract setup is missing. <button className="text-button" onClick={openSettings}>Open advanced settings</button></p>:!mine?.active||(mine.roles&1)===0?<p className="helper">Register and activate your provider node first. <button className="text-button" onClick={()=>{setProviderSetupOpen(true);requestAnimationFrame(()=>{document.getElementById('provider-setup')?.scrollIntoView({block:'start'});document.querySelector<HTMLElement>('#provider-setup>summary')?.focus();});}}>Open provider setup</button></p>:null}{accountOffer&&<p className="helper">Prepared from your saved account. Copy the exact configuration below to your provider node before accepting requests. Catalog discovery does not validate inference access.</p>}{preparedConfig&&<details className="model-config"><summary>Exact selected node configuration</summary><pre>{JSON.stringify(preparedConfig,null,2)}</pre><button className="text-button" onClick={()=>{setPreparedConfig(undefined);setAccountOffer(false);setModel('');setInputPrice('');setOutputPrice('');}}>Clear prepared offer</button></details>}<p className="helper">Publishing an existing public model ID updates its prices. Newly funded requests snapshot those prices.</p></section></div>
        <section className="provider-offers"><div className="panel-title"><h2>Your listed models</h2><span>{offers.filter(o=>o.provider.toLowerCase()===account?.toLowerCase()).length} offers</span></div>{offers.filter(o=>o.provider.toLowerCase()===account?.toLowerCase()).length?<div className="table-scroll"><table><thead><tr><th>Model</th><th>Input test MON / 1M</th><th>Output test MON / 1M</th><th>Status</th><th>Action</th></tr></thead><tbody>{offers.filter(o=>o.provider.toLowerCase()===account?.toLowerCase()).map(o=><tr key={o.id}><td className="model-id">{o.model}</td><td>{mon(o.inputPrice)} test MON</td><td>{mon(o.outputPrice)} test MON</td><td>{o.active?'Listed':'Paused'}</td><td><button className="text-button" disabled={!!busy||!walletReady} onClick={()=>void act('Updating offer',async()=>{await write('registry','setOffer',[o.model,o.apiKind,o.inputPrice,o.outputPrice,!o.active]);await refresh();})}>{o.active?'Pause':'List again'}</button></td></tr>)}</tbody></table></div>:<p className="simple-empty">Your published model offers will appear here after chain confirmation.</p>}</section>
        </section></details>
      </>
      </section>
      <details id="network-settings" className="advanced-disclosure network-settings" open={settingsOpen} onToggle={e=>setSettingsOpen(e.currentTarget.open)}><summary><ChevronDown size={16} aria-hidden="true"/>Advanced settings<span>{ready?'Contracts verified':'Contract setup needed'}</span></summary><div className="settings-body">
        <div className="page-heading"><div><h2>Monad testnet setup</h2><p>Enter existing contract addresses. Verify their chain and registry binding before use.</p></div><span className="badge">Chain 10143 only</span></div>
        <div className="network-layout"><section className="form-section"><h2>Contract addresses</h2><p className="section-description">The escrow must reference this registry. Addresses are stored locally for chain 10143.</p><Field label="Peer registry address"><input value={registryInput} onChange={e=>setRegistryInput(e.target.value)} placeholder="0x…" spellCheck={false}/></Field><Field label="Inference escrow address"><input value={escrowInput} onChange={e=>setEscrowInput(e.target.value)} placeholder="0x…" spellCheck={false}/></Field><Button secondary disabled={!!busy} onClick={()=>void act('Verifying contract addresses',async()=>{if(!isAddress(registryInput)||!isAddress(escrowInput))throw new Error('Enter valid registry and escrow addresses.');const value={registry:getAddress(registryInput),escrow:getAddress(escrowInput)};await verifyContracts(value);saveAddresses(value);setAddresses(value);setVerified(true);setNotice('Contract addresses verified on Monad testnet.');})}>Verify & use addresses<ShieldCheck size={15}/></Button></section>
          <section className="network-summary"><h2>Registry status</h2><div className="status-line"><span className={`status-dot ${ready?'':'muted-dot'}`}/><strong>{ready?'Contracts verified':addresses.registry||addresses.escrow?'Setup incomplete or unverified':'No deployment configured'}</strong></div><dl><div><dt>Network</dt><dd>Monad testnet · 10143</dd></div><div><dt>Registry</dt><dd>{addresses.registry?<AddressLink address={addresses.registry}/>: 'Not configured'}</dd></div><div><dt>Escrow</dt><dd>{addresses.escrow?<AddressLink address={addresses.escrow}/>: 'Not configured'}</dd></div><div><dt>Registered peers</dt><dd>{ready?peers.length:'—'}</dd></div><div><dt>Listed offers</dt><dd>{ready?offers.filter(o=>o.active&&o.peer.active).length:'—'}</dd></div></dl><p className="helper">Chain registration records identity and endpoint authorization. Availability is checked when you select and authenticate a peer.</p><a className="text-link" href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">Get test MON from the Monad faucet<ExternalLink size={14}/></a></section></div>
        {ready&&<section className="peer-roster"><div className="panel-title"><h2>Registered peers</h2><Button secondary onClick={()=>void refresh()} disabled={loading||!!busy}><RefreshCw size={14}/>Refresh</Button></div>{peers.length?<div className="table-scroll"><table><thead><tr><th>Owner</th><th>Role</th><th>Endpoint</th><th>Registration</th></tr></thead><tbody>{peers.map(p=><tr key={p.address}><td><AddressLink address={p.address}/></td><td>{p.peer.roles===3?'Provider + consumer':p.peer.roles===1?'Provider':'Consumer'}</td><td className="endpoint">{p.peer.endpoint||'Consumer has no endpoint'}</td><td>{p.peer.active?'Active':'Paused'}</td></tr>)}</tbody></table></div>:<p className="simple-empty">No peers are registered yet. Register your provider wallet from Providers.</p>}</section>}
      </div></details>
    </main></div><footer><span>LLM Providers</span><span>On-chain discovery. Direct peer inference.</span><a href={`${explorer}`} target="_blank" rel="noreferrer">Monad testnet explorer<ExternalLink size={12}/></a></footer>
  </div>;
}
