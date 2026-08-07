import React from 'react';
import { Coins, ShieldCheck } from 'lucide-react';

export default function PremiumLoader() {
  return (
    <main className="premium-loader">
      <section className="premium-loader-card">
        <div className="loader-logo-orbit">
          <div className="loader-coin">
            <Coins size={46} />
          </div>
          <span className="loader-particle particle-one" />
          <span className="loader-particle particle-two" />
          <span className="loader-particle particle-three" />
          <span className="loader-particle particle-four" />
        </div>

        <div className="loader-copy">
          <p>Easy Gold Ledger</p>
          <h1>Initializing secure loan workspace</h1>
          <div className="loader-trust">
            <ShieldCheck size={15} />
            <span>Firebase protected session</span>
          </div>
        </div>

        <div className="loader-progress" aria-hidden="true">
          <span />
        </div>
      </section>
    </main>
  );
}
