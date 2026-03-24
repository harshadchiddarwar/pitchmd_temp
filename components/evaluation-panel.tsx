'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Area, Line, Legend,
} from 'recharts';

interface EvaluationPanelProps {
  open: boolean;
  onClose: () => void;
  content: string;
  username?: string;
}

const DIMENSIONS = [
  { key: 'CLINICAL_KNOWLEDGE_SCORE', label: 'Clinical Knowledge', short: 'CK' },
  { key: 'OBJECTION_HANDLING_SCORE', label: 'Objection Handling', short: 'OH' },
  { key: 'COMPLIANCE_SCORE', label: 'Compliance', short: 'CO' },
  { key: 'TONE_RAPPORT_SCORE', label: 'Tone & Rapport', short: 'TR' },
  { key: 'CLOSING_SCORE', label: 'Closing', short: 'CL' },
];

const DIM_COLORS = ['#6b93c4', '#5fa882', '#c9a448', '#8b78c0', '#c97070'];

// Snowflake ::DATE returns strings like "2026-03-22".
// new Date("2026-03-22") parses as UTC midnight, which shifts to the previous day in US timezones.
// We detect date-only strings and construct a local-midnight Date to avoid the UTC shift.
function parseSnowflakeDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!isNaN(n)) {
    // Large number (>1B) = Unix epoch in ms or seconds
    if (n > 1000000000) return new Date(n > 9999999999 ? n : n * 1000);
    // Small positive integer = Snowflake ::DATE returns days since 1970-01-01
    // e.g. 20534 = 2026-03-22. new Date("20534") would wrongly give year 20534 AD.
    if (n > 0 && Number.isInteger(n)) {
      // n is days since 1970-01-01 (Snowflake epoch integer).
      // new Date(n * 86400000) creates UTC midnight — in US timezones (UTC-5 to -8)
      // that renders as the previous calendar day. Extract UTC components and
      // construct a local-midnight Date instead to stay on the correct date.
      const utc = new Date(n * 86400000);
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    }
  }
  const str = String(val).trim();
  // ISO date-only string "2026-03-22" — parse as local midnight to avoid UTC day shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val: any): string {
  const d = parseSnowflakeDate(val);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function formatDateTime(val: any): string {
  const d = parseSnowflakeDate(val);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Dot({ value }: { value: boolean | null }) {
  if (value === null || value === undefined) return <span className="inline-block w-3 h-3 rounded-full bg-slate-200" />;
  return <span className={`inline-block w-3 h-3 rounded-full ${value ? 'bg-green-500' : 'bg-red-400'}`} />;
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CollapsibleDimension({ title, score, rationale, indicators }: {
  title: string;
  score: number | null;
  rationale: string | null;
  indicators: { label: string; value: boolean | null }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold text-slate-800">{title}</span>
          {score !== null && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${score >= 8 ? 'bg-green-100 text-green-700' :
              score >= 6 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>{score}/10</span>
          )}
        </div>
        <span className="text-slate-400 text-lg">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100">
          {score !== null && <div className="pt-3"><ScoreBar score={score} /></div>}
          {rationale && <p className="text-sm text-slate-600 leading-relaxed">{rationale}</p>}
          {indicators.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              {indicators.map((ind, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Dot value={ind.value} />
                  <span className="text-sm text-slate-600 leading-snug">{ind.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EvaluationPanel({ open, onClose, content, username }: EvaluationPanelProps) {
  const [evaluation, setEvaluation] = useState<any>(null);
  const [historyWithPhysician, setHistoryWithPhysician] = useState<any[]>([]);
  const [historyAllPhysicians, setHistoryAllPhysicians] = useState<any[]>([]);
  const [segmentMedian, setSegmentMedian] = useState<any[]>([]);
  const [physicianName, setPhysicianName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noData, setNoData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchEvaluation();
  }, [open]);

  const fetchEvaluation = async () => {
    setLoading(true);
    setError(null);
    setNoData(false);
    try {
      const url = username ? `/api/evaluation?userId=${encodeURIComponent(username)}` : '/api/evaluation';
      const res = await fetch(url);
      if (res.status === 404) { setNoData(true); setEvaluation(null); return; }
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Could not load evaluation'); }
      const data = await res.json();
      setEvaluation(data.evaluation);
      const first = data.evaluation?.PHYSICIAN_FIRST_NAME;
      const last = data.evaluation?.PHYSICIAN_LAST_NAME;
      setPhysicianName([first, last].filter(Boolean).join(' ') || data.evaluation?.PHYSICIAN_ID || null);
      setHistoryWithPhysician(data.historyWithPhysician || []);
      setHistoryAllPhysicians(data.historyAllPhysicians || []);
      setSegmentMedian(data.segmentMedian || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const e = evaluation;

  const fieldReadyColor = () => {
    if (!e?.FIELD_READINESS) return 'bg-slate-100 text-slate-600';
    if (e.FIELD_READINESS === 'Field Ready') return 'bg-green-100 text-green-700';
    if (e.FIELD_READINESS.includes('Coaching')) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const barData = DIMENSIONS.map(d => ({ name: d.short, fullName: d.label, score: e?.[d.key] ?? 0 }));

  const histPhysicianData = historyWithPhysician.map((r: any) => ({
    date: formatDateTime(r.EVALUATED_AT),
    Overall: r.OVERALL_SCORE, CK: r.CLINICAL_KNOWLEDGE_SCORE, OH: r.OBJECTION_HANDLING_SCORE,
    CO: r.COMPLIANCE_SCORE, TR: r.TONE_RAPPORT_SCORE, CL: r.CLOSING_SCORE,
  }));

  // Charts 2 & 3 use ::DATE — use formatDate which correctly parses "YYYY-MM-DD" as local midnight
  const histAllData = historyAllPhysicians.map((r: any) => ({
    date: formatDate(r.EVALUATED_AT),
    Overall: r.OVERALL_SCORE, CK: r.CLINICAL_KNOWLEDGE_SCORE, OH: r.OBJECTION_HANDLING_SCORE,
    CO: r.COMPLIANCE_SCORE, TR: r.TONE_RAPPORT_SCORE, CL: r.CLOSING_SCORE,
  }));

  const segmentData = segmentMedian.map((r: any) => ({
    date: formatDate(r.EVALUATED_AT),
    Overall: r.OVERALL_SCORE, CK: r.CLINICAL_KNOWLEDGE_SCORE, OH: r.OBJECTION_HANDLING_SCORE,
    CO: r.COMPLIANCE_SCORE, TR: r.TONE_RAPPORT_SCORE, CL: r.CLOSING_SCORE,
  }));

  function HistoryChart({ data, title }: { data: any[]; title: string }) {
    if (!data.length) return (
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <p className="text-sm font-bold text-slate-800 mb-2">{title}</p>
        <p className="text-sm text-slate-400">Not enough data yet</p>
      </div>
    );
    return (
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <p className="text-sm font-bold text-slate-800 mb-4">{title}</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 60 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <Tooltip />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
            <Area type="monotone" dataKey="Overall" fill="#dbeafe" stroke="#6b93c4" strokeWidth={2} fillOpacity={0.5} />
            {['CK', 'OH', 'CO', 'TR', 'CL'].map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={DIM_COLORS[i]} strokeWidth={1.5} dot={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" style={{ maxWidth: '90rem', width: '90vw' }}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">Evaluation Report</DialogTitle>
        </DialogHeader>
        {loading && <div className="py-12 text-center text-sm text-slate-500">Loading evaluation...</div>}
        {!loading && noData && (
          <div className="py-16 text-center space-y-2">
            <p className="text-slate-500 font-medium">No evaluation on record yet.</p>
            <p className="text-sm text-slate-400">Complete a training session and end it with &quot;done&quot; to generate your first report.</p>
          </div>
        )}
        {!loading && error && <div className="py-6 text-center text-sm text-red-500">{error}</div>}
        {e && !loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg p-5 bg-white text-center">
                <p className="text-sm font-medium text-slate-500 mb-3">Field Readiness</p>
                <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${fieldReadyColor()}`}>{e.FIELD_READINESS ?? '—'}</span>
              </div>
              <div className="border border-slate-200 rounded-lg p-5 bg-white text-center">
                <p className="text-sm font-medium text-slate-500 mb-1">Overall Score</p>
                <p className="text-5xl font-bold text-slate-900">{e.OVERALL_SCORE ?? '—'}<span className="text-xl font-normal text-slate-400"> /10</span></p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg p-5 bg-white">
                <p className="text-sm font-bold text-slate-800 mb-3">Recommendations</p>
                {Array.isArray(e.RECOMMENDATIONS) && e.RECOMMENDATIONS.length > 0 ? (
                  <ul className="space-y-2">{e.RECOMMENDATIONS.map((rec: string, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-sm text-slate-700 leading-relaxed">{rec}</span>
                    </li>
                  ))}</ul>
                ) : <p className="text-sm text-slate-400">—</p>}
              </div>
              <div className="border border-slate-200 rounded-lg p-5 bg-white">
                <p className="text-sm font-bold text-slate-800 mb-3">Coaching Priority</p>
                <p className="text-sm text-slate-700 leading-relaxed">{e.COACHING_PRIORITY ?? '—'}</p>
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg p-5 bg-white">
              <p className="text-sm font-bold text-slate-800 mb-4">Dimension Scores</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: any, name: any, props: any) => [value, props.payload.fullName]} />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 12, fontWeight: 600 }}>
                    {barData.map((entry, index) => <Cell key={index} fill={DIM_COLORS[index]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 justify-center">
                {DIMENSIONS.map((d, i) => (
                  <span key={d.short} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: DIM_COLORS[i] }} />
                    <span className="font-bold text-slate-700">{d.short}</span> — {d.label}
                  </span>
                ))}
              </div>
            </div>
            <CollapsibleDimension title="Clinical Knowledge" score={e.CLINICAL_KNOWLEDGE_SCORE} rationale={e.CLINICAL_KNOWLEDGE_RATIONALE} indicators={[
              { label: 'Cited a peer-reviewed publication by name', value: e.CK_C1 },
              { label: 'Cited a major medical conference', value: e.CK_C2 },
              { label: 'Used specific quantitative data points', value: e.CK_C3 },
              { label: 'Referenced study design or methodology', value: e.CK_C4 },
              { label: 'Demonstrated mechanism-level understanding', value: e.CK_C5 },
              { label: 'Distinguished between evidence levels', value: e.CK_C6 },
              { label: 'Connected data to clinical relevance', value: e.CK_C7 },
              { label: 'Introduced patient scenarios unprompted', value: e.CK_C8 },
            ]} />
            <CollapsibleDimension title="Objection Handling" score={e.OBJECTION_HANDLING_SCORE} rationale={e.OBJECTION_HANDLING_RATIONALE} indicators={
              Array.isArray(e.OH_OBJECTION_DETAILS)
                ? e.OH_OBJECTION_DETAILS.flatMap((obj: any, i: number) => [
                  { label: `Objection ${i + 1}: ${obj.summary ?? ''}`, value: null },
                  { label: 'Acknowledge', value: !!obj.acknowledge },
                  { label: 'Reframe', value: !!obj.reframe },
                  { label: 'Evidence', value: !!obj.evidence },
                  { label: 'Qualify', value: !!obj.qualify },
                ]) : []
            } />
            <CollapsibleDimension title="Compliance" score={e.COMPLIANCE_SCORE} rationale={e.COMPLIANCE_RATIONALE} indicators={[
              { label: 'No off-label efficacy or indication claims', value: e.COMP_K1 },
              { label: 'No unsupported outcome claims', value: e.COMP_K2 },
              { label: 'Evidence levels clearly labeled', value: e.COMP_K3 },
              { label: 'No false or misleading competitive claims', value: e.COMP_K4 },
              { label: 'Appropriate qualifiers for limited evidence', value: e.COMP_K5 },
              { label: 'Presented both efficacy and safety data', value: e.COMP_K6 },
            ]} />
            <CollapsibleDimension title="Tone & Rapport" score={e.TONE_RAPPORT_SCORE} rationale={e.TONE_RAPPORT_RATIONALE} indicators={[
              { label: 'Used professional, appropriate language', value: e.TR_T1 },
              { label: 'Demonstrated confidence without arrogance', value: e.TR_T2 },
              { label: "Asked about physician's practice / patients", value: e.TR_T3 },
              { label: 'Acknowledged physician expertise', value: e.TR_T4 },
              { label: 'Adapted messaging to physician segment', value: e.TR_T5 },
              { label: 'Created conversational moments', value: e.TR_T6 },
              { label: 'Listened and built on physician responses', value: e.TR_T7 },
            ]} />
            <CollapsibleDimension title="Closing Technique" score={e.CLOSING_SCORE} rationale={e.CLOSING_RATIONALE} indicators={[
              { label: 'Summarized key value points', value: e.CL_L1 },
              { label: 'Asked a commitment question', value: e.CL_L2 },
              { label: 'Proposed a specific, concrete next step', value: e.CL_L3 },
              { label: 'Offered a tangible resource', value: e.CL_L4 },
              { label: 'Connected close to urgency or relevance', value: e.CL_L5 },
              { label: 'Established follow-up timeline', value: e.CL_L6 },
            ]} />
            <div className="grid grid-cols-3 gap-4">
              <HistoryChart data={histPhysicianData} title={`${e.PHYSICIAN_ID ?? ''} · ${physicianName ?? ''}`} />
              <HistoryChart data={segmentData} title={`Segment Median — ${e.SEGMENT_NAME ?? 'Same Segment'}`} />
              <HistoryChart data={histAllData} title="Median — All Physicians" />
            </div>
            {Array.isArray(e.RECOMMENDATIONS) && e.RECOMMENDATIONS.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-5 bg-white">
                <p className="text-sm font-bold text-slate-800 mb-3">Coaching Focus Summary</p>
                <p className="text-sm text-slate-500 mb-3">Synthesized across all training sessions{e.SEGMENT_NAME ? ` with ${e.SEGMENT_NAME} physicians` : ''}.</p>
                <ul className="space-y-2">{e.RECOMMENDATIONS.map((rec: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                    <span className="text-sm text-slate-700 leading-relaxed">{rec}</span>
                  </li>
                ))}</ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}