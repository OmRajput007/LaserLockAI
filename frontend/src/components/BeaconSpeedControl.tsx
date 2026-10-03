import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, Clock } from 'lucide-react';
import { satellitePovSync } from '../simulation/satellitePovSync';

export interface BeaconSpeedControlProps {
  currentSpeed?: number;
  onSpeedChange?: (speedKmh: number) => void;
  speedApplied?: boolean;
  className?: string;
  showPhysicalDetails?: boolean;
}

export const BEACON_SPEED_PRESETS = [
  { label: 'Static', value: 0, tag: 'Static (0 km/h)' },
  { label: 'Loiter', value: 150, tag: 'Loiter (150 km/h)' },
  { label: 'Cruise', value: 600, tag: 'Cruise (600 km/h)' },
  { label: 'Max', value: 1200, tag: 'Max (1200 km/h)' },
];

/**
 * Calculates physical time for 1 complete revolution around Earth (40,075 km)
 * at the given speed in km/h.
 */
export const formatBeaconRevolutionTime = (speedKmh: number): string => {
  if (speedKmh <= 0) return 'Static (Locked to Ground)';
  const totalSec = (40075.0 / speedKmh) * 3600.0;
  const hours = Math.floor(totalSec / 3600.0);
  const mins = Math.round((totalSec % 3600.0) / 60.0);
  return `${hours}h ${mins}m (${Math.round(totalSec).toLocaleString()}s)`;
};

export const BeaconSpeedControl: React.FC<BeaconSpeedControlProps> = ({
  currentSpeed = 150,
  onSpeedChange,
  speedApplied = false,
  className = '',
  showPhysicalDetails = true,
}) => {
  const [localSpeed, setLocalSpeed] = useState<number>(currentSpeed);
  const [internalApplied, setInternalApplied] = useState<boolean>(false);

  // Sync with prop when parent updates
  useEffect(() => {
    setLocalSpeed(currentSpeed);
  }, [currentSpeed]);

  // Sync with global satellitePovSync
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.beaconSpeedKmh !== undefined && data.beaconSpeedKmh !== localSpeed) {
        setLocalSpeed(data.beaconSpeedKmh);
      }
    });
    return unsub;
  }, [localSpeed]);

  const handleSpeedCommit = useCallback(
    (speed: number) => {
      setLocalSpeed(speed);
      setInternalApplied(true);
      setTimeout(() => setInternalApplied(false), 800);

      // Broadcast to Three.js simulation engine
      satellitePovSync.update({ beaconSpeedKmh: speed });

      // Notify parent callback if provided
      if (onSpeedChange) {
        onSpeedChange(speed);
      }
    },
    [onSpeedChange]
  );

  const isAppliedState = speedApplied || internalApplied;

  return (
    <div className={`bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 text-xs text-[#F0FFEA] ${className}`}>
      {/* Header with Title and Real-time Badge */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-[#F0FFEA] font-medium uppercase tracking-wider">
          <Gauge className="w-4 h-4 text-[#FF5F40]" />
          <span>Beacon Velocity Control</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-mono px-2.5 py-0.5 rounded transition border ${
              isAppliedState
                ? 'bg-[#FF5F40]/15 text-[#FF5F40] border-[#FF5F40]'
                : 'bg-[#262824] text-[#F0FFEA] border-[#33362F]'
            }`}
          >
            {isAppliedState ? '✓ APPLIED' : `${localSpeed} KM/H`}
          </span>
        </div>
      </div>

      {/* Speed Presets */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[#9CA195] text-xs uppercase tracking-wider">Presets:</span>
        {BEACON_SPEED_PRESETS.map(({ label, value, tag }) => {
          const isActive = localSpeed === value;
          return (
            <button
              key={label}
              onClick={() => handleSpeedCommit(value)}
              className={`px-2.5 py-1 rounded text-xs font-mono transition border ${
                isActive
                  ? 'bg-[#FF5F40] text-[#0A0A0A] border-[#FF5F40] font-semibold'
                  : 'bg-[#262824] border-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] hover:border-[#FF5F40]'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {/* Live Slider Control */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-[#9CA195]">
          <span className="text-[#9CA195] uppercase tracking-wider">Live Adjustment</span>
          <span className="font-mono text-[#F0FFEA]">
            <strong className="text-[#FF5F40] font-semibold">{localSpeed}</strong> km/h
            <span className="text-[#9CA195] ml-1.5">(0 – 1200 km/h)</span>
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={1200}
          step={10}
          value={localSpeed}
          onChange={(e) => {
            const val = Number(e.target.value);
            setLocalSpeed(val);
          }}
          onMouseUp={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-[#FF5F40] cursor-pointer h-1.5 bg-[#262824] rounded appearance-none"
        />

        {/* Range boundary tick labels */}
        <div className="flex justify-between text-[11px] text-[#9CA195] font-mono">
          <span>0 km/h (Static)</span>
          <span>600 km/h (Cruise)</span>
          <span>1200 km/h (Max)</span>
        </div>
      </div>

      {/* Physically Grounded Specifications Footnote */}
      {showPhysicalDetails && (
        <div className="mt-2.5 pt-2 border-t border-[#33362F] flex items-center justify-between text-[11px] text-[#9CA195] flex-wrap gap-1">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#9CA195]" />
            <span>Earth 1-Rev (Circumference 40,075 km):</span>
          </span>
          <span className="font-mono font-medium text-[#F0FFEA]">
            {formatBeaconRevolutionTime(localSpeed)}
          </span>
        </div>
      )}
    </div>
  );
};

export default BeaconSpeedControl;
