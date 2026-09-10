"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// Maps combo model strings → combo names, from GET /api/combos.
// Rows pass their full model string ("prefix/model"); a model can live in
// multiple combos (each combo chip is rendered, truncated with +N overflow).
export function useComboMembership(fullModel) {
  const [combos, setCombos] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/combos");
        const data = await res.json();
        if (cancelled) return;
        const all = data.combos || [];
        const names = fullModel
          ? all.filter((c) => Array.isArray(c.models) && c.models.includes(fullModel)).map((c) => c.name)
          : [];
        setCombos(names);
      } catch {
        if (!cancelled) setCombos([]);
      }
    };
    load();
    const handleChanged = () => load();
    window.addEventListener("combosChanged", handleChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("combosChanged", handleChanged);
    };
  }, [fullModel]);

  return combos;
}

const CHIP_MAX = 2;

export default function ComboMembershipChips({ fullModel }) {
  const combos = useComboMembership(fullModel);
  if (combos === null) return null;

  const shown = combos.slice(0, CHIP_MAX);
  const overflow = combos.length - shown.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((name) => (
        <Link
          key={name}
          href="/dashboard/combos"
          title={`In combo: ${name}`}
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border text-primary bg-primary/10 border-primary/30 hover:bg-primary/20 transition-colors"
        >
          {name}
        </Link>
      ))}
      {overflow > 0 && (
        <span
          title={`Also in: ${combos.slice(CHIP_MAX).join(", ")}`}
          className="inline-flex items-center text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border text-primary bg-primary/10 border-primary/30"
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

ComboMembershipChips.propTypes = {
  fullModel: PropTypes.string,
};
