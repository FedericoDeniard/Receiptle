import { useReducer } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getSupabase } from "../../lib/supabase";
import { loginSchema, registerSchema } from "../../lib/forms/schemas";
import type { LoginFormData, RegisterFormData } from "../../lib/forms/schemas";
import {
  Mail,
  Lock,
  AlertCircle,
  CheckCircle2,
  Banknote,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "../ui/Button";

interface AuthFormProps {
  initialIsSignUp?: boolean;
}

interface AuthFormState {
  loading: boolean;
  message: { type: "success" | "error"; text: string } | null;
  showPassword: boolean;
  showConfirmPassword: boolean;
  isSignUp: boolean;
}

type AuthFormAction =
  | { type: "SET_LOADING"; loading: boolean }
  | {
      type: "SET_MESSAGE";
      message: { type: "success" | "error"; text: string } | null;
    }
  | { type: "TOGGLE_PASSWORD" }
  | { type: "TOGGLE_CONFIRM_PASSWORD" }
  | { type: "SET_IS_SIGN_UP"; isSignUp: boolean };

function authFormReducer(
  state: AuthFormState,
  action: AuthFormAction
): AuthFormState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_MESSAGE":
      return { ...state, message: action.message };
    case "TOGGLE_PASSWORD":
      return { ...state, showPassword: !state.showPassword };
    case "TOGGLE_CONFIRM_PASSWORD":
      return { ...state, showConfirmPassword: !state.showConfirmPassword };
    case "SET_IS_SIGN_UP":
      return { ...state, isSignUp: action.isSignUp };
  }
}

function initAuthFormState(initialIsSignUp: boolean): AuthFormState {
  return {
    loading: false,
    message: null,
    showPassword: false,
    showConfirmPassword: false,
    isSignUp: initialIsSignUp,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function AuthHeader({ isSignUp }: { isSignUp: boolean }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-3xl font-semibold text-[var(--text-primary)] uppercase tracking-tight">
        {isSignUp ? t("auth.createAccount") : t("auth.welcomeBack")}
      </h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)] font-medium">
        {isSignUp ? t("auth.signUpDescription") : t("auth.signInDescription")}
      </p>
    </div>
  );
}

function MessageBanner({
  message,
}: {
  message: { type: "success" | "error"; text: string } | null;
}) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div
      className={`mt-4 rounded-lg p-4 flex items-start gap-3 ${
        message.type === "success"
          ? "bg-[var(--success)]/10 text-[var(--success)]"
          : "bg-[var(--error)]/10 text-[var(--error)]"
      }`}
    >
      {message.type === "success" ? (
        <CheckCircle2 className="size-5 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="size-5 shrink-0 mt-0.5" />
      )}
      <p className="text-sm font-medium">{message.text}</p>
    </div>
  );
}

function GoogleButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-6">
      <Button
        type="button"
        variant="outline"
        fullWidth
        size="md"
        icon={
          <svg className="size-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        }
        iconPosition="left"
        onClick={onClick}
        disabled={loading}
      >
        {t("auth.continueWithGoogle")}
      </Button>
    </div>
  );
}

function EmailInput({
  register,
}: {
  register: ReturnType<typeof useForm>["register"];
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label htmlFor="email" className="sr-only">
        {t("auth.email")}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[var(--text-secondary)]">
          <Mail className="size-5" />
        </div>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t("auth.email")}
          {...register("email")}
          className="block w-full pl-11 pr-3 py-3 border-0 bg-[var(--bg-secondary)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--primary-focus)] sm:text-sm font-medium transition-colors"
        />
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  placeholder,
  autoComplete,
  showPassword,
  onToggle,
  register,
}: {
  id: string;
  placeholder: string;
  autoComplete: string;
  showPassword: boolean;
  onToggle: () => void;
  register: ReturnType<typeof useForm>["register"];
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-[var(--text-secondary)]">
          <Lock className="size-5" />
        </div>
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          {...register(id === "password" ? "password" : "confirmPassword")}
          className="block w-full pl-11 pr-12 py-3 border-0 bg-[var(--bg-secondary)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--primary-focus)] sm:text-sm font-medium transition-colors"
        />
        <button
          type="button"
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          onClick={onToggle}
        >
          {showPassword ? (
            <EyeOff className="size-5" />
          ) : (
            <Eye className="size-5" />
          )}
        </button>
      </div>
    </div>
  );
}

function FormErrors({
  errors,
}: {
  errors: Record<string, { message?: string } | undefined>;
}) {
  const entries = Object.entries(errors).filter(
    ([, error]) => error?.message
  ) as [string, { message: string }][];
  if (!entries.length) return null;
  return (
    <div className="space-y-2">
      {entries.map(([fieldName, error]) => (
        <div
          key={fieldName}
          className="rounded-lg p-3 flex items-start gap-2 bg-[var(--error)]/10 text-[var(--error)]"
        >
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error.message}</p>
        </div>
      ))}
    </div>
  );
}

function AuthToggle({ isSignUp }: { isSignUp: boolean }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm font-medium text-[var(--text-secondary)]">
      {isSignUp
        ? t("auth.alreadyHaveAccount") + " "
        : t("auth.dontHaveAccount") + " "}
      <a
        href={isSignUp ? "/login" : "/register"}
        className="text-[var(--primary)] font-bold hover:text-[var(--primary-hover)]"
      >
        {isSignUp ? t("auth.signIn") : t("auth.signUp")}
      </a>
    </p>
  );
}

export function AuthForm({ initialIsSignUp = false }: AuthFormProps) {
  const { t } = useTranslation();

  const [state, dispatch] = useReducer(
    authFormReducer,
    initialIsSignUp,
    initAuthFormState
  );
  const { loading, message, showPassword, showConfirmPassword, isSignUp } =
    state;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData | RegisterFormData>({
    resolver: zodResolver(isSignUp ? registerSchema : loginSchema),
    mode: "onBlur",
  });

  const handleEmailAuth = async (data: LoginFormData | RegisterFormData) => {
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_MESSAGE", message: null });

    try {
      const supabase = await getSupabase();

      if (isSignUp) {
        const registerData = data as RegisterFormData;
        const { data: authData, error } = await supabase.auth.signUp({
          email: registerData.email,
          password: registerData.password,
        });
        if (error) throw error;

        if (authData.user && !authData.user.confirmed_at) {
          dispatch({
            type: "SET_MESSAGE",
            message: {
              type: "success",
              text: t("auth.registerSuccess"),
            },
          });
          dispatch({ type: "SET_IS_SIGN_UP", isSignUp: false });
        }
      } else {
        const loginData = data as LoginFormData;
        const { error } = await supabase.auth.signInWithPassword({
          email: loginData.email,
          password: loginData.password,
        });
        if (error) throw error;
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("errors.unknownError");
      dispatch({
        type: "SET_MESSAGE",
        message: {
          type: "error",
          text: t("auth.loginError", { errorMessage }),
        },
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  };

  const handleGoogleAuth = async () => {
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const supabase = await getSupabase();

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("errors.unknownError");
      dispatch({
        type: "SET_MESSAGE",
        message: {
          type: "error",
          text: errorMessage,
        },
      });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  };

  return (
    <>
      <div className="mb-12 flex items-center gap-2 text-[var(--text-primary)]">
        <Banknote className="size-6" />
        <span className="text-sm font-bold tracking-wider uppercase">
          Receiptle
        </span>
      </div>

      <AuthHeader isSignUp={isSignUp} />
      <MessageBanner message={message} />

      <div className="mt-8">
        <div className="mb-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--text-secondary)]/30" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                {t("common.or")}
              </span>
            </div>
          </div>

          <GoogleButton loading={loading} onClick={handleGoogleAuth} />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(handleEmailAuth)}>
          <EmailInput register={register} />

          <PasswordInput
            id="password"
            placeholder={t("auth.password")}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            showPassword={showPassword}
            onToggle={() => dispatch({ type: "TOGGLE_PASSWORD" })}
            register={register}
          />

          {isSignUp && (
            <PasswordInput
              id="confirmPassword"
              placeholder={t("auth.confirmPassword")}
              autoComplete="new-password"
              showPassword={showConfirmPassword}
              onToggle={() => dispatch({ type: "TOGGLE_CONFIRM_PASSWORD" })}
              register={register}
            />
          )}

          {!isSignUp && (
            <div className="flex items-center justify-end">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)]"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>
          )}

          <FormErrors errors={errors} />

          <div>
            <Button type="submit" loading={loading} fullWidth size="md">
              {loading
                ? t("common.loading")
                : isSignUp
                  ? t("auth.register")
                  : t("auth.login")}
            </Button>
          </div>
        </form>

        <div className="mt-6 text-center">
          <AuthToggle isSignUp={isSignUp} />
        </div>
      </div>
    </>
  );
}
