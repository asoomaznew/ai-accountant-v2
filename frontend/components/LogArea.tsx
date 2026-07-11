import React, { useEffect, useRef } from 'react';
import { type LogEntry } from '../types';
import { InformationCircleIcon, CheckCircleIcon, XCircleIcon } from './icons';

interface LogAreaProps {
  logs: LogEntry[];
}

const LogArea: React.FC<LogAreaProps> = ({ logs }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogIcon = (type: LogEntry['type']) => {
    switch(type) {
      case 'success': return <CheckCircleIcon className="w-4 h-4 text-green-400" />;
      case 'error': return <XCircleIcon className="w-4 h-4 text-red-400" />;
      case 'info':
      default:
        return <InformationCircleIcon className="w-4 h-4 text-sky-400" />;
    }
  }

  const getTextColor = (type: LogEntry['type']) => {
    switch(type) {
        case 'success': return 'text-green-300';
        case 'error': return 'text-red-300';
        case 'info':
        default:
          return 'text-slate-300';
      }
  }

  return (
    <div className="bg-black/20 p-4">
      <h4 className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wider">Activity Log</h4>
      <div ref={logContainerRef} className="h-40 overflow-y-auto text-xs font-mono pr-2">
        {logs.length === 0 && <p className="text-slate-500">Logs will appear here...</p>}
        {logs.map(log => (
            <div key={log.id} className={`flex items-start space-x-2 mb-1 ${getTextColor(log.type)}`}>
                <span className="flex-shrink-0 mt-0.5">{getLogIcon(log.type)}</span>
                <p>{log.message}</p>
            </div>
        ))}
      </div>
    </div>
  );
};

export default LogArea;