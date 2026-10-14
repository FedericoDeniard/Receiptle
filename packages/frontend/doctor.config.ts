import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    files: ["src/components/ai-elements/**", "src/components/ui/shadcn/**"],
    overrides: [
      {
        files: ["src/components/assistant/ChatPanel.tsx"],
        rules: [
          "react-doctor/no-event-handler",
          "react-doctor/no-prop-callback-in-effect",
          "react-doctor/no-pass-data-to-parent",
          "react-doctor/no-giant-component",
        ],
      },
      {
        files: ["src/pages/Home.tsx"],
        rules: ["react-doctor/no-pass-data-to-parent"],
      },
      {
        files: [
          "src/components/notifications/NotificationsPanel.tsx",
          "src/pages/Metrics.tsx",
        ],
        rules: ["react-doctor/no-high-complexity-react-function"],
      },
    ],
  },
});
