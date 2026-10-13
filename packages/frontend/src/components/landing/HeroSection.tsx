import { LazyMotion, m, domAnimation, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SubscriptionListItem } from "../subscriptions/SubscriptionListItem";
import { useState, useEffect } from "react";

// ─── Mock data ──────────────────────────────────────────────────────────────

interface MockSubscription {
  merchant_normalized: string;
  merchant_display: string;
  avg_amount: number;
  occurrences: number;
  interval_days_avg: number;
  interval_stddev: number;
  currency: string;
  frequency: string;
  last_date: string;
  next_estimated_date: string;
  category: string;
  confidence_score: number;
  source_email_consistent: boolean;
}

interface MockTransaction {
  title: string;
  category: string;
  date: string;
  amount: string;
  currency: string;
  color: string;
}

function buildMockDates() {
  return {
    today: new Date().toISOString().substring(0, 10),
    future5: new Date(Date.now() + 86400000 * 5).toISOString().substring(0, 10),
    future12: new Date(Date.now() + 86400000 * 12)
      .toISOString()
      .substring(0, 10),
    past2: new Date(Date.now() - 86400000 * 2).toISOString().substring(0, 10),
  };
}

function buildMockSubscriptions(
  dates: ReturnType<typeof buildMockDates>
): MockSubscription[] {
  return [
    {
      merchant_normalized: "netflix",
      merchant_display: "Netflix",
      avg_amount: 15.99,
      occurrences: 12,
      interval_days_avg: 30,
      interval_stddev: 0.5,
      currency: "USD",
      frequency: "monthly",
      last_date: dates.today,
      next_estimated_date: dates.future5,
      category: "entertainment",
      confidence_score: 95,
      source_email_consistent: true,
    },
    {
      merchant_normalized: "spotify",
      merchant_display: "Spotify",
      avg_amount: 9.99,
      occurrences: 24,
      interval_days_avg: 30,
      interval_stddev: 0.2,
      currency: "USD",
      frequency: "monthly",
      last_date: dates.today,
      next_estimated_date: dates.future12,
      category: "entertainment",
      confidence_score: 98,
      source_email_consistent: true,
    },
    {
      merchant_normalized: "aws",
      merchant_display: "Amazon Web Services",
      avg_amount: 45.2,
      occurrences: 6,
      interval_days_avg: 30,
      interval_stddev: 2.5,
      currency: "USD",
      frequency: "monthly",
      last_date: dates.today,
      next_estimated_date: dates.past2,
      category: "services",
      confidence_score: 85,
      source_email_consistent: false,
    },
  ];
}

const MOCK_TRANSACTIONS: MockTransaction[] = [
  {
    title: "Payment to Uber",
    category: "Transport • Uber",
    date: "Today",
    amount: "-$12.40",
    currency: "USD",
    color: "text-rose-600",
  },
  {
    title: "CloudSafe annual plan",
    category: "Services • CloudSafe",
    date: "Feb 28",
    amount: "-$99",
    currency: "USD",
    color: "text-rose-600",
  },
  {
    title: "Salary Deposit",
    category: "Income • Acme Corp",
    date: "Oct 24",
    amount: "+$3,200.00",
    currency: "USD",
    color: "text-emerald-500",
  },
];

// ─── Sub-components ─────────────────────────────────────────────────────────

function HeroBadge() {
  const { t } = useTranslation();
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--text-secondary)]/20 text-[var(--text-secondary)] mb-8"
    >
      <Sparkles size={16} className="text-[var(--accent)]" />
      <span className="text-sm font-medium">{t("landing.hero.badge")}</span>
    </m.div>
  );
}

function HeroHeadline() {
  const { t } = useTranslation();
  return (
    <m.h1
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: 0.1,
      }}
      className="text-5xl sm:text-6xl md:text-7xl font-semibold text-[var(--text-primary)] tracking-tight mb-8"
    >
      {t("landing.hero.titlePart1")} <br className="hidden sm:block" />
      <span className="text-[var(--primary)]">
        {t("landing.hero.titlePart2")}
      </span>
    </m.h1>
  );
}

function HeroDescription() {
  const { t } = useTranslation();
  return (
    <m.p
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: 0.2,
      }}
      className="text-xl sm:text-2xl text-[var(--text-secondary)] mb-10 max-w-2xl mx-auto leading-relaxed"
    >
      {t("landing.hero.description")}
    </m.p>
  );
}

function HeroCtaButtons() {
  const { t } = useTranslation();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: 0.3,
      }}
      className="flex flex-col sm:flex-row items-center justify-center gap-4"
    >
      <Link
        to="/register"
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 bg-[var(--button-primary)] hover:bg-[var(--button-primary-hover)] text-white rounded-xl font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] shadow-lg hover:shadow-xl hover:-translate-y-1"
      >
        {t("landing.hero.getStarted")}
        <ArrowRight size={20} />
      </Link>
      <Link
        to="https://federicodeniard-receiptle.mintlify.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full sm:w-auto flex items-center justify-center px-8 py-4 bg-[var(--bg-secondary)] hover:bg-zinc-100 text-[var(--text-primary)] border border-[var(--text-secondary)]/20 rounded-xl font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform]"
      >
        {t("landing.hero.readDocs")}
      </Link>
    </m.div>
  );
}

function SubscriptionsMockPanel({
  mockDates,
}: {
  mockDates: ReturnType<typeof buildMockDates>;
}) {
  const { t } = useTranslation();
  const subscriptions = buildMockSubscriptions(mockDates);

  return (
    <m.div
      key="subscriptions"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0 p-8 pb-12 opacity-90 pointer-events-none select-none flex flex-col gap-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
            {t("navigation.subscriptions", "Subscriptions")}
          </h2>
          <p className="text-[var(--text-secondary)]">
            {t(
              "subscriptions.emptyDescription",
              "Automatic detection and tracking"
            )}
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-sm text-[var(--text-secondary)]">
            Total (Monthly)
          </div>
          <div className="text-xl font-bold text-[var(--text-primary)]">
            $71.18
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {subscriptions.map(sub => (
          <SubscriptionListItem key={sub.merchant_normalized} candidate={sub} />
        ))}
      </div>
    </m.div>
  );
}

function TransactionsMockPanel() {
  const { t } = useTranslation();
  return (
    <m.div
      key="transactions"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0 p-8 pb-12 opacity-90 pointer-events-none select-none flex flex-col gap-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
            {t("navigation.transactions", "Transactions")}
          </h2>
          <p className="text-[var(--text-secondary)]">
            {t("landing.features.gmail.title", "Recent Expenses")}
          </p>
        </div>
        <div className="text-right hidden sm:block">
          <div className="text-sm text-[var(--text-secondary)]">Balance</div>
          <div className="text-xl font-bold text-emerald-600">+$2,450.00</div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {MOCK_TRANSACTIONS.map(tx => (
          <div
            key={tx.title}
            className="relative p-4 rounded-2xl transition-[color,background-color,border-color,box-shadow,opacity,transform] shadow-sm bg-white border border-[var(--text-secondary)]/10 hover:bg-zinc-50"
          >
            <div className="relative flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate text-[var(--text-primary)]">
                  {tx.title}
                </h3>
                <p className="text-sm truncate text-[var(--text-secondary)]">
                  {tx.category}
                </p>
                <p className="text-xs mt-0.5 text-zinc-400">{tx.date}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-lg font-bold block ${tx.color}`}>
                  {tx.amount}
                </span>
                <span className="text-xs block text-zinc-400">
                  {tx.currency}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </m.div>
  );
}

function HeroMockup({
  activeTab,
  setActiveTab,
  mockDates,
}: {
  activeTab: number;
  setActiveTab: React.Dispatch<React.SetStateAction<number>>;
  mockDates: ReturnType<typeof buildMockDates>;
}) {
  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveTab(prev => (prev === 0 ? 1 : 0));
    }, 5000);
    return () => window.clearInterval(interval);
  }, [setActiveTab]);

  return (
    <m.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: 0.5,
      }}
      className="mt-20 relative max-w-5xl mx-auto"
    >
      <div className="absolute inset-0 bg-linear-to-t from-[var(--bg-primary)] via-transparent to-transparent z-10 pointer-events-none" />
      <div className="relative rounded-2xl border border-[var(--text-secondary)]/20 bg-[var(--bg-secondary)] shadow-2xl overflow-hidden h-[500px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--text-secondary)]/10 bg-white/50 relative z-20">
          <div className="size-3 rounded-full bg-red-400" />
          <div className="size-3 rounded-full bg-amber-400" />
          <div className="size-3 rounded-full bg-green-400" />
        </div>

        <div className="relative w-full h-[calc(100%-49px)] overflow-hidden">
          <AnimatePresence initial={false}>
            {activeTab === 0 ? (
              <SubscriptionsMockPanel
                key="subscriptions"
                mockDates={mockDates}
              />
            ) : (
              <TransactionsMockPanel key="transactions" />
            )}
          </AnimatePresence>
        </div>
      </div>
    </m.div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function HeroSection() {
  const [activeTab, setActiveTab] = useState(0);
  const [mockDates] = useState(buildMockDates);

  return (
    <LazyMotion features={domAnimation}>
      <div className="relative overflow-hidden bg-[var(--bg-primary)] pt-16 sm:pt-24 lg:pt-32 pb-16">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 size-96 bg-[var(--accent)] rounded-full mix-blend-multiply filter blur-[128px] opacity-20 animate-pulse" />
          <div className="absolute top-40 -left-40 size-96 bg-[var(--primary)] rounded-full mix-blend-multiply filter blur-[128px] opacity-10" />
        </div>

        <div className="relative container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto">
            <HeroBadge />
            <HeroHeadline />
            <HeroDescription />
            <HeroCtaButtons />
          </div>

          <HeroMockup
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            mockDates={mockDates}
          />
        </div>
      </div>
    </LazyMotion>
  );
}
