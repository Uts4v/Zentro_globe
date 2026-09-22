import { useTheme } from "@/lib/theme";
import { Moon, Sun, Monitor } from "lucide-react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];

  return (
    <div className={`flex gap-1 rounded-full bg-mist p-1 ${compact ? "w-full" : ""}`}>
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-all ${
            compact ? "flex-1 px-1.5" : "px-3"
          } ${theme === value ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className={compact ? "hidden" : "hidden sm:inline"}>{label}</span>
        </button>
      ))}
    </div>
  );
}
