import type { ReactNode } from "react";
import { AuthIllustration } from "./AuthIllustration";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-dvh flex bg-white">
      {/* Left Side - Form */}
      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="w-full">{children}</div>
      </div>

      {/* Right Side - Illustration */}
      <AuthIllustration />
    </div>
  );
}
