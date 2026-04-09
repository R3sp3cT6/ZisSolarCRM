"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { t } from "@/lib/i18n/mk";

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<{
    name: string;
    email: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    async function fetchUser() {
      const res = await fetch("/api/users");
      if (res.ok) {
        const users = await res.json();
        const found = users.find(
          (u: { id: number }) => String(u.id) === params.id
        );
        if (found) setUser(found);
      }
    }
    fetchUser();
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const body: Record<string, string | undefined> = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      role: formData.get("role") as string,
    };

    const password = formData.get("password") as string;
    if (password) body.password = password;

    const res = await fetch(`/api/users/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      router.push("/users");
    } else {
      const data = await res.json();
      setError(data.error || "Грешка при ажурирање");
    }
    setLoading(false);
  }

  if (!user) return <div className="text-center py-10">{t.actions.loading}</div>;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" render={<Link href="/users" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold">{t.users.editUser}</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.users.name}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t.users.email}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={user.email}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.users.newPassword}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Остави празно ако не менуваш"
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">{t.users.role}</Label>
              <Select name="role" defaultValue={user.role}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t.users.admin}</SelectItem>
                  <SelectItem value="viewer">{t.users.viewer}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? t.actions.loading : t.actions.save}
              </Button>
              <Button variant="outline" render={<Link href="/users" />}>
                {t.actions.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
