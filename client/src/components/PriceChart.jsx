import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';

export default function PriceChart({ history, contractId, onPriceUpdate }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: '#f3f4f6', style: LineStyle.Dotted },
        horzLines: { color: '#f3f4f6', style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: '#e5e7eb',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
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

    // Price scale 0-100
    chart.priceScale('right').applyOptions({ autoScale: false });
    series.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });

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
