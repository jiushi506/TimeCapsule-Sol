import React, { Suspense, useEffect, useRef, useState } from "react";
import { LanguageProvider, useLanguage } from "./context/LanguageContext";
import { SolanaWalletProvider } from "./context/SolanaWalletContext";
import { PublicWalletUiContext } from "./context/useAuthSession";
import { CapsuleComposerProvider } from "./views/CapsuleComposer";
import { Navbar } from "./components/Navbar";
import { WalletModal } from "./components/WalletModal";
import { Footer } from "./components/Footer";
import { LoadingText } from "./components/LoadingText";
import { HomeView } from "./views/HomeView";
import {
  APP_ROUTES,
  buildRouteHash,
  parseAppHash,
  type AppRoute,
} from "./routing";

const Create = React.lazy(() =>
  import("./views/PublicSolanaViews").then((m) => ({ default: m.CreateView })),
);
const My = React.lazy(() =>
  import("./views/PublicSolanaViews").then((m) => ({ default: m.MyView })),
);
const Explore = React.lazy(() =>
  import("./views/SolanaExploreView").then((m) => ({
    default: m.SolanaExploreView,
  })),
);
const Recover = React.lazy(() =>
  import("./views/SolanaRecoveryView").then((m) => ({
    default: m.SolanaRecoveryView,
  })),
);

function AppContent() {
  const initial = parseAppHash(window.location.hash);
  const [activeTab, setActiveTab] = useState<AppRoute>(initial.route);
  const [search, setSearch] = useState(initial.search);
  const [walletOpen, setWalletOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const { t } = useLanguage();
  useEffect(() => {
    const sync = () => {
      const next = parseAppHash(window.location.hash);
      setActiveTab(next.route);
      setSearch(next.search);
      main.current?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = (
    tab: string,
    params?: Record<string, string | number | undefined>,
  ) => {
    const route = tab === "recovery" ? "recover" : tab;
    window.location.hash = buildRouteHash(
      APP_ROUTES.includes(route as AppRoute) ? route : "home",
      params,
    );
  };
  return (
    <PublicWalletUiContext.Provider value={() => setWalletOpen(true)}>
      <div
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <Navbar
          activeTab={activeTab}
          setActiveTab={navigate}
          onOpenWalletModal={() => setWalletOpen(true)}
        />
        <main id="main-content" ref={main} tabIndex={-1} style={{ flex: 1 }}>
          <Suspense
            fallback={
              <div
                role="status"
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                <LoadingText>{t("app.loading")}</LoadingText>
              </div>
            }
          >
            {activeTab === "home" && (
              <HomeView
                onNavigate={navigate}
                onOpenWallet={() => setWalletOpen(true)}
              />
            )}
            {activeTab === "create" && (
              <Create
                onOpenWallet={() => setWalletOpen(true)}
                onNavigate={navigate}
              />
            )}
            {activeTab === "my" && (
              <My
                onOpenWallet={() => setWalletOpen(true)}
                onNavigate={navigate}
              />
            )}
            {activeTab === "explore" && <Explore onNavigate={navigate} />}
            {activeTab === "recover" && (
              <Recover key={search} initialSearch={search} />
            )}
          </Suspense>
        </main>
        <WalletModal isOpen={walletOpen} onClose={() => setWalletOpen(false)} />
        <Footer />
      </div>
    </PublicWalletUiContext.Provider>
  );
}
export function App() {
  return (
    <LanguageProvider>
      <SolanaWalletProvider>
        <CapsuleComposerProvider>
          <AppContent />
        </CapsuleComposerProvider>
      </SolanaWalletProvider>
    </LanguageProvider>
  );
}
export default App;
