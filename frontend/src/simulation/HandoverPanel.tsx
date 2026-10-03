import React from 'react';
import { Radio, Satellite, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { THEME } from '../theme';

// ── Types ────────────────────────────────────────────────────────────────────

interface HandoverMetrics {
  handover_count:           number;
  successful_handovers:     number;
  failed_handovers:         number;
  no_coverage_events:       number;
  total_no_coverage_s:      number;
  mean_acquisition_time_s:  number | null;
}

interface HandoverData {
  active_sat_index:         number;
  backup_sat_index:         number;
  state:                    string;
  link_state:               string;
  pat_badge:                string;
  active_vis_can_see:       boolean;
  active_vis_el_deg:        number;
  active_vis_az_deg:        number;
  active_range_km:          number;
  backup_vis_can_see:       boolean;
  backup_vis_el_deg:        number;
  backup_vis_az_deg:        number;
  backup_range_km:          number;
  backup_acquire_progress:  number;
  will_lose_soon:           boolean;
  min_elevation_deg?:       number;
  metrics:                  HandoverMetrics;
  sim_time_s:               number;
}

interface HandoverPanelProps {
  handover: HandoverData | null | undefined;
  backupAcquireSteps?: number;  // default 3
}

// ── Colour & status helpers ───────────────────────────────────────────────────

const stateBadgeStyle = (state: string) => {
  switch (state) {
    case 'IDLE':
      return { background: THEME.accentSoft, border: `1px solid ${THEME.accent}`, color: THEME.text };
    case 'TRANSFERRING':
      return { background: THEME.surface2, border: `1px solid ${THEME.accent}`, color: THEME.accent };
    case 'NO_COVERAGE':
      return { background: THEME.surface2, border: `1px solid ${THEME.border}`, color: THEME.textMuted };
    default:
      return { background: THEME.surface2, border: `1px solid ${THEME.border}`, color: THEME.textMuted };
  }
};

const BadgeIcon = ({ state }: { state: string }) => {
  if (state === 'LINK_OK' || state === 'IDLE')
    return <CheckCircle size={12} style={{ color: THEME.accent, display: 'inline', marginRight: 4 }} />;
  if (state === 'NO_COVERAGE')
    return <XCircle size={12} style={{ color: THEME.textMuted, display: 'inline', marginRight: 4 }} />;
  return <AlertTriangle size={12} style={{ color: THEME.accent, display: 'inline', marginRight: 4 }} />;
};

// ── Component ────────────────────────────────────────────────────────────────

const HandoverPanel: React.FC<HandoverPanelProps> = ({ handover, backupAcquireSteps = 3 }) => {
  if (!handover) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <Radio size={13} style={{ marginRight: 6, color: THEME.accent }} />
          <span style={styles.title}>HANDOVER</span>
          <span style={{ ...styles.badge, background: THEME.surface2, color: THEME.textMuted }}>DISABLED</span>
        </div>
        <p style={styles.dimText}>ENABLE VIA SETTINGS → ORBITAL → HANDOVER</p>
      </div>
    );
  }

  const m = handover.metrics;
  const progressPct = Math.min(100, (handover.backup_acquire_progress / backupAcquireSteps) * 100);
  const badgeStyle = stateBadgeStyle(handover.state);

  return (
    <div style={styles.container}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <Radio size={13} style={{ marginRight: 6, color: THEME.accent }} />
        <span style={styles.title}>SATELLITE HANDOVER</span>
        <span style={{ ...styles.badge, ...badgeStyle }}>
          {handover.state}
        </span>
      </div>

      {/* ── Active / Backup row ── */}
      <div style={styles.row}>
        <SatBlock
          label="ACTIVE"
          idx={handover.active_sat_index}
          canSee={handover.active_vis_can_see}
          el={handover.active_vis_el_deg}
          az={handover.active_vis_az_deg}
          range={handover.active_range_km}
          willLose={handover.will_lose_soon}
        />
        <div style={styles.arrowCol}>
          {handover.state === 'TRANSFERRING'
            ? <div style={{ color: THEME.accent, fontSize: 18, fontWeight: 700 }}>⇒</div>
            : <div style={{ color: THEME.textDisabled, fontSize: 16 }}>⇒</div>}
        </div>
        <SatBlock
          label="BACKUP"
          idx={handover.backup_sat_index}
          canSee={handover.backup_vis_can_see}
          el={handover.backup_vis_el_deg}
          az={handover.backup_vis_az_deg}
          range={handover.backup_range_km}
          willLose={false}
        />
      </div>

      {/* ── Link state ── */}
      <div style={styles.linkRow}>
        <BadgeIcon state={handover.link_state} />
        <span style={{ color: handover.link_state === 'LINK_OK' ? THEME.text : THEME.accent, fontSize: 11, fontWeight: 600 }}>
          {handover.link_state}
        </span>
        {handover.will_lose_soon && (
          <span style={{ marginLeft: 8, color: THEME.accent, fontSize: 10 }}>
            [!] LOSS PREDICTED
          </span>
        )}
      </div>

      {/* ── Transfer progress bar ── */}
      {handover.state === 'TRANSFERRING' && (
        <div style={{ marginTop: 6 }}>
          <div style={styles.dimText}>BACKUP ACQUISITION: {handover.backup_acquire_progress}/{backupAcquireSteps}</div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* ── Metrics ── */}
      <div style={styles.metricsGrid}>
        <MetricCell label="HANDOVERS" value={m.handover_count} />
        <MetricCell label="SUCCEEDED" value={m.successful_handovers} color={THEME.accent} />
        <MetricCell label="FAILED" value={m.failed_handovers} color={m.failed_handovers > 0 ? THEME.accent : undefined} />
        <MetricCell label="NO COV" value={`${m.total_no_coverage_s.toFixed(1)}s`} color={m.total_no_coverage_s > 0 ? THEME.accent : undefined} />
        {m.mean_acquisition_time_s != null && (
          <MetricCell label="MEAN ACQ" value={`${m.mean_acquisition_time_s.toFixed(2)}s`} />
        )}
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface SatBlockProps {
  label: string;
  idx: number;
  canSee: boolean;
  el: number;
  az: number;
  range: number;
  willLose: boolean;
}

const SatBlock: React.FC<SatBlockProps> = ({ label, idx, canSee, el, az, range, willLose }) => (
  <div style={{
    flex: 1,
    background: THEME.surface2,
    borderRadius: 6,
    padding: '6px 8px',
    border: `1px solid ${THEME.border}`
  }}>
    <div style={{ fontSize: 9, color: THEME.accent, fontWeight: 700, letterSpacing: 1 }}>{label} SAT-{idx + 1}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
      <Satellite size={12} style={{ color: canSee ? THEME.accent : THEME.textDisabled }} />
      <span style={{ fontSize: 10, color: canSee ? THEME.text : THEME.textMuted }}>
        {canSee ? 'VISIBLE' : 'NO LOS'}
      </span>
    </div>
    <div style={{ fontSize: 9, color: THEME.textMuted, marginTop: 2 }}>
      EL {el.toFixed(1)}° · AZ {az.toFixed(1)}°
    </div>
    <div style={{ fontSize: 9, color: THEME.textMuted }}>
      {range.toFixed(0)} KM
    </div>
    {willLose && <div style={{ fontSize: 9, color: THEME.accent, marginTop: 2 }}>[!] LOSS PREDICTED</div>}
  </div>
);

const MetricCell: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center', padding: '4px', background: THEME.surface2, borderRadius: 4, border: `1px solid ${THEME.border}` }}>
    <div style={{ fontSize: 8, color: THEME.textMuted, letterSpacing: 0.5 }}>{label}</div>
    <div style={{ fontSize: 11, fontWeight: 700, color: color || THEME.text, marginTop: 2 }}>{value}</div>
  </div>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: THEME.surface1,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '12px 14px',
    color: THEME.text,
    fontFamily: THEME.fontFamily,
    minWidth: 260,
    maxWidth: 340,
    boxShadow: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    color: THEME.accent,
    letterSpacing: 1,
    flex: 1,
  },
  badge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid transparent',
  },
  row: {
    display: 'flex',
    gap: 6,
    marginBottom: 6,
  },
  arrowCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    flexShrink: 0,
  },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 6,
    fontSize: 11,
  },
  progressTrack: {
    height: 4,
    background: THEME.surface2,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
    border: `1px solid ${THEME.border}`,
  },
  progressFill: {
    height: '100%',
    background: THEME.accent,
    borderRadius: 2,
    transition: 'width 0.3s',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4,
    marginTop: 8,
  },
  dimText: {
    fontSize: 9,
    color: THEME.textMuted,
  },
};

export default HandoverPanel;
