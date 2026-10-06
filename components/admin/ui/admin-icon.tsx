import {
  AllocateIcon,
  CalendarIcon,
  CanvassIcon,
  CoverageIcon,
  InsightsIcon,
  LeadsIcon,
  MapIcon,
  SettingsIcon,
  TeamIcon,
  TodayIcon,
} from "@/components/field/icons";
import type { AdminIconName } from "@/lib/admin/nav";

/** UI-10 F1b. Nav icon by name, so `lib/admin/nav.ts` stays free of React. */
export function AdminIcon({ name, className }: { name: AdminIconName; className?: string }) {
  switch (name) {
    case "today":
      return <TodayIcon className={className} />;
    case "calendar":
      return <CalendarIcon className={className} />;
    case "props":
      return <MapIcon className={className} />;
    case "team":
      return <TeamIcon className={className} />;
    case "leads":
      return <LeadsIcon className={className} />;
    case "coverage":
      return <CoverageIcon className={className} />;
    case "insights":
      return <InsightsIcon className={className} />;
    case "allocate":
      return <AllocateIcon className={className} />;
    case "canvass":
      return <CanvassIcon className={className} />;
    case "settings":
      return <SettingsIcon className={className} />;
  }
}
