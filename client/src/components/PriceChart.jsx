import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';
import { useTheme } from '../context/ThemeContext';

function chartColors(dark) {
  return dark
    ? { bg: '#1f2937', text: '#9ca3af', grid: '#374151', border: '#4b5563' }
    : { bg: '#ffffff',  text: '#6b7280', grid: '#f3f4f6', border: '#e5e7eb' };
}

export default function PriceChart({ history, contractId, onPriceUpdate }) {
  const { dark } = useTheme();
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  // Sync chart colours whenever theme toggles
  useEffect(() => {
    if (!chartRef.current) return;
    const c = chartColors(dark);
    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: {
        vertLines: { color: c.grid, style: LineStyle.Dotted },
        horzLines: { color: c.grid, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale:        { borderColor: c.border },
    });
  }, [dark]);

  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(darkRef.current);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.text,
      },
      grid: {
        vertLines: { color: c.grid, style: LineStyle.Dotted },
        horzLines: { color: c.grid, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: c.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: true,  // sparse price history can have points in the same minute; showing seconds keeps ticks distinct
      },
      crosshair: { mode: 1 },
      width: containerRef.current.clientWidth,
      height: 240,
    });

    const series = chart.addLineSeries({
      color: '#2e7d32',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      priceLineVisible: true,
    });

    // Price scale locked to 0-100 — probabilities can't go outside that range,
    // so we override the autoscale calculation with a fixed range every frame.
    // (Setting autoScale:false instead would freeze the range at construction
    // time — before any data lands — and ignore the provider entirely.)
    series.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth || 0 });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // Load initial history
  useEffect(() => {
    if (!seriesRef.current || !history?.length) return;
    const data = history.map((h, i) => ({
      time: Math.floor(new Date(h.timestamp).getTime() / 1000) + i, // ensure unique timestamps
      value: h.price,
    }));
    // Deduplicate by time (keep last)
    const seen = new Map();
    data.forEach(d => seen.set(d.time, d));
    seriesRef.current.setData([...seen.values()].sort((a, b) => a.time - b.time));
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  // Expose update function via callback
  useEffect(() => {
    if (!onPriceUpdate) return;
    onPriceUpdate((price) => {
      if (!seriesRef.current) return;
      const time = Math.floor(Date.now() / 1000);
      seriesRef.current.update({ time, value: price });
    });
  }, [onPriceUpdate]);

  return <div ref={containerRef} className="chart-container rounded-xl overflow-hidden" />;
}
