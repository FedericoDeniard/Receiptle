import { HeroSection } from "../components/landing/HeroSection";
import { FeatureGrid } from "../components/landing/FeatureGrid";
import { HowItWorks } from "../components/landing/HowItWorks";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import logo from "../logo.svg";

const CURRENT_YEAR = new Date().getFullYear();
import { DecorativeSquare } from "../components/ui/DecorativeSquare";

export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] flex flex-col font-sans selection:bg-[var(--accent)] selection:text-[var(--primary)]">
      {/* Header/Nav */}
      <header className="fixed top-0 w-full bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--text-secondary)]/10 z-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative size-8 flex items-center justify-center shrink-0">
              <DecorativeSquare size={32} className="absolute inset-0 m-auto" />
              <img
                src={logo}
                alt="Receiptle Logo"
                className="relative z-10 w-full h-full p-1 object-contain"
              />
            </div>
            <span className="font-bold text-xl tracking-tight text-[var(--text-primary)]">
              Receiptle
            </span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              to="/login"
              className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {t("landing.nav.signIn")}
            </Link>
            <Link
              to="/register"
              className="text-sm font-medium bg-[var(--primary)] text-white px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)] transition-colors shadow-sm"
            >
              {t("landing.nav.getStarted")}
            </Link>
          </nav>
        </div>
      </header>

      <main className="grow pt-16">
        <HeroSection />
        <FeatureGrid />
        <HowItWorks />
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-[var(--text-secondary)]/10 py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="relative size-6 flex items-center justify-center shrink-0 grayscale opacity-50">
                <DecorativeSquare
                  size={24}
                  className="absolute inset-0 m-auto"
                />
                <img
                  src={logo}
                  alt="Receiptle"
                  className="relative z-10 w-full h-full p-0.5 object-contain"
                />
              </div>
              <span className="font-semibold text-[var(--text-secondary)]">
                Receiptle
              </span>
            </div>
            <div className="flex gap-6 text-sm text-[var(--text-secondary)]">
              <a
                href="https://federicodeniard-receiptle.mintlify.app/"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("landing.nav.documentation")}
              </a>
              <a
                href="https://github.com/federicodeniard/receiptle"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("landing.nav.github")}
              </a>
              <Link
                to="/privacy"
                className="hover:text-[var(--primary)] transition-colors"
              >
                {t("landing.nav.privacy")}
              </Link>
            </div>
          </div>
          <div className="mt-8 text-center text-sm text-[var(--text-secondary)]/60">
            &copy; {CURRENT_YEAR} Receiptle. {t("landing.nav.personalProject")}
          </div>
        </div>
      </footer>
    </div>
  );
}
