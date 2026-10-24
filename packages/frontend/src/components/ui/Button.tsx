import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  selected?: boolean;
}

type Variant = NonNullable<ButtonProps["variant"]>;
type Size = NonNullable<ButtonProps["size"]>;

const baseClasses =
  "inline-flex items-center justify-center font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses = {
  primary:
    "bg-[var(--button-primary)] text-white hover:bg-[var(--button-primary-hover)] focus:ring-[var(--primary-focus)]",
  secondary:
    "bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--text-secondary)]/20 hover:bg-[var(--text-secondary)]/10 focus:ring-[var(--text-secondary)]",
  outline:
    "bg-transparent text-[var(--button-primary)] border border-[var(--button-primary)] hover:bg-[var(--button-primary)] hover:text-white focus:ring-[var(--button-primary)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus:ring-[var(--text-secondary)]",
  danger: "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-300",
};

const sizeClasses = {
  sm: "px-3 py-2 text-sm rounded-md",
  md: "px-4 py-3 text-sm rounded-lg",
  lg: "px-6 py-4 text-base rounded-lg",
};

function variantClassesFor(variant: Variant, selected: boolean): string {
  if (selected && variant === "outline") return variantClasses.primary;
  return variantClasses[variant];
}

function iconSizeFor(size: Size): number {
  if (size === "sm") return 16;
  if (size === "lg") return 20;
  return 18;
}

function resolveIcon(
  loading: boolean,
  icon: React.ReactNode,
  size: Size
): React.ReactNode {
  if (!loading) return icon;
  return <Loader2 className="animate-spin" size={iconSizeFor(size)} />;
}

function ButtonContent({
  icon,
  iconPosition,
  children,
}: {
  icon: React.ReactNode;
  iconPosition: "left" | "right";
  children: React.ReactNode;
}) {
  if (!icon) return <>{children}</>;
  if (iconPosition === "left") {
    return (
      <>
        {icon}
        {children && <span className="ml-2">{children}</span>}
      </>
    );
  }
  return (
    <>
      {children && <span className="mr-2">{children}</span>}
      {icon}
    </>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  iconPosition = "left",
  fullWidth = false,
  selected = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const widthClasses = fullWidth ? "w-full" : "";
  const classes = `${baseClasses} ${variantClassesFor(variant, selected)} ${sizeClasses[size]} ${widthClasses} ${className}`;
  const iconNode = resolveIcon(loading, icon, size);

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      <ButtonContent icon={iconNode} iconPosition={iconPosition}>
        {children}
      </ButtonContent>
    </button>
  );
}
