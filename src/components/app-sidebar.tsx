"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Sun,
  Calendar,
  CalendarRange,
  Users,
  LogOut,
  Zap,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
  SidebarRail,
} from "@/components/ui/sidebar";
import { t } from "@/lib/i18n/mk";

const navItems = [
  {
    title: t.nav.dashboard,
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: t.nav.daily,
    url: "/dashboard/daily",
    icon: Sun,
  },
  {
    title: t.nav.monthly,
    url: "/dashboard/monthly",
    icon: Calendar,
  },
  {
    title: t.nav.yearly,
    url: "/dashboard/yearly",
    icon: CalendarRange,
  },
  {
    title: t.nav.stations,
    url: "/dashboard/stations",
    icon: Zap,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image
            src="/zis-logo.png"
            alt="ZIS Solar"
            width={40}
            height={40}
            className="shrink-0"
          />
          <div className="group-data-[collapsible=icon]:hidden">
            <h2 className="font-bold text-lg leading-tight">ZIS Solar</h2>
            <p className="text-xs text-muted-foreground">Мониторинг</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Продукција</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    render={<Link href={item.url} />}
                    isActive={pathname === item.url}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Администрација</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/users" />}
                    isActive={pathname.startsWith("/users")}
                    tooltip={t.nav.users}
                  >
                    <Users />
                    <span>{t.nav.users}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm truncate group-data-[collapsible=icon]:hidden">
            <p className="font-medium truncate">{session?.user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {session?.user?.email}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title={t.nav.logout}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
