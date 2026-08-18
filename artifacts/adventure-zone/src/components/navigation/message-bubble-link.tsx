import { MessageCircle } from "lucide-react";
import { Link } from "wouter";

export function MessageBubbleLink({
  href,
  label,
  unreadCount,
  className = "",
}: {
  href: string;
  label: string;
  unreadCount: number;
  className?: string;
}) {
  const count = Math.max(0, unreadCount || 0);
  const badge = count > 9 ? "9+" : String(count);
  const accessibleLabel = count ? `${label}, ${count} unread` : label;

  return (
    <Link
      aria-label={accessibleLabel}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700 ${className}`}
      href={href}
      title={label}
    >
      <MessageCircle className="h-5 w-5" />
      {count ? (
        <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
