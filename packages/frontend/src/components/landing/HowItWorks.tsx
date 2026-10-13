import { LazyMotion, m, domAnimation } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, MailCheck, Cpu, BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function HowItWorks() {
  const { t } = useTranslation();

  const steps = [
    {
      number: "01",
      icon: MailCheck,
      title: t("landing.howItWorks.step1.title"),
      description: t("landing.howItWorks.step1.description"),
    },
    {
      number: "02",
      icon: Cpu,
      title: t("landing.howItWorks.step2.title"),
      description: t("landing.howItWorks.step2.description"),
    },
    {
      number: "03",
      icon: BarChart3,
      title: t("landing.howItWorks.step3.title"),
      description: t("landing.howItWorks.step3.description"),
    },
  ];

  return (
    <section className="py-24 bg-white border-y border-[var(--text-secondary)]/10 relative overflow-hidden">
      {/* Background visual */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-linear-to-l from-[var(--bg-secondary)] to-transparent opacity-50" />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl relative z-10">
        <LazyMotion features={domAnimation}>
          <div className="flex flex-col lg:flex-row gap-16 items-center">
            <div className="w-full lg:w-1/2">
              <m.div
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <h2 className="text-3xl md:text-4xl font-semibold text-[var(--text-primary)] mb-6">
                  {t("landing.howItWorks.title")}
                </h2>
                <p className="text-lg text-[var(--text-secondary)] mb-10 leading-relaxed max-w-lg">
                  {t("landing.howItWorks.description")}
                </p>

                <div className="space-y-10">
                  {steps.map((step, idx) => (
                    <div key={step.number} className="flex gap-6 relative">
                      {/* Connecting line */}
                      {idx !== steps.length - 1 && (
                        <div className="absolute left-6 top-14 w-px h-[calc(100%-24px)] bg-[var(--text-secondary)]/20" />
                      )}

                      <div className="size-12 rounded-full bg-[var(--primary)] text-white flex items-center justify-center shrink-0 font-bold z-10 shadow-md">
                        {step.number}
                      </div>

                      <div>
                        <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
                          {step.title}
                          <step.icon
                            size={18}
                            className="text-[var(--text-secondary)]"
                          />
                        </h3>
                        <p className="text-[var(--text-secondary)] leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </m.div>
            </div>

            <div className="w-full lg:w-1/2">
              <m.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                  delay: 0.2,
                }}
                className="bg-[var(--primary)] rounded-3xl p-10 lg:p-12 text-center text-white shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 size-64 bg-[var(--accent)] rounded-full mix-blend-multiply filter blur-[80px] opacity-30" />

                <div className="relative z-10">
                  <h3 className="text-3xl font-semibold mb-6">
                    {t("landing.howItWorks.cta.title")}
                  </h3>
                  <p className="text-zinc-300 mb-8 text-lg">
                    {t("landing.howItWorks.cta.description")}
                  </p>
                  <Link
                    to="/register"
                    className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-[var(--primary)] hover:bg-zinc-100 rounded-xl font-bold transition-[color,background-color,border-color,box-shadow,opacity,transform] w-full sm:w-auto hover:scale-105"
                  >
                    {t("landing.howItWorks.cta.button")}
                    <ArrowRight size={20} />
                  </Link>
                  <p className="mt-6 text-sm text-zinc-400">
                    {t("landing.howItWorks.cta.footer")}
                  </p>
                </div>
              </m.div>
            </div>
          </div>
        </LazyMotion>
      </div>
    </section>
  );
}
