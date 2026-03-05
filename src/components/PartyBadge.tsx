import { PARTY_COLORS } from "@/lib/mock-data";

interface PartyBadgeProps {
  party: string;
  size?: "sm" | "md";
}

export function PartyBadge({ party, size = "sm" }: PartyBadgeProps) {
  const color = PARTY_COLORS[party] ?? "#888";
  const cls = size === "sm"
    ? "text-[10px] font-bold px-1.5 py-0.5 rounded-full"
    : "text-xs font-bold px-2 py-0.5 rounded-full";

  return (
    <span
      className={cls}
      style={{
        color,
        background: color + "18",
        border: `1px solid ${color}40`,
      }}
    >
      {party}
    </span>
  );
}
