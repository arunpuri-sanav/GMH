import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

export default function PerformanceAudit({
  started,
  sessionTick,
  performanceTotals,
  totalDeliveredOrders,
}) {
  const [showModal, setShowModal] = useState(false);
  const wasStarted = useRef(started);

  useEffect(() => {
    if (wasStarted.current && !started) {
      setShowModal(true);
    }
    wasStarted.current = started;
  }, [started]);

  const stats = useMemo(() => {
    const timeSavedSeconds = Number(performanceTotals?.timeSavedSeconds || 0);
    const fuelSavedLiters = Number(performanceTotals?.fuelSavedLiters || 0);
    const carbonSavedKg = Number(performanceTotals?.carbonSavedKg || 0);
    const sessionHours = Math.max(Number(sessionTick || 0) * 2 / 3600, 0.01);
    const ordersPerHourBase = Math.max(totalDeliveredOrders / sessionHours, 0);
    const improvementFactor = timeSavedSeconds > 0 ? 1 + Math.min(timeSavedSeconds / 3600, 0.75) : 1;
    const ordersPerHourIncrease = ordersPerHourBase * (improvementFactor - 1);

    const fuelCostPerLiter = 2.1;
    const monthlySavings = fuelSavedLiters * fuelCostPerLiter * 26;

    return {
      timeSavedSeconds,
      fuelSavedLiters,
      carbonSavedKg,
      ordersPerHourIncrease,
      monthlySavings,
    };
  }, [performanceTotals, sessionTick, totalDeliveredOrders]);

  return html`
    <div>
      <div className="mt-3 rounded-lg border border-white/20 bg-black/30 p-3 text-xs">
        <div className="mb-1 text-slate-300">Performance Audit</div>
        <div className="mb-2 text-[11px] text-slate-400">
          Delta: Legacy Car Routing vs Grab Motorcycle Routing
        </div>
        <div className="text-[11px] text-slate-200">
          Total Time Saved:
          <span className="text-emerald-300">${Math.round(stats.timeSavedSeconds / 60)} min</span>
        </div>
        <div className="text-[11px] text-slate-200">
          Fuel/Carbon Saved:
          <span className="text-emerald-300">
            ${stats.fuelSavedLiters.toFixed(1)} L / ${stats.carbonSavedKg.toFixed(1)} kg CO2
          </span>
        </div>
        <div className="text-[11px] text-slate-200">
          Orders Per Hour Increase:
          <span className="text-emerald-300">${stats.ordersPerHourIncrease.toFixed(2)}</span>
        </div>
      </div>

      ${showModal
        ? html`
            <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
              <div className="w-full max-w-lg rounded-xl border border-white/20 bg-slate-950 p-5 text-white shadow-2xl">
                <h3 className="text-lg font-semibold">Business Case</h3>
                <p className="mt-2 text-sm text-slate-200">
                  Using GrabMaps saved your fleet $${formatMoney(
                    stats.monthlySavings,
                  )} per month compared to standard mapping.
                </p>
                <button
                  className="mt-4 rounded-lg bg-cyan-700/70 px-3 py-2 text-sm font-semibold"
                  onClick=${() => setShowModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          `
        : null}
    </div>
  `;
}
