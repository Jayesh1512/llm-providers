import { ArrowDownRight } from 'lucide-react';
export function Intro() {
  return <section className="intro" aria-labelledby="intro-title">
    <div className="intro-copy"><h1 id="intro-title">A model.<br/>A peer. Your choice.</h1><p>Bring your paid API or find your next supplier.<br className="desktop-break"/> Inference goes peer to peer. You approve the payment.</p></div>
    <div className="intro-note"><ArrowDownRight size={28} strokeWidth={1.25} aria-hidden="true"/><span>A peer workspace for<br/>the Monad testnet marketplace.</span></div>
  </section>;
}
