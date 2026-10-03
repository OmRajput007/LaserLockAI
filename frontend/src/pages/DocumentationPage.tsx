import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  Printer,
  ChevronRight,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { api } from '../services/api';
import { DocumentationSection, TechnicalReportResponse, UserManualResponse } from '../types';

export const DocumentationPage: React.FC = () => {
  const [docType, setDocType] = useState<'technical' | 'user_manual'>('technical');
  const [technicalReport, setTechnicalReport] = useState<TechnicalReportResponse | null>(null);
  const [userManual, setUserManual] = useState<UserManualResponse | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [, setLoading] = useState<boolean>(true);
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
    <div className="flex flex-col gap-4 font-mono text-xs text-[#F0FFEA] pb-10">
      {/* Header bar */}
      <div className="bg-[#1B1D1A] border border-[#33362F] p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#262824] border border-[#33362F] flex items-center justify-center text-[#FF5F40]">
            <BookOpen className="w-4 h-4 text-[#FF5F40]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#F0FFEA]">
              Technical Documentation & Operator Manual
            </h2>
            <p className="text-[#9CA195] text-xs mt-0.5">
              Comprehensive Engineering Specifications & Practical Operations Guide
            </p>
          </div>
        </div>

        {/* View Switcher & Print */}
        <div className="flex items-center gap-2.5">
          <div className="flex bg-[#000000] p-1 rounded border border-[#33362F]">
            <button
              onClick={() => {
                setDocType('technical');
                setSelectedSectionId(1);
              }}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition flex items-center gap-1.5 ${
                docType === 'technical'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold shadow-sm'
                  : 'text-[#9CA195] hover:text-[#F0FFEA]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Technical Report
            </button>
            <button
              onClick={() => {
                setDocType('user_manual');
                setSelectedSectionId(1);
              }}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition flex items-center gap-1.5 ${
                docType === 'user_manual'
                  ? 'bg-[#FF5F40] text-[#0A0A0A] font-bold shadow-sm'
                  : 'text-[#9CA195] hover:text-[#F0FFEA]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              User Manual
            </button>
          </div>

          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] border border-[#33362F] rounded font-medium text-xs flex items-center gap-1.5 transition"
            title="Print documentation"
          >
            <Printer className="w-3.5 h-3.5 text-[#FF5F40]" />
            Print
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[#262824] border border-[#FF5F40] text-[#FF5F40] p-3.5 rounded-lg text-xs">
          ! {errorMsg}
        </div>
      )}

      {/* Main 2-Column Documentation Browser */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Search & Chapter List */}
        <div className="lg:col-span-4 bg-[#1B1D1A] border border-[#33362F] rounded-lg p-3.5 flex flex-col h-[750px]">
          <div className="relative mb-3">
            <input
              type="text"
              placeholder={`Search ${docType === 'technical' ? 'technical sections' : 'user chapters'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#262824] border border-[#33362F] rounded pl-9 pr-3 py-2 text-xs text-[#F0FFEA] placeholder-[#9CA195] focus:outline-none focus:border-[#FF5F40] transition"
            />
            <Search className="w-4 h-4 text-[#9CA195] absolute left-3 top-2.5" />
          </div>

          <div className="text-[11px] text-[#9CA195] font-medium uppercase tracking-wider mb-2 px-1 flex justify-between">
            <span>Contents ({filteredSections.length})</span>
            <span>{docType === 'technical' ? 'Technical' : 'Manual'}</span>
          </div>

          <div className="overflow-y-auto space-y-1 flex-1 pr-1">
            {filteredSections.map((sec) => {
              const isSelected = sec.id === activeSection?.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionId(sec.id)}
                  className={`w-full text-left p-2.5 rounded border transition flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-[#FF5F40]/15 border-[#FF5F40]/40 text-[#F0FFEA]'
                      : 'bg-[#262824]/60 border-[#33362F] text-[#9CA195] hover:bg-[#262824] hover:text-[#F0FFEA]'
                  }`}
                >
                  <span
                    className={`shrink-0 w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] ${
                      isSelected ? 'bg-[#FF5F40] text-[#0A0A0A]' : 'bg-[#1B1D1A] text-[#9CA195]'
                    }`}
                  >
                    {sec.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs truncate leading-snug">{sec.title}</div>
                    <div className="text-[11px] text-[#9CA195] truncate mt-0.5">{sec.summary}</div>
                  </div>
                  <ChevronRight
                    className={`w-3.5 h-3.5 shrink-0 mt-0.5 transition ${
                      isSelected ? 'text-[#FF5F40] translate-x-0.5' : 'text-[#5E625A]'
                    }`}
                  />
                </button>
              );
            })}

            {filteredSections.length === 0 && (
              <div className="text-center py-10 text-[#9CA195] text-xs">
                No sections matched "{searchQuery}"
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Section Reader */}
        <div className="lg:col-span-8 bg-[#1B1D1A] border border-[#33362F] rounded-lg p-6 flex flex-col h-[750px] overflow-y-auto">
          {activeSection ? (
            <div className="space-y-5">
              {/* Header */}
              <div className="border-b border-[#33362F] pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-[#262824] text-[#FF5F40] border border-[#33362F] rounded text-[10px] font-bold">
                    {activeSection.tag}
                  </span>
                  <span className="text-[11px] text-[#9CA195]">
                    {docType === 'technical' ? 'Section' : 'Chapter'} {activeSection.id} of {activeSections.length}
                  </span>
                </div>
                <h1 className="text-lg font-bold text-[#F0FFEA] tracking-wide uppercase">{activeSection.title}</h1>
                <p className="text-[#9CA195] text-xs mt-1.5 leading-relaxed">{activeSection.summary}</p>
              </div>

              {/* Formatted Content */}
              <div className="text-[#F0FFEA] text-xs leading-relaxed space-y-4">
                {activeSection.content.split('\n\n').map((paragraph, pIdx) => {
                  // Code block
                  if (paragraph.startsWith('```')) {
                    const lines = paragraph.replace(/```[a-z]*/g, '').trim();
                    return (
                      <pre
                        key={pIdx}
                        className="bg-[#000000] border border-[#33362F] p-3 rounded text-[#F0FFEA] font-mono text-[11px] overflow-x-auto"
                      >
                        <code>{lines}</code>
                      </pre>
                    );
                  }

                  // Headers
                  if (paragraph.startsWith('### ')) {
                    return (
                      <h4 key={pIdx} className="text-xs font-bold text-[#F0FFEA] uppercase tracking-wider pt-2 border-b border-[#33362F] pb-1">
                        {paragraph.replace('### ', '')}
                      </h4>
                    );
                  }

                  if (paragraph.startsWith('## ')) {
                    return (
                      <h3 key={pIdx} className="text-sm font-bold text-[#F0FFEA] uppercase tracking-wider pt-3 border-b border-[#33362F] pb-1.5">
                        {paragraph.replace('## ', '')}
                      </h3>
                    );
                  }

                  // List
                  if (paragraph.startsWith('- ') || paragraph.startsWith('* ')) {
                    const items = paragraph.split('\n');
                    return (
                      <ul key={pIdx} className="list-disc list-inside space-y-1 text-[#F0FFEA] pl-2">
                        {items.map((it, iIdx) => (
                          <li key={iIdx}>{it.replace(/^[-*]\s*/, '')}</li>
                        ))}
                      </ul>
                    );
                  }

                  return (
                    <p key={pIdx} className="text-[#F0FFEA] leading-relaxed text-xs">
                      {paragraph}
                    </p>
                  );
                })}
              </div>

              {/* Footer navigation */}
              <div className="border-t border-[#33362F] pt-4 flex items-center justify-between mt-8 text-xs text-[#9CA195]">
                <button
                  onClick={() => setSelectedSectionId((id) => Math.max(1, id - 1))}
                  disabled={activeSection.id <= 1}
                  className="px-3 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] rounded disabled:opacity-30 border border-[#33362F] transition"
                >
                  &larr; Previous {docType === 'technical' ? 'Section' : 'Chapter'}
                </button>
                <span className="font-mono text-[11px]">
                  {activeSection.id} / {activeSections.length}
                </span>
                <button
                  onClick={() => setSelectedSectionId((id) => Math.min(activeSections.length, id + 1))}
                  disabled={activeSection.id >= activeSections.length}
                  className="px-3 py-1.5 bg-[#262824] hover:bg-[#FF5F40]/20 text-[#F0FFEA] rounded disabled:opacity-30 border border-[#33362F] transition"
                >
                  Next {docType === 'technical' ? 'Section' : 'Chapter'} &rarr;
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-[#9CA195]">Select a section to view documentation</div>
          )}
        </div>
      </div>
    </div>
  );
};
