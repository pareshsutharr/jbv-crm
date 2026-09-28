"use client";

import type { NotificationType } from "@prisma/client";
import clsx from "clsx";
import { AlarmClock, CalendarClock, CheckSquare, Rocket, ShieldCheck, UserCheck, UserPlus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

const ICONS: Record<NotificationType, LucideIcon> = {
  KYC_STATUS: ShieldCheck,
  LEAD_ASSIGNED: UserPlus,
  CLIENT_ASSIGNED: UserPlus,
  TASK_ASSIGNED: CheckSquare,
  TASK_DUE: AlarmClock,
  MANDATE_STAGE: Rocket,
  MANDATE_DUE: CalendarClock,
  USER_JOINED: UserCheck,
};

type N = { id: string; type: NotificationType; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export function NotificationRow({ n }: { n: N }) {
  const router = useRouter();
  const Icon = ICONS[n.type];
  async function setRead(read: boolean) {
    await api(`/api/notifications/${n.id}`, "PATCH", { read });
    router.refresh();
  }
  return (
    <li className={clsx("flex items-start gap-3 px-5 py-3.5", !n.readAt && "bg-brand-50/40")} data-testid="notification" data-read={!!n.readAt}>
      <span className={clsx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", n.readAt ? "bg-gray-100 text-gray-400" : "bg-brand-100 text-brand-700")}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        {n.link ? (
          <Link href={n.link} onClick={() => !n.readAt && setRead(true)} className={clsx("text-sm hover:underline", n.readAt ? "text-gray-700" : "font-semibold text-gray-900")}>
            {n.title}
          </Link>
        ) : (
          <p className={clsx("text-sm", n.readAt ? "text-gray-700" : "font-semibold text-gray-900")}>{n.title}</p>
        )}
        {n.body && <p className="text-xs text-gray-500">{n.body}</p>}
        <p className="mt-0.5 text-[11px] text-gray-400">{formatDateTime(n.createdAt)}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setRead(!n.readAt)}>
        {n.readAt ? "Mark unread" : "Mark read"}
      </Button>
    </li>
  );
}

export function NotificationActions({ unread }: { unread: number }) {
  const router = useRouter();
  if (!unread) return null;
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await api("/api/notifications/read-all", "POST");
        router.refresh();
      }}
    >
      Mark all as read
    </Button>
  );
}
