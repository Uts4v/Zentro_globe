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
    <div className="grid w-full grid-cols-3 gap-0.5 rounded-full bg-mist p-0.5">
      {options.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`flex min-w-0 items-center justify-center gap-1 rounded-full py-1.5 px-1 text-[11px] font-medium leading-none tracking-tight transition-all ${
              active
                ? "bg-background text-foreground shadow-soft font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-background/40"
            }`}
            title={`${label} theme`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className={compact ? "hidden" : "whitespace-nowrap"}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
