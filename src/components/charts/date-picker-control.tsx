"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

interface DatePickerControlProps {
  type: "date" | "month";
  paramName: string;
  defaultValue: string;
  label: string;
}

export function DatePickerControl({
  type,
  paramName,
  defaultValue,
  label,
}: DatePickerControlProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentValue = searchParams.get(paramName) || defaultValue;

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, value);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}:</span>
      <Input
        type={type}
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-auto"
      />
    </div>
  );
}
