import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Cpu, HardDrive, ShieldCheck } from 'lucide-react';
import { SystemHealthItem } from '../shared/types.js';
import { api } from '../services/apiBridge.js';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose }) => {
  const [items, setItems] = useState<SystemHealthItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const res = await api.getHealth();
      if (res.success) {
        setItems(res.items);
      }
    } catch (err) {
      console.error('Failed to run diagnostics', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealth();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col text-xs text-[#c9d1d9]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#0d1117] border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cpu className="text-blue-400" size={18} />
            <span className="font-semibold text-white text-sm">System Health & Runtime Diagnostics</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchHealth}
              disabled={isLoading}
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#21262d] hover:bg-[#30363d] rounded text-white"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              <span>Rescan</span>
            </button>
            <button onClick={onClose} className="p-1 text-[#8b949e] hover:text-white rounded" aria-label="Close diagnostics" title="Close diagnostics">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[70vh] space-y-3">
          <p className="text-[#8b949e] leading-relaxed">
            Real environment audit for NUVRO AI runtime services, local toolchains, and AI backend configuration.
          </p>

          <div className="grid grid-cols-1 gap-2.5">
            {items.map((item, idx) => {
              let icon = <CheckCircle2 className="text-emerald-400 shrink-0" size={16} />;
              let badgeColor = 'bg-emerald-950 text-emerald-300 border-emerald-800';

              if (item.status === 'warning') {
                icon = <AlertTriangle className="text-amber-400 shrink-0" size={16} />;
                badgeColor = 'bg-amber-950 text-amber-300 border-amber-800';
              } else if (item.status === 'missing') {
                icon = <XCircle className="text-rose-400 shrink-0" size={16} />;
                badgeColor = 'bg-rose-950 text-rose-300 border-rose-800';
              }

              return (
                <div
                  key={`${item.id}_${idx}`}
                  className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] flex items-start justify-between"
                >
                  <div className="flex items-start space-x-3 mr-3">
                    <div className="mt-0.5">{icon}</div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-white text-xs">{item.name}</span>
                        {item.version && (
                          <span className="font-mono text-[10px] text-blue-400 bg-[#21262d] px-1.5 py-0.2 rounded">
                            {item.version}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#8b949e] mt-1 leading-relaxed">{item.details}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border shrink-0 ${badgeColor}`}
                  >
                    {item.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between text-[#8b949e]">
          <span className="text-[11px]">Desktop sandbox active • Node.js Type Stripping ESM</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
