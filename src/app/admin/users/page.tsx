"use client";

import { useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string | null;
  role: "admin" | "viewer";
  products: string[];
}

const PRODUCTS = [
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
] as const;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/users")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setUsers(json.users);
      })
      .catch(() => setError("Something went wrong loading users."));
  }, []);

  async function toggleProduct(user: UserRow, product: string) {
    const nextProducts = user.products.includes(product)
      ? user.products.filter((p) => p !== product)
      : [...user.products, product];

    setSavingId(user.id);
    setUsers((prev) =>
      prev ? prev.map((u) => (u.id === user.id ? { ...u, products: nextProducts } : u)) : prev
    );

    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: nextProducts }),
    });
    setSavingId(null);

    if (!res.ok) {
      // Revert on failure.
      setUsers((prev) =>
        prev ? prev.map((u) => (u.id === user.id ? { ...u, products: user.products } : u)) : prev
      );
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Could not save that change.");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10 max-w-3xl mx-auto w-full">
      <h1 className="font-heading text-2xl font-semibold">Users</h1>
      <p className="text-sm text-offwhite/60">
        Choose which document sets each person can see and search. Admins always have
        access to everything, regardless of what's checked here.
      </p>

      {error && <p className="font-mono text-sm text-amber">Error — {error}</p>}

      {!users && !error && <p className="text-sm text-offwhite/50">Loading…</p>}

      {users && (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-4 rounded border border-cyan/20 px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-offwhite">{u.email}</span>
                <span className="font-mono text-xs text-offwhite/40">
                  {u.role === "admin" ? "Admin — full access" : "Viewer"}
                </span>
              </div>
              {u.role !== "admin" && (
                <div className="flex items-center gap-4">
                  {PRODUCTS.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={u.products.includes(p.key)}
                        disabled={savingId === u.id}
                        onChange={() => toggleProduct(u, p.key)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
