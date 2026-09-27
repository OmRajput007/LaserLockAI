import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  FileText,
  Bookmark,
  CheckCircle,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Printer,
  Compass,
  Code,
  Layers,
  Award,
} from 'lucide-react';
import { api } from '../services/api';
import { DocumentationSection, TechnicalReportResponse, UserManualResponse } from '../types';

export const DocumentationPage: React.FC = () => {
  const [docType, setDocType] = useState<'technical' | 'user_manual'>('technical');
  const [technicalReport, setTechnicalReport] = useState<TechnicalReportResponse | null>(null);
  const [userManual, setUserManual] = useState<UserManualResponse | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        setLoading(true);
        const [tech, manual] = await Promise.all([
          api.getTechnicalReport(),
          api.getUserManual(),
        ]);
        setTechnicalReport(tech);
        setUserManual(manual);
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load system documentation');
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, []);

  const activeSections: DocumentationSection[] =
    docType === 'technical'
      ? technicalReport?.sections || []
      : userManual?.chapters || [];

  const filteredSections = activeSections.filter((sec) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      sec.title.toLowerCase().includes(q) ||
      sec.tag.toLowerCase().includes(q) ||
      sec.summary.toLowerCase().includes(q) ||
      sec.content.toLowerCase().includes(q)
    );
  });

  const activeSection =
    activeSections.find((s) => s.id === selectedSectionId) || activeSections[0];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-xs pb-10">
      {/* Header bar */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-lg flex flex-wrap items-center justify-between gap-4 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
            <BookOpen className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white uppercase tracking-wider">
              Technical Documentation & Operations Manual
            </h2>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Integrated 23-Section Engineering Report &bull; 14-Chapter Operator User Guide &bull; Searchable
            </p>
          </div>
        </div>

        {/* View Switcher & Print */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                setDocType('technical');
                setSelectedSectionId(1);
              }}
              className={`px-3 py-1.5 rounded-md font-bold text-xs transition flex items-center gap-1.5 ${
                docType === 'technical'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              Technical Report (23 Sections)
            </button>
            <button
              onClick={() => {
                setDocType('user_manual');
                setSelectedSectionId(1);
              }}
              className={`px-3 py-1.5 rounded-md font-bold text-xs transition flex items-center gap-1.5 ${
                docType === 'user_manual'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              User Manual (14 Chapters)
            </button>
          </div>

          <button
            onClick={handlePrint}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-bold flex items-center gap-1.5 transition"
            title="Print documentation"
          >
            <Printer className="w-3.5 h-3.5 text-cyan-400" />
            Print
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-300 p-3.5 rounded-lg">
          {errorMsg}
        </div>
      )}

      {/* Main 2-Column Documentation Browser */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Search & Chapter List */}
        <div className="lg:col-span-4 bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col h-[750px]">
          <div className="relative mb-3">
            <input
              type="text"
              placeholder={`Search ${docType === 'technical' ? '23 technical sections' : '14 manual chapters'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          </div>

          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-bold px-1 flex justify-between">
            <span>TABLE OF CONTENTS ({filteredSections.length})</span>
            <span>{docType === 'technical' ? 'TECHNICAL REPORT' : 'USER MANUAL'}</span>
          </div>

          <div className="overflow-y-auto space-y-1.5 flex-1 pr-1 custom-scrollbar">
            {filteredSections.map((sec) => {
              const isSelected = sec.id === activeSection?.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionId(sec.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/40 hover:text-white'
                  }`}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] ${
                      isSelected ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {sec.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs truncate leading-snug">{sec.title}</div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{sec.summary}</div>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 shrink-0 mt-1 transition ${
                      isSelected ? 'text-cyan-400 translate-x-0.5' : 'text-slate-600'
                    }`}
                  />
                </button>
              );
            })}

            {filteredSections.length === 0 && (
              <div className="text-center py-10 text-slate-500 text-xs">
                No sections matched "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Section Reader */}
        <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 rounded-lg p-6 flex flex-col h-[750px] overflow-y-auto">
          {activeSection ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 rounded text-[10px] font-bold">
                    {activeSection.tag}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {docType === 'technical' ? 'Section' : 'Chapter'} {activeSection.id} of {activeSections.length}
                  </span>
                </div>
                <h1 className="text-lg font-bold text-white tracking-wide">{activeSection.title}</h1>
                <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">{activeSection.summary}</p>
              </div>

              {/* Formatted Content */}
              <div className="prose prose-invert max-w-none text-slate-200 text-xs leading-relaxed space-y-4">
                {activeSection.content.split('\n\n').map((paragraph, pIdx) => {
                  // Check if code block
                  if (paragraph.startsWith('```')) {
                    const lines = paragraph.replace(/```[a-z]*/g, '').trim();
                    return (
                      <pre
                        key={pIdx}
                        className="bg-slate-950 border border-slate-800 p-3 rounded-lg text-cyan-300 font-mono text-[11px] overflow-x-auto"
                      >
                        <code>{lines}</code>
                      </pre>
                    );
                  }

                  // Check if header
                  if (paragraph.startsWith('### ')) {
                    return (
                      <h4 key={pIdx} className="text-sm font-bold text-cyan-400 pt-2 border-b border-slate-800/80 pb-1">
                        {paragraph.replace('### ', '')}
                      </h4>
                    );
                  }

                  if (paragraph.startsWith('## ')) {
                    return (
                      <h3 key={pIdx} className="text-base font-bold text-white pt-3 border-b border-slate-800 pb-1.5">
                        {paragraph.replace('## ', '')}
                      </h3>
                    );
                  }

                  // Check if bullet list
                  if (paragraph.startsWith('- ') || paragraph.startsWith('* ')) {
                    const items = paragraph.split('\n');
                    return (
                      <ul key={pIdx} className="list-disc list-inside space-y-1 text-slate-300 pl-2">
                        {items.map((it, iIdx) => (
                          <li key={iIdx}>{it.replace(/^[-*]\s*/, '')}</li>
                        ))}
                      </ul>
                    );
                  }

                  return (
                    <p key={pIdx} className="text-slate-300 leading-relaxed text-xs">
                      {paragraph}
                    </p>
                  );
                })}
              </div>

              {/* Footer navigation */}
              <div className="border-t border-slate-800 pt-4 flex items-center justify-between mt-8 text-xs text-slate-400">
                <button
                  onClick={() => setSelectedSectionId((id) => Math.max(1, id - 1))}
                  disabled={activeSection.id <= 1}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded disabled:opacity-30 transition"
                >
                  &larr; Previous {docType === 'technical' ? 'Section' : 'Chapter'}
                </button>
                <span>
                  {docType === 'technical' ? 'Section' : 'Chapter'} {activeSection.id} of {activeSections.length}
                </span>
                <button
                  onClick={() => setSelectedSectionId((id) => Math.min(activeSections.length, id + 1))}
                  disabled={activeSection.id >= activeSections.length}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded disabled:opacity-30 transition"
                >
                  Next {docType === 'technical' ? 'Section' : 'Chapter'} &rarr;
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500">Select a section to view documentation</div>
          )}
        </div>
      </div>
    </div>
  );
};
