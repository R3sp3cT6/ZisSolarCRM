"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t } from "@/lib/i18n/mk";

interface YearSelectorProps {
  defaultValue: string;
}

export function YearSelector({ defaultValue }: YearSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentYear = searchParams.get("year") || defaultValue;
  const currentYearNum = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) =>
    String(currentYearNum - i)
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {t.production.selectYear}:
      </span>
      <Select
        value={currentYear}
        onValueChange={(value: string | null) => {
          if (!value) return;
          const params = new URLSearchParams(searchParams.toString());
          params.set("year", value);
          router.push(`?${params.toString()}`);
        }}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => (
            <SelectItem key={year} value={year}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
