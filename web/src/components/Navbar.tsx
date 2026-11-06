import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useSolanaWallet } from '../context/solanaWalletState';
import { DEFAULT_CHAIN_ID, hasVerifiedRegistryDeployment, MAINNET_CHAIN_IDS, SUPPORTED_CHAINS, TESTNET_CHAIN_IDS } from '../contracts/config';
import {
  KeyRound,
  Compass,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  ChevronDown,
  Sparkles,
  Globe,
  Wallet,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuthSession } from '../context/useAuthSession';
import { getWalletNetworkErrorKey, getWalletNetworkSwitchAttemptKey, parseWalletChainId } from '../context/walletProviderUtils';
import { WalletNetworkNotice } from './WalletNetworkNotice';
import { WalletSiteNetworkDetails } from './WalletSiteNetworkDetails';
import { WalletSignInActions } from './WalletSignIn';
import { sessionWalletHint } from '../context/sessionWalletHint';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenWalletModal: () => void;
}

const publicAsset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenWalletModal,
}) => {
  const evmWallet = useWallet();
  const solanaWallet = useSolanaWallet();
  const isSolanaConnected = solanaWallet.isConnected && !evmWallet.isConnected;
  const address = evmWallet.address ?? solanaWallet.address;
  const isConnected = evmWallet.isConnected || isSolanaConnected;
  const balance = isSolanaConnected ? solanaWallet.balance : evmWallet.balance;
  const chainId = isSolanaConnected ? null : evmWallet.chainId;
  const switchChain = evmWallet.switchChain;
  const selectNetwork = evmWallet.selectNetwork;
  const getProvider = evmWallet.getProvider;
  const clearNetworkCheck = evmWallet.clearNetworkCheck;
  const isEvmConnected = evmWallet.isConnected;
  const networkCheckChainId = evmWallet.networkCheckChainId;
  const walletType = evmWallet.walletType ?? (isSolanaConnected ? 'phantom-solana' : null);
  const { language, setLanguage, languages, currentLanguage, t } = useLanguage();
  const authSession = useAuthSession();
  const sessionWallet = sessionWalletHint(authSession.session?.displayName);
  const isSolanaLogin = authSession.status === 'authenticated' && sessionWallet?.family === 'solana';
  // A Solana SSO identity selects the displayed network; only Phantom's
  // origin permission makes the Solana wallet a usable transaction signer.
  const showSolanaNetwork = isSolanaConnected || isSolanaLogin;
  const needsSolanaSiteConnection = isSolanaLogin && !isSolanaConnected;
  const accountAddress = sessionWallet?.address ?? address;
  const hasAccountWallet = isConnected && walletType !== 'demo' && Boolean(address) &&
    (!sessionWallet || (sessionWallet.family === 'evm'
      ? !isSolanaConnected && sessionWallet.address.toLowerCase() === address?.toLowerCase()
      : isSolanaConnected && sessionWallet.address === address));
  const [copied, setCopied] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const [networkErrorKey, setNetworkErrorKey] = useState<string | null>(null);
  const [pendingNetworkChainId, setPendingNetworkChainId] = useState<number | null>(null);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [observedWalletChainId, setObservedWalletChainId] = useState<number | null>(null);
  const [walletNetworkReadError, setWalletNetworkReadError] = useState(false);
  const [isActivePage, setIsActivePage] = useState(() => document.visibilityState === 'visible' && document.hasFocus());
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const networkButtonRef = useRef<HTMLButtonElement>(null);
  const autoSwitchAttemptRef = useRef<string | null>(null);
  const switchRequestRef = useRef(false);
  const readWalletNetworkRef = useRef<() => Promise<void>>(async () => {});
  const networkReadVersionRef = useRef(0);

  useEffect(() => {
    const updatePageActivity = () => setIsActivePage(document.visibilityState === 'visible' && document.hasFocus());
    updatePageActivity();
    window.addEventListener('focus', updatePageActivity);
    window.addEventListener('blur', updatePageActivity);
    document.addEventListener('visibilitychange', updatePageActivity);
    return () => {
      window.removeEventListener('focus', updatePageActivity);
      window.removeEventListener('blur', updatePageActivity);
      document.removeEventListener('visibilitychange', updatePageActivity);
    };
  }, []);

  useEffect(() => {
    if (!showAccountDropdown) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setShowAccountDropdown(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAccountDropdown(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showAccountDropdown]);

  useEffect(() => {
    if (!showNetworkDropdown) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!networkMenuRef.current?.contains(event.target as Node)) {
        setShowNetworkDropdown(false);
      }
    };
    const handleMenuKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowNetworkDropdown(false);
        networkButtonRef.current?.focus();
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = Array.from(
        networkMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
      );
      if (!options.length) return;
      event.preventDefault();
      const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
        ? (currentIndex + 1) % options.length
        : (currentIndex <= 0 ? options.length : currentIndex) - 1;
      options[nextIndex]?.focus();
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', handleMenuKeys);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', handleMenuKeys);
    };
  }, [showNetworkDropdown]);

  const displayedChainId = chainId ?? DEFAULT_CHAIN_ID;
  const currentWalletChainId = walletNetworkReadError ? null : observedWalletChainId ?? evmWallet.walletChainId;
  const currentChain = showSolanaNetwork ? null : SUPPORTED_CHAINS[displayedChainId];
  const walletBalanceChain = SUPPORTED_CHAINS[currentWalletChainId ?? displayedChainId];

  useEffect(() => {
    if (!isEvmConnected || walletType === 'demo') {
      setObservedWalletChainId(null);
      setWalletNetworkReadError(false);
      return;
    }

    const provider = getProvider();
    if (!provider?.request) {
      setObservedWalletChainId(null);
      setWalletNetworkReadError(true);
      return;
    }

    let disposed = false;
    const readCurrentWalletChain = async () => {
      if (switchRequestRef.current) return;
      const currentRead = ++networkReadVersionRef.current;
      try {
        const rawChainId = await provider.request({ method: 'eth_chainId' });
        const actualChainId = parseWalletChainId(rawChainId);
        if (disposed || currentRead !== networkReadVersionRef.current) return;
        setObservedWalletChainId(actualChainId);
        setWalletNetworkReadError(false);
      } catch {
        if (disposed || currentRead !== networkReadVersionRef.current) return;
        setObservedWalletChainId(null);
        setWalletNetworkReadError(true);
      }
    };
    readWalletNetworkRef.current = readCurrentWalletChain;
    const reconcileWalletChain = async () => {
      if (document.visibilityState !== 'hidden') await readCurrentWalletChain();
    };
    const handleChainChanged = (chainHex: string) => {
      networkReadVersionRef.current += 1;
      try {
        setObservedWalletChainId(parseWalletChainId(chainHex));
        setWalletNetworkReadError(false);
      } catch {
        setObservedWalletChainId(null);
        setWalletNetworkReadError(true);
      }
      void reconcileWalletChain();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void reconcileWalletChain();
    };

    provider.on?.('chainChanged', handleChainChanged);
    window.addEventListener('focus', reconcileWalletChain);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(() => void reconcileWalletChain(), 3_000);
    void reconcileWalletChain();

    return () => {
      disposed = true;
      if (readWalletNetworkRef.current === readCurrentWalletChain) readWalletNetworkRef.current = async () => {};
      window.clearInterval(intervalId);
      window.removeEventListener('focus', reconcileWalletChain);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [getProvider, isEvmConnected, walletType]);

  useEffect(() => {
    if (!isEvmConnected) {
      setPendingNetworkChainId(null);
      setNetworkErrorKey(null);
      setIsSwitchingNetwork(false);
      return;
    }
    if (currentWalletChainId === displayedChainId && !switchRequestRef.current) setNetworkErrorKey(null);
  }, [isEvmConnected, currentWalletChainId, displayedChainId]);

  const confirmWalletNetwork = useCallback(async (targetChainId: number) => {
    if (switchRequestRef.current) return;
    switchRequestRef.current = true;
    networkReadVersionRef.current += 1;
    autoSwitchAttemptRef.current = getWalletNetworkSwitchAttemptKey({
      connected: isEvmConnected, walletType, address, targetChainId,
      currentChainId: currentWalletChainId, isSolanaConnected: false,
      switchPending: false, lastAttemptKey: null,
    });
    setNetworkErrorKey(null);
    setPendingNetworkChainId(targetChainId);
    setIsSwitchingNetwork(true);
    try {
      const provider = getProvider();
      if (!provider?.request) throw new Error('Wallet provider unavailable');
      await switchChain(targetChainId);
      const verifiedChainId = parseWalletChainId(await provider.request({ method: 'eth_chainId' }));
      setObservedWalletChainId(verifiedChainId);
      setWalletNetworkReadError(false);
      if (verifiedChainId !== targetChainId) {
        throw new Error(`Wallet stayed on chain ${verifiedChainId}; expected ${targetChainId}.`);
      }
      clearNetworkCheck(targetChainId);
    } catch (error) {
      setNetworkErrorKey(getWalletNetworkErrorKey(error));
    } finally {
      networkReadVersionRef.current += 1;
      switchRequestRef.current = false;
      setPendingNetworkChainId(null);
      setIsSwitchingNetwork(false);
    }
  }, [address, currentWalletChainId, isEvmConnected, getProvider, clearNetworkCheck, switchChain, walletType]);

  const chooseNetwork = async (targetChainId: number) => {
    if (switchRequestRef.current) return;
    setNetworkErrorKey(null);
    setShowNetworkDropdown(false);
    selectNetwork(targetChainId);
    if (!evmWallet.isConnected || evmWallet.walletType === 'demo') return;
    await confirmWalletNetwork(targetChainId);
  };

  useEffect(() => {
    if (!evmWallet.isConnected || walletType === 'demo' || isSolanaConnected) {
      autoSwitchAttemptRef.current = null;
      return;
    }
    if (currentWalletChainId === null) return;
    if (currentWalletChainId === displayedChainId) {
      return;
    }
    // A network option click already starts its own switch request. Also avoid
    // reopening a wallet prompt after the user rejected the automatic request.
    const attemptKey = getWalletNetworkSwitchAttemptKey({
      connected: evmWallet.isConnected,
      walletType,
      address,
      targetChainId: displayedChainId,
      currentChainId: currentWalletChainId,
      isSolanaConnected,
      switchPending: pendingNetworkChainId !== null || isSwitchingNetwork,
      lastAttemptKey: autoSwitchAttemptRef.current,
      isActivePage,
    });
    if (attemptKey === null) return;
    autoSwitchAttemptRef.current = attemptKey;
    void confirmWalletNetwork(displayedChainId);
  }, [
    activeTab,
    address,
    confirmWalletNetwork,
    currentWalletChainId,
    displayedChainId,
    evmWallet.isConnected,
    isSolanaConnected,
    isActivePage,
    isSwitchingNetwork,
    pendingNetworkChainId,
    walletType,
  ]);

  const openNetworkDropdown = (last = false) => {
    setShowNetworkDropdown(true);
    void readWalletNetworkRef.current();
    window.requestAnimationFrame(() => {
      const options = networkMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)');
      (last ? options?.[options.length - 1] : options?.[0])?.focus();
    });
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const copyAddress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accountAddress) return;
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // Get Wallet Logo/Name
  const getWalletInfo = () => {
    if (walletType === 'metamask') {
      return {
        name: 'MetaMask',
        color: '#E27625',
        icon: (
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <path d="M28.5 4.5L18.5 12L20.5 7.5L28.5 4.5Z" fill="#E17726" />
            <path d="M3.5 4.5L11.5 7.5L13.5 12L3.5 4.5Z" fill="#E27625" />
            <path d="M24.5 21.5L22 25.5L28 27L29.5 21.5L24.5 21.5Z" fill="#E27625" />
            <path d="M2.5 21.5L4 27L10 25.5L7.5 21.5L2.5 21.5Z" fill="#E27625" />
            <path d="M9.5 14L8 18.5L13.5 19L13.5 13.5L9.5 14Z" fill="#E27625" />
            <path d="M22.5 14L18.5 13.5L18.5 19L24 18.5L22.5 14Z" fill="#E27625" />
          </svg>
        ),
      };
    }
    if (walletType === 'phantom-solana') {
      return {
        name: 'Phantom · Solana',
        color: '#ab9ff2',
        icon: <span aria-hidden="true" style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', borderRadius: '50%', background: '#ab9ff2', color: '#1a1533', fontSize: 13, fontWeight: 800 }}>◉</span>,
      };
    }
    if (walletType === 'demo') return {
      name: t('nav.localDemo'),
      color: '#c084fc',
      icon: <Sparkles size={16} color="#c084fc" />,
    };
    return { name: t('auth.signedIn'), color: '#34d399', icon: <Wallet size={16} color="#34d399" /> };
  };

  const walletInfo = getWalletInfo();

  return (
    <header className="site-header" style={{
      borderBottom: '1px solid var(--border-subtle)',
      background: 'rgba(5, 7, 19, 0.92)',
      backdropFilter: 'blur(20px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '12px 24px',
    }}>
      <div className="site-header-inner" style={{
        maxWidth: 1320,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        {/* Logo & Brand */}
        <button
          id="nav-brand"
          type="button"
          aria-label={t('nav.homeAria')}
          onClick={() => setActiveTab('home')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            userSelect: 'none',
            border: 0,
            padding: 0,
            color: 'inherit',
            textAlign: 'left',
            background: 'transparent',
          }}
        >
          <img
            src={publicAsset('timecapsule-icon-rounded.png')}
            alt=""
            width={38}
            height={38}
            style={{ width: 38, height: 38, borderRadius: 12, objectFit: 'cover', display: 'block' }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="font-display" style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
                Time<span className="gradient-text-cyan">Capsule</span>
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {t('nav.brandSub')}
            </div>
          </div>
        </button>

        {/* Navigation Tabs */}
        <nav className="site-nav" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
        }}>
          <button
            id="nav-tab-home"
            aria-current={activeTab === 'home' ? 'page' : undefined}
            onClick={() => setActiveTab('home')}
            style={{
              background: activeTab === 'home' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: activeTab === 'home' ? 'var(--cyan-primary)' : 'var(--text-muted)',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t('nav.overview')}
          </button>

          <button
            id="nav-tab-create"
            aria-current={activeTab === 'create' ? 'page' : undefined}
            onClick={() => setActiveTab('create')}
            style={{
              background: activeTab === 'create' ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
              color: activeTab === 'create' ? 'var(--cyan-primary)' : 'var(--text-muted)',
              border: activeTab === 'create' ? '1px solid rgba(0, 240, 255, 0.3)' : '1px solid transparent',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s',
            }}
          >
            <KeyRound size={14} />
            {t('nav.sealCapsule')}
          </button>

          <button
            id="nav-tab-my"
            aria-current={activeTab === 'my' ? 'page' : undefined}
            onClick={() => setActiveTab('my')}
            style={{
              background: activeTab === 'my' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: activeTab === 'my' ? 'var(--cyan-primary)' : 'var(--text-muted)',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t('nav.myCapsules')}
          </button>

          <button
            id="nav-tab-explore"
            aria-current={activeTab === 'explore' ? 'page' : undefined}
            onClick={() => setActiveTab('explore')}
            style={{
              background: activeTab === 'explore' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              color: activeTab === 'explore' ? 'var(--cyan-primary)' : 'var(--text-muted)',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s',
            }}
          >
            <Compass size={14} />
            {t('nav.explorer')}
          </button>

          <button
            id="nav-tab-recovery"
            aria-current={activeTab === 'recover' ? 'page' : undefined}
            onClick={() => setActiveTab('recover')}
            style={{
              background: activeTab === 'recover' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              color: activeTab === 'recover' ? '#c084fc' : 'var(--text-muted)',
              border: activeTab === 'recover' ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid transparent',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s',
            }}
          >
            <RefreshCw size={14} />
            {t('nav.directRecovery')}
          </button>
        </nav>

        {/* Right Section: Platform Account, Language, Network & Wallet */}
        <div className="site-controls" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Language Selector Dropdown (Extensible) */}
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 12px',
            fontSize: '0.82rem',
            gap: 8,
            cursor: 'pointer',
          }}>
            <Globe size={14} color="var(--cyan-primary)" />
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              {currentLanguage.nativeName}
            </span>
            <ChevronDown size={14} color="var(--text-muted)" />
            <select
              id="language-selector-dropdown"
              aria-label={t('nav.selectLanguageAria')}
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
              }}
              title={t('nav.selectLanguageAria')}
            >
              {languages.map((item) => (
                <option
                  key={item.code}
                  value={item.code}
                  style={{ background: '#0b0f24', color: '#f8fafc', padding: '8px' }}
                >
                  {item.nativeName}
                </option>
              ))}
            </select>
          </div>

          {/* Network Switcher */}
          <div ref={networkMenuRef} className="network-menu-container" style={{ position: 'relative' }}>
            <button
              id="network-selector"
              ref={networkButtonRef}
              type="button"
              disabled={(walletType === 'demo' && !isSolanaLogin) || isSolanaConnected || (isSwitchingNetwork && !isSolanaLogin)}
              onClick={() => {
                if (isSolanaLogin) {
                  onOpenWalletModal();
                  return;
                }
                if (!showNetworkDropdown) void readWalletNetworkRef.current();
                setShowNetworkDropdown((open) => !open);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (isSolanaLogin) {
                    onOpenWalletModal();
                    return;
                  }
                  openNetworkDropdown(event.key === 'ArrowUp');
                }
              }}
              aria-haspopup={needsSolanaSiteConnection ? 'dialog' : isSolanaConnected ? undefined : 'listbox'}
              aria-expanded={needsSolanaSiteConnection || isSolanaConnected ? undefined : showNetworkDropdown}
              aria-controls={needsSolanaSiteConnection || isSolanaConnected ? undefined : 'network-selector-options'}
              className="network-selector-button"
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: showSolanaNetwork ? '#9945FF' : currentChain?.badgeColor || '#64748b',
                boxShadow: `0 0 8px ${showSolanaNetwork ? '#9945FF' : currentChain?.badgeColor || '#64748b'}`,
                flexShrink: 0,
              }} />
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {showSolanaNetwork ? 'Solana Devnet' : currentChain?.shortName || (chainId === null ? t('nav.noWalletNetwork') : `${t('home.networkUnsupported')} (${chainId})`)}
              </span>
              <ChevronDown
                size={14}
                color="var(--text-muted)"
                style={{ transform: showNetworkDropdown && !isSolanaLogin ? 'rotate(180deg)' : undefined, transition: 'transform 0.16s' }}
              />
            </button>
            {showNetworkDropdown && !isSolanaLogin && (
              <div className="network-dropdown">
                {isEvmConnected && walletType !== 'demo' && (
                  <WalletSiteNetworkDetails
                    targetChainId={displayedChainId}
                    walletChainId={currentWalletChainId}
                    switching={isSwitchingNetwork}
                    onSwitch={(id) => void confirmWalletNetwork(id)}
                  />
                )}
                <div
                id="network-selector-options"
                role="listbox"
                aria-label={t('nav.selectNetworkAria')}
              >
                {[
                  { label: 'Mainnets', ids: MAINNET_CHAIN_IDS },
                  { label: 'Testnets', ids: TESTNET_CHAIN_IDS },
                ].map((group) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <div className="network-dropdown-heading">{group.label}</div>
                    {group.ids.map((id) => {
                      const chain = SUPPORTED_CHAINS[id];
                      const isSelected = displayedChainId === id;
                      const isConfigured = hasVerifiedRegistryDeployment(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={isSwitchingNetwork}
                          className="network-dropdown-option"
                          title={isConfigured ? t('nav.registryConfigured') : t('nav.registryNotConfigured')}
                          onClick={() => void chooseNetwork(id)}
                        >
                          <span className="network-option-indicator" style={{ background: chain.badgeColor }} />
                          <span className="network-option-name">{chain.name} ({id})</span>
                          <span className={`network-option-status${isConfigured ? ' is-configured' : ''}`}>
                            {isConfigured ? t('nav.ready') : t('nav.notConfigured')}
                          </span>
                          {isSelected && <Check size={15} className="network-option-check" aria-label={t('nav.currentNetworkAria')} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>

          {authSession.status === 'authenticated' ? (
            <div ref={accountMenuRef} className="account-menu-container wallet-account-group" style={{ position: 'relative' }}>
              <button
                id="connected-wallet-badge"
                type="button"
                className="connected-card"
                onClick={() => setShowAccountDropdown((open) => !open)}
                aria-label={t('nav.walletMenuAria')}
                aria-expanded={showAccountDropdown}
                aria-controls="account-dropdown-menu"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '5px 10px 5px 12px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  color: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {/* Signed-in status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className="status-dot-pulse"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: '#10b981',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#34d399',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}>
                    {t('auth.signedIn')}
                  </span>
                </div>

                {/* Vertical Divider */}
                <span style={{ width: 1, height: 16, background: 'rgba(16, 185, 129, 0.3)' }} />

                {/* Balance Pill */}
                {hasAccountWallet && <div title={isSolanaConnected ? solanaWallet.balanceError ?? undefined : undefined} style={{
                  background: 'rgba(240, 185, 11, 0.12)',
                  border: '1px solid rgba(240, 185, 11, 0.35)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
                  <span style={{ fontSize: '0.74rem' }}>💰</span>
                  <span className="font-mono" style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 700 }}>
                    {isSolanaConnected ? `${balance} SOL` : walletBalanceChain ? `${balance} ${walletBalanceChain.nativeCurrency.symbol}` : t('nav.switchNetworkShort')}
                  </span>
                </div>}

                {/* Wallet Icon & Address Pill */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  {walletInfo.icon}
                  <span className="font-mono" style={{ fontSize: '0.84rem', color: '#f8fafc', fontWeight: 700 }}>
                    {accountAddress ? formatAddress(accountAddress) : authSession.session?.displayName || t('auth.signedIn')}
                  </span>
                </div>

                <ChevronDown size={14} color="#34d399" />
              </button>

              {/* Connected Account Dropdown Menu */}
              {showAccountDropdown && (
                <div
                  id="account-dropdown-menu"
                  className="glass-panel"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: 'min(310px, calc(100vw - 32px))',
                    background: 'rgba(11, 15, 36, 0.98)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    boxShadow: '0 15px 35px rgba(0, 0, 0, 0.7), 0 0 20px rgba(16, 185, 129, 0.2)',
                    borderRadius: 16,
                    padding: 16,
                    zIndex: 60,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="status-dot-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                      <span style={{ fontSize: '0.78rem', color: '#34d399', fontWeight: 700 }}>{t('auth.signedIn')}</span>
                    </div>
                    <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>{walletInfo.name}</span>
                  </div>

                  {/* Full Address Card */}
                  {accountAddress && <div style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 12,
                  }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{t('nav.fullAddress')}</div>
                    <div className="font-mono" style={{ fontSize: '0.76rem', color: 'var(--cyan-primary)', wordBreak: 'break-all' }}>
                      {accountAddress}
                    </div>
                  </div>}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {accountAddress && <button
                      id="btn-copy-address"
                      onClick={copyAddress}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: copied ? '#34d399' : 'var(--text-main)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {copied ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                        {copied ? t('nav.addressCopied') : t('nav.copyWalletAddress')}
                      </span>
                    </button>}

                    {accountAddress && (sessionWallet?.family === 'solana' || isSolanaConnected) ? (
                      <a
                        id="link-view-explorer"
                        href={`https://explorer.solana.com/address/${accountAddress}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-main)', fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ExternalLink size={14} /> Solana Explorer · Devnet</span>
                      </a>
                    ) : accountAddress && currentChain && (
                    <a
                      id="link-view-explorer"
                      href={`${currentChain.blockExplorer}/address/${accountAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: 'var(--text-main)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ExternalLink size={14} /> View in Explorer
                      </span>
                    </a>
                    )}

                    {!hasAccountWallet && <button type="button" className="btn-secondary" onClick={() => {
                      setShowAccountDropdown(false);
                      onOpenWalletModal();
                    }}>{t('nav.connectWallet')}</button>}
                    <button
                      id="btn-sign-out"
                      type="button"
                      onClick={() => {
                        setShowAccountDropdown(false);
                        // Sign out of the website. Keep passive provider
                        // observation so a subsequent B login targets B,
                        // while anonymous UI never exposes wallet information.
                        void authSession.logout();
                      }}
                      style={{
                        background: 'rgba(244, 63, 94, 0.12)',
                        border: '1px solid rgba(244, 63, 94, 0.35)',
                        color: '#fb7185',
                        borderRadius: 8,
                        padding: '8px 12px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      <LogOut size={14} /> {t('auth.signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <WalletSignInActions returnTo={`/#/${activeTab}`} compact />
          )}
        </div>
      </div>
      {!isSolanaConnected && walletType !== 'demo' && (
        activeTab === 'create' || (evmWallet.isConnected && (
          isSwitchingNetwork || networkErrorKey !== null || walletNetworkReadError ||
          networkCheckChainId !== null || currentWalletChainId !== displayedChainId
        ))
      ) && (
        <WalletNetworkNotice
          connected={evmWallet.isConnected}
          targetChainId={displayedChainId}
          walletChainId={currentWalletChainId}
          switching={isSwitchingNetwork}
          readError={walletNetworkReadError}
          errorKey={networkErrorKey}
          onSwitch={(targetChainId) => void confirmWalletNetwork(targetChainId)}
          onConnect={onOpenWalletModal}
        />
      )}
    </header>
  );
};
