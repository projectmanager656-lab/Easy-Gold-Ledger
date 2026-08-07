import React from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { GoldButton } from './PremiumUI';

const DISMISSED_KEY = 'easy_gold_install_prompt_dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = React.useState(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISSED_KEY) === 'true') return;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setVisible(true);
    };

    const handleInstalled = () => {
      setInstallEvent(null);
      setVisible(false);
      localStorage.setItem(DISMISSED_KEY, 'true');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, 'true');
  };

  const installApp = async () => {
    if (!installEvent) return;

    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  };

  if (!visible || !installEvent) return null;

  return (
    <div className="install-sheet" role="dialog" aria-label="Install Easy Gold Ledger">
      <div className="install-sheet-icon">
        <Smartphone size={22} />
      </div>
      <div className="install-sheet-copy">
        <strong>Install App</strong>
        <span>Open Easy Gold Ledger faster with a native app feel.</span>
      </div>
      <GoldButton type="button" onClick={installApp} style={{ padding: '10px 20px' }}>
        <Download size={16} />
        Install
      </GoldButton>
      <button type="button" className="install-sheet-close" onClick={dismiss} aria-label="Dismiss install prompt">
        <X size={18} />
      </button>
    </div>
  );
}
