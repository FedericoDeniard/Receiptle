import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { DecorativeSquare } from "../components/ui/DecorativeSquare";
import logo from "../logo.svg";

const CURRENT_YEAR = new Date().getFullYear();
const LAST_UPDATED = new Date("2026-07-08");

// Module-scope cache for Intl.DateTimeFormat instances, keyed by locale.
// Building one is expensive; reuse across renders and across components.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};
function formatLastUpdated(locale: string, date: Date): string {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, DATE_FORMAT_OPTIONS);
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-6 space-y-1.5 text-[var(--text-secondary)] leading-relaxed">
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PrivacyPolicy() {
  const { t, i18n } = useTranslation();

  const lastUpdatedFormatted = formatLastUpdated(i18n.language, LAST_UPDATED);

  return (
    <div className="min-h-dvh bg-[var(--bg-primary)] flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-[var(--text-secondary)]/10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3">
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
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="grow container mx-auto px-4 sm:px-6 lg:px-8 py-12 max-w-3xl">
        <h1 className="text-3xl font-semibold text-[var(--text-primary)] mb-2">
          {t("privacy.title")}
        </h1>
        <p className="text-sm text-[var(--text-secondary)]/60 mb-10">
          {t("privacy.lastUpdated", { date: lastUpdatedFormatted })}
        </p>

        <Section title={t("privacy.controller.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.controller.content")}
          </p>
        </Section>

        <Section title={t("privacy.dataCollected.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
            {t("privacy.dataCollected.intro")}
          </p>
          <List
            items={t("privacy.dataCollected.items", { returnObjects: true })}
          />
        </Section>

        <Section title={t("privacy.purpose.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.purpose.content")}
          </p>
        </Section>

        <Section title={t("privacy.gmailIntegration.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
            {t("privacy.gmailIntegration.content")}
          </p>
        </Section>

        <Section title={t("privacy.googleLimitedUse.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.googleLimitedUse.content")}
          </p>
        </Section>

        <Section title={t("privacy.thirdParties.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
            {t("privacy.thirdParties.intro")}
          </p>
          <List
            items={t("privacy.thirdParties.items", { returnObjects: true })}
          />
        </Section>

        <Section title={t("privacy.security.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.security.content")}
          </p>
        </Section>

        <Section title={t("privacy.localStorage.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.localStorage.content")}
          </p>
        </Section>

        <Section title={t("privacy.pushNotifications.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.pushNotifications.content")}
          </p>
        </Section>

        <Section title={t("privacy.retention.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.retention.content")}
          </p>
        </Section>

        <Section title={t("privacy.rights.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
            {t("privacy.rights.intro")}
          </p>
          <List items={t("privacy.rights.items", { returnObjects: true })} />
        </Section>

        <Section title={t("privacy.contact.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.contact.content")}
          </p>
        </Section>

        <Section title={t("privacy.changes.title")}>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            {t("privacy.changes.content")}
          </p>
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--text-secondary)]/10 py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-[var(--text-secondary)]/60">
          &copy; {CURRENT_YEAR} Receiptle.
        </div>
      </footer>
    </div>
  );
}
